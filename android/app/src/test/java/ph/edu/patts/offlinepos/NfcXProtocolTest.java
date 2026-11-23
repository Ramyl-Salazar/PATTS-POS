package ph.edu.patts.offlinepos;

import static org.junit.Assert.*;
import org.junit.Test;

public class NfcXProtocolTest {
    @Test public void buildsHighFrequencyRequest() {
        byte[] report = NfcXProtocol.request(0x0069, new byte[0]);
        assertArrayEquals(new byte[] { 0x55, 0x00, 0x69, 0x00, 0x00, (byte) 0xff, 0x00 }, java.util.Arrays.copyOf(report, 7));
        assertEquals(64, report.length);
    }
    @Test public void buildsLowFrequencyRequest() {
        byte[] report = NfcXProtocol.request(0x0072, new byte[] { 0, 0 });
        assertArrayEquals(new byte[] { 0x55, 0x00, 0x72, 0x00, 0x02, 0x00, 0x00, (byte) 0xff, 0x00 }, java.util.Arrays.copyOf(report, 9));
    }
    @Test public void parsesValidResponseAndRejectsBadChecksum() {
        byte[] report = NfcXProtocol.request(0x0069, new byte[] { 1, 2, 3 });
        assertTrue(NfcXProtocol.parse(report, report.length).hasCard());
        report[6] ^= 1;
        assertNull(NfcXProtocol.parse(report, report.length));
    }
}
