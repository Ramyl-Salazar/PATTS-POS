package ph.edu.patts.offlinepos;

import java.util.Arrays;

final class NfcXProtocol {
    static final int REPORT_SIZE = 64;
    static final int COMMAND_HF_CARD_INFO = 0x0069;
    static final int COMMAND_LF_AUTO_READ = 0x0072;

    private NfcXProtocol() {}

    static byte[] request(int command, byte[] payload) {
        if (payload.length > REPORT_SIZE - 7) throw new IllegalArgumentException("Payload is too large");
        byte[] report = new byte[REPORT_SIZE];
        report[0] = 0x55;
        report[1] = (byte) (command >>> 8);
        report[2] = (byte) command;
        report[3] = (byte) (payload.length >>> 8);
        report[4] = (byte) payload.length;
        System.arraycopy(payload, 0, report, 5, payload.length);
        int xor = 0;
        for (byte value : payload) xor ^= value & 0xff;
        int checksum = (((xor << 8) ^ 0xff00) + xor) & 0xffff;
        report[5 + payload.length] = (byte) (checksum >>> 8);
        report[6 + payload.length] = (byte) checksum;
        return report;
    }

    static Response parse(byte[] report, int count) {
        if (count < 7 || report[0] != 0x55) return null;
        int command = ((report[1] & 0xff) << 8) | (report[2] & 0xff);
        int length = ((report[3] & 0xff) << 8) | (report[4] & 0xff);
        if (length < 1 || length > count - 7) return null;
        byte[] payload = Arrays.copyOfRange(report, 5, 5 + length);
        int xor = 0;
        for (byte value : payload) xor ^= value & 0xff;
        int expected = (((xor << 8) ^ 0xff00) + xor) & 0xffff;
        int actual = ((report[5 + length] & 0xff) << 8) | (report[6 + length] & 0xff);
        if (expected != actual) return null;
        return new Response(command, payload);
    }

    static String hex(byte[] value) {
        StringBuilder result = new StringBuilder(value.length * 2);
        for (byte item : value) result.append(String.format("%02X", item & 0xff));
        return result.toString();
    }

    static final class Response {
        final int command;
        final byte[] payload;
        Response(int command, byte[] payload) { this.command = command; this.payload = payload; }
        boolean hasCard() { return payload.length > 1 && payload[0] != 0; }
    }
}
