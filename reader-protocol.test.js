import test from "node:test";
import assert from "node:assert/strict";
import { buildReaderReport, cardResult, parseReaderReport, USB_READER_FILTER } from "./reader-protocol.js";

test("builds and parses NFC-X HID frames", () => {
  const frame = buildReaderReport(0x0069, [1, 0xaa, 0xbb]);
  assert.deepEqual(Array.from(parseReaderReport(frame, 0x0069)), [1, 0xaa, 0xbb]);
  frame[8] ^= 1;
  assert.equal(parseReaderReport(frame, 0x0069), null);
});

test("creates a canonical read-only card result", () => {
  assert.deepEqual(cardResult("HF", new Uint8Array([1, 0xaa, 0xbb]), "NFC-X"), {
    connected: true, cardType: "HF", cardKey: "HF:AABB", reader: "NFC-X",
  });
  assert.deepEqual(USB_READER_FILTER, { vendorId: 0x0483, productId: 0x4343 });
});

test("valid no-card responses complete a probe immediately; unrelated or corrupt frames do not", () => {
  const frame = buildReaderReport(0x0069, [0]);
  assert.deepEqual([...parseReaderReport(frame, 0x0069)], [0]);
  assert.equal(parseReaderReport(frame, 0x0072), null);
  assert.equal(parseReaderReport(frame.slice(0, 7), 0x0069), null);
  frame[6] ^= 1;
  assert.equal(parseReaderReport(frame, 0x0069), null);
});
