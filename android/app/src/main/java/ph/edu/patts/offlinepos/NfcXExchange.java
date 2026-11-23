package ph.edu.patts.offlinepos;

import java.io.IOException;

/** One serialized, read-only command. Transport and monotonic clock are injectable for tests. */
final class NfcXExchange {
    interface Transport {
        int write(byte[] report);
        int read(byte[] report, int timeoutMs);
        long now();
    }

    static NfcXProtocol.Response exchange(Transport transport, int command, byte[] payload, int timeoutMs)
            throws IOException {
        byte[] request = NfcXProtocol.request(command, payload);
        if (transport.write(request) != request.length) throw new IOException("The USB reader did not receive the full request. Reconnect the reader and try again.");
        long deadline = transport.now() + timeoutMs;
        byte[] report = new byte[NfcXProtocol.REPORT_SIZE];
        long remaining;
        while ((remaining = deadline - transport.now()) > 0) {
            int count = transport.read(report, (int) Math.min(80, remaining));
            NfcXProtocol.Response response = NfcXProtocol.parse(report, count);
            // No-card is a completed response, not a reason to wait 1.4/4.2 seconds.
            if (response != null && response.command == command) return response;
        }
        return null;
    }
}
