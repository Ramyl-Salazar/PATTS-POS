import { bytesToHex } from "./access.js";

export const USB_READER_FILTER = Object.freeze({ vendorId: 0x0483, productId: 0x4343 });

export function buildReaderReport(command, payload = []) {
  const report = new Uint8Array(64);
  report[0] = 0x55;
  report[1] = command >>> 8;
  report[2] = command;
  report[3] = payload.length >>> 8;
  report[4] = payload.length;
  report.set(payload, 5);
  const xor = payload.reduce((value, byte) => value ^ byte, 0);
  const checksum = ((((xor << 8) ^ 0xff00) + xor) & 0xffff);
  report[5 + payload.length] = checksum >>> 8;
  report[6 + payload.length] = checksum;
  return report;
}

export function parseReaderReport(data, expectedCommand) {
  const report = data instanceof Uint8Array ? data : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (report.length < 7 || report[0] !== 0x55) return null;
  const command = (report[1] << 8) | report[2];
  const length = (report[3] << 8) | report[4];
  if (command !== expectedCommand || length < 1 || length > report.length - 7) return null;
  const payload = report.slice(5, 5 + length);
  const xor = payload.reduce((value, byte) => value ^ byte, 0);
  const expectedChecksum = ((((xor << 8) ^ 0xff00) + xor) & 0xffff);
  const actualChecksum = (report[5 + length] << 8) | report[6 + length];
  // A valid no-card response completes the command too; do not wait out the
  // entire response window after the reader has already answered.
  return expectedChecksum === actualChecksum ? payload : null;
}

export function cardResult(cardType, payload, reader) {
  return {
    connected: true,
    cardType,
    cardKey: `${cardType}:${bytesToHex(payload.slice(1)).toUpperCase()}`,
    reader,
  };
}
