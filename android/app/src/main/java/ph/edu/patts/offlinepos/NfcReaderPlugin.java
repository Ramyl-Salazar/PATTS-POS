package ph.edu.patts.offlinepos;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.*;
import android.os.Build;
import android.os.SystemClock;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "NfcReader")
public class NfcReaderPlugin extends Plugin {
    private static final int VENDOR_ID = 0x0483;
    private static final int PRODUCT_ID = 0x4343;
    private static final String USB_PERMISSION = "ph.edu.patts.offlinepos.USB_PERMISSION";
    private static final String READER_PREFERENCES = "nfc_reader";
    private static final String PREFERRED_CARD_TYPE = "preferred_card_type";
    private static final String EMULATOR_BRIDGE = "http://10.0.2.2:8765";
    private static final int HF_CARD_PROBE_TIMEOUT_MS = 1400;
    private static final int LF_CARD_PROBE_TIMEOUT_MS = 4200;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private PluginCall pendingCall;
    private volatile String preferredCardType = "HF";
    // Owned exclusively by the reader executor; keep the hub connection open
    // between polls instead of detaching/reclaiming its HID interface each time.
    private UsbDeviceConnection readerConnection;
    private UsbInterface readerInterface;
    private UsbEndpoint readerInput;
    private UsbEndpoint readerOutput;
    private String readerDeviceName;

