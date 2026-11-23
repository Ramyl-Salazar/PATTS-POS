package ph.edu.patts.offlinepos;

import static org.junit.Assert.*;
import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Queue;
import org.junit.Test;

public class NfcXExchangeTest {
    private static final class FakeReader implements NfcXExchange.Transport {
        long time;
        int reads;
        int written = 64;
        final Queue<byte[]> reports = new ArrayDeque<>();
        public int write(byte[] report) { return written; }
        public int read(byte[] report, int timeoutMs) {
            reads++;
            byte[] next = reports.poll();
            time += next == null ? timeoutMs : 5;
            if (next == null) return -1;
            System.arraycopy(next, 0, report, 0, next.length);
            return next.length;
        }
        public long now() { return time; }
    }

    @Test public void noCardCompletesWithoutWaitingForDeadline() throws Exception {
        for (int timeout : new int[] { 1400, 4200 }) {
            FakeReader reader = new FakeReader();
            reader.reports.add(NfcXProtocol.request(0x0069, new byte[] { 0 }));
            assertFalse(NfcXExchange.exchange(reader, 0x0069, new byte[0], timeout).hasCard());
            assertEquals(5, reader.time);
            assertEquals(1, reader.reads);
        }
    }

    @Test public void ignoresStaleWrongCommandAndBadChecksumBeforeValidCard() throws Exception {
        FakeReader reader = new FakeReader();
        reader.reports.add(NfcXProtocol.request(0x0072, new byte[] { 1, 2, 3 }));
        byte[] bad = NfcXProtocol.request(0x0069, new byte[] { 1, 2, 3 });
        bad[6] ^= 1;
        reader.reports.add(bad);
        reader.reports.add(NfcXProtocol.request(0x0069, new byte[] { 1, 4, 5 }));
        NfcXProtocol.Response response = NfcXExchange.exchange(reader, 0x0069, new byte[0], 1400);
        assertArrayEquals(new byte[] { 1, 4, 5 }, response.payload);
        assertEquals(15, reader.time);
    }

    @Test public void silentReaderStillGetsTheFullResponseWindow() throws Exception {
        FakeReader reader = new FakeReader();
        assertNull(NfcXExchange.exchange(reader, 0x0072, new byte[] { 0, 0 }, 4200));
        assertEquals(4200, reader.time);
    }

    @Test public void partialWriteIsATransportFailure() throws Exception {
        FakeReader reader = new FakeReader();
        reader.written = 12;
        assertThrows(IOException.class, () -> NfcXExchange.exchange(reader, 0x0069, new byte[0], 1400));
        assertEquals(0, reader.reads);
    }
}