    private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                UsbDevice detached = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                if (detached != null) executor.execute(() -> {
                    if (detached.getDeviceName().equals(readerDeviceName)) closeReader();
                });
                return;
            }
            if (!USB_PERMISSION.equals(intent.getAction())) return;
            PluginCall call = pendingCall;
            pendingCall = null;
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (call == null) return;
            boolean granted = device != null && (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                || usbManager().hasPermission(device));
            if (!granted) {
                call.reject("USB reader permission was denied.", "USB_PERMISSION_DENIED");
            } else scanInBackground(call, device);
        }
    };

    @Override public void load() {
        preferredCardType = "LF".equals(getContext().getSharedPreferences(READER_PREFERENCES, Context.MODE_PRIVATE)
            .getString(PREFERRED_CARD_TYPE, "HF")) ? "LF" : "HF";
        IntentFilter filter = new IntentFilter(USB_PERMISSION);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(getContext(), permissionReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    @Override protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(permissionReceiver); } catch (IllegalArgumentException ignored) {}
        if (pendingCall != null) { pendingCall.reject("Reader closed."); pendingCall = null; }
        executor.execute(this::closeReader);
        executor.shutdown();
    }

    @Override protected void handleOnPause() {
        executor.execute(this::closeReader);
    }

    @PluginMethod public void status(PluginCall call) {
        if (isEmulator()) {
            executor.execute(() -> resolveEmulatorStatus(call));
            return;
        }
        UsbDevice device = findReader();
        JSObject result = new JSObject();
        result.put("connected", device != null);
        result.put("permissionGranted", device != null && usbManager().hasPermission(device));
        result.put("reader", device == null ? "Not connected" : device.getProductName());
        result.put("emulator", isEmulator());
        call.resolve(result);
    }

    @PluginMethod public void scan(PluginCall call) {
        if (isEmulator()) {
            executor.execute(() -> scanEmulatorBridge(call));
            return;
        }
        UsbDevice device = findReader();
        if (device == null) { call.reject("Connect the NFC-X reader through a USB OTG adapter.", "READER_NOT_CONNECTED"); return; }
        UsbManager manager = usbManager();
        if (!manager.hasPermission(device)) {
            if (pendingCall != null) { call.reject("A reader permission request is already open.", "USB_PERMISSION_PENDING"); return; }
            pendingCall = call;
            PendingIntent permissionIntent = PendingIntent.getBroadcast(getContext(), 0,
                new Intent(USB_PERMISSION).setPackage(getContext().getPackageName()),
                PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                    ? PendingIntent.FLAG_MUTABLE : 0));
            manager.requestPermission(device, permissionIntent);
            return;
        }
        scanInBackground(call, device);
    }

    private void scanInBackground(PluginCall call, UsbDevice device) {
        executor.execute(() -> {
            try { call.resolve(readCard(device)); }
            catch (Exception error) {
                closeReader();
                call.reject(error.getMessage(), "READER_ERROR", error);
            }
        });
    }

    private void openReader(UsbDevice device) throws Exception {
        if (readerConnection != null && device.getDeviceName().equals(readerDeviceName)) return;
        closeReader();
        UsbInterface hid = null;
        UsbEndpoint input = null;
        UsbEndpoint output = null;
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface candidate = device.getInterface(i);
            if (candidate.getInterfaceClass() != UsbConstants.USB_CLASS_HID) continue;
            UsbEndpoint candidateInput = null;
            UsbEndpoint candidateOutput = null;
            for (int j = 0; j < candidate.getEndpointCount(); j++) {
                UsbEndpoint endpoint = candidate.getEndpoint(j);
                if (endpoint.getType() != UsbConstants.USB_ENDPOINT_XFER_INT) continue;
                if (endpoint.getDirection() == UsbConstants.USB_DIR_IN) candidateInput = endpoint;
                else if (endpoint.getDirection() == UsbConstants.USB_DIR_OUT) candidateOutput = endpoint;
            }
            if (candidateInput != null && candidateOutput != null) { hid = candidate; input = candidateInput; output = candidateOutput; break; }
        }
        if (hid == null) throw new Exception("The connected device has no compatible HID card-reader interface.");
        UsbDeviceConnection connection = usbManager().openDevice(device);
        if (connection == null) throw new Exception("Android could not open the USB reader.");
        if (!connection.claimInterface(hid, true)) {
            connection.close();
            throw new Exception("The USB reader interface is busy.");
        }
        readerConnection = connection;
        readerInterface = hid;
        readerInput = input;
        readerOutput = output;
        readerDeviceName = device.getDeviceName();
    }

    private void closeReader() {
        if (readerConnection != null) {
            readerConnection.releaseInterface(readerInterface);
            readerConnection.close();
        }
        readerConnection = null;
        readerInterface = null;
        readerInput = null;
        readerOutput = null;
        readerDeviceName = null;
    }

    private JSObject readCard(UsbDevice device) throws Exception {
        openReader(device);
        UsbDeviceConnection connection = readerConnection;
        UsbEndpoint input = readerInput;
        UsbEndpoint output = readerOutput;
        String cardType = preferredCardType;
        NfcXProtocol.Response response;
        if ("LF".equals(cardType)) {
            response = exchange(connection, output, input, NfcXProtocol.COMMAND_LF_AUTO_READ, new byte[] { 0, 0 }, LF_CARD_PROBE_TIMEOUT_MS);
            if (response == null || !response.hasCard()) {
                cardType = "HF";
                response = exchange(connection, output, input, NfcXProtocol.COMMAND_HF_CARD_INFO, new byte[0], HF_CARD_PROBE_TIMEOUT_MS);
            }
        } else {
            response = exchange(connection, output, input, NfcXProtocol.COMMAND_HF_CARD_INFO, new byte[0], HF_CARD_PROBE_TIMEOUT_MS);
            if (response == null || !response.hasCard()) {
                cardType = "LF";
                response = exchange(connection, output, input, NfcXProtocol.COMMAND_LF_AUTO_READ, new byte[] { 0, 0 }, LF_CARD_PROBE_TIMEOUT_MS);
            }
        }
        if (response == null) {
            closeReader();
            throw new Exception("No card detected. Hold the card on the reader and try again.");
        }
        if (!response.hasCard()) {
            JSObject result = new JSObject();
            result.put("noCard", true);
            return result;
        }
        if (!cardType.equals(preferredCardType)) {
            preferredCardType = cardType;
            getContext().getSharedPreferences(READER_PREFERENCES, Context.MODE_PRIVATE)
                .edit().putString(PREFERRED_CARD_TYPE, cardType).apply();
        }
        byte[] cardRecord = new byte[response.payload.length - 1];
        System.arraycopy(response.payload, 1, cardRecord, 0, cardRecord.length);
        JSObject result = new JSObject();
        result.put("connected", true);
        result.put("cardType", cardType);
        result.put("cardKey", cardType + ":" + NfcXProtocol.hex(cardRecord));
        result.put("reader", device.getProductName());
        return result;
    }

    private NfcXProtocol.Response exchange(UsbDeviceConnection connection, UsbEndpoint output, UsbEndpoint input,
                                            int command, byte[] payload, int timeoutMs) throws java.io.IOException {
        return NfcXExchange.exchange(new NfcXExchange.Transport() {
            public int write(byte[] report) { return connection.bulkTransfer(output, report, report.length, 250); }
            public int read(byte[] report, int waitMs) { return connection.bulkTransfer(input, report, report.length, waitMs); }
            public long now() { return SystemClock.elapsedRealtime(); }
        }, command, payload, timeoutMs);
    }

    private UsbManager usbManager() { return (UsbManager) getContext().getSystemService(Context.USB_SERVICE); }
    private void resolveEmulatorStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("emulator", true);
        try {
            JSONObject bridgeStatus = bridgeRequest("GET", "/status");
            boolean connected = bridgeStatus.optBoolean("connected", false);
            result.put("bridge", true);
            result.put("connected", connected);
            result.put("permissionGranted", connected);
            result.put("reader", bridgeStatus.optString("reader", connected ? "NFC-X reader" : "Not connected"));
        } catch (Exception ignored) {
            result.put("bridge", false);
            result.put("connected", false);
            result.put("permissionGranted", false);
            result.put("reader", "PC bridge unavailable");
        }
        call.resolve(result);
    }
    private void scanEmulatorBridge(PluginCall call) {
        try {
            JSONObject bridgeResult = bridgeRequest("POST", "/scan");
            JSObject result = new JSObject();
            result.put("connected", bridgeResult.optBoolean("connected", true));
            result.put("cardType", bridgeResult.getString("cardType"));
            result.put("cardKey", bridgeResult.getString("cardKey"));
            result.put("reader", bridgeResult.optString("reader", "NFC-X reader"));
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage(), "READER_BRIDGE_ERROR", error);
        }
    }
    private JSONObject bridgeRequest(String method, String path) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(EMULATOR_BRIDGE + path).openConnection();
        connection.setRequestMethod(method);
        connection.setConnectTimeout(1200);
        connection.setReadTimeout(7000);
        connection.setUseCaches(false);
        connection.setRequestProperty("X-PATTS-Bridge", "patts-emulator-v1");
        if ("POST".equals(method)) connection.setDoOutput(true);
        int statusCode = connection.getResponseCode();
        InputStream stream = statusCode >= 200 && statusCode < 300
            ? connection.getInputStream() : connection.getErrorStream();
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        } finally {
            connection.disconnect();
        }
        JSONObject json = new JSONObject(body.toString());
        if (statusCode < 200 || statusCode >= 300)
            throw new Exception(json.optString("error", "The PC reader bridge returned an error."));
        return json;
    }
    private boolean isEmulator() {
        return Build.FINGERPRINT.startsWith("generic") || Build.FINGERPRINT.contains("emulator")
            || Build.MODEL.contains("Emulator") || Build.MODEL.contains("Android SDK built for")
            || Build.PRODUCT.contains("sdk") || Build.HARDWARE.contains("ranchu")
            || Build.HARDWARE.contains("goldfish");
    }
    private UsbDevice findReader() {
        for (UsbDevice device : usbManager().getDeviceList().values())
            if (device.getVendorId() == VENDOR_ID && device.getProductId() == PRODUCT_ID) return device;
        return null;
    }
}
