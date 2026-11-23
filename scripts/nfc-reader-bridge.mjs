import http from "node:http";
import HID from "node-hid";
import { isBridgeRequestAuthorized } from "./reader-bridge-auth.mjs";
import { buildReaderReport, cardResult, parseReaderReport } from "../reader-protocol.js";

const HOST = "127.0.0.1";
const PORT = 8765;
const VENDOR_ID = 0x0483;
const PRODUCT_ID = 0x4343;
const COMMAND_HF_CARD_INFO = 0x0069;
const COMMAND_LF_AUTO_READ = 0x0072;
const CARD_PROBE_TIMEOUT_MS = { HF: 1400, LF: 4200 };
const READ_SLICE_MS = 80;
let preferredCardType = "HF";

function findReader() {
  return HID.devices().find((device) =>
    device.vendorId === VENDOR_ID
    && device.productId === PRODUCT_ID
    && (device.usagePage === 0xff || device.interface === 1)
  );
}

function buildRequest(command, payload = []) {
  return buildReaderReport(command, payload);
}

function parseResponse(bytes, expectedCommand) {
  let report = Uint8Array.from(bytes);
  if (report[0] === 0 && report[1] === 0x55) report = report.slice(1);
  return parseReaderReport(report, expectedCommand);
}

function exchange(device, command, payload, timeoutMs) {
  device.write([0, ...buildRequest(command, payload)]);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const response = parseResponse(device.readTimeout(READ_SLICE_MS), command);
    if (response) return response;
  }
  return null;
}

function scanCard() {
  const descriptor = findReader();
  if (!descriptor) throw new Error("Connect the NFC-X reader to this PC.");
  const device = new HID.HID(descriptor.path);
  try {
    const probes = preferredCardType === "LF"
      ? [["LF", COMMAND_LF_AUTO_READ, [0, 0]], ["HF", COMMAND_HF_CARD_INFO, []]]
      : [["HF", COMMAND_HF_CARD_INFO, []], ["LF", COMMAND_LF_AUTO_READ, [0, 0]]];
    let payload = null;
    let cardType = preferredCardType;
    for (const [type, command, commandPayload] of probes) {
      cardType = type;
      payload = exchange(device, command, commandPayload, CARD_PROBE_TIMEOUT_MS[type]);
      if (payload?.length > 1 && payload[0] !== 0) break;
      payload = null;
    }
    if (!payload) throw new Error("No card detected. Hold the card on the reader and try again.");
    preferredCardType = cardType;
    return cardResult(cardType, payload, descriptor.product || "NFC-X reader");
  } finally {
    device.close();
  }
}

function sendJson(response, statusCode, body) {
  const data = JSON.stringify(body);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(data),
    "Cache-Control": "no-store",
  });
  response.end(data);
}

const server = http.createServer((request, response) => {
  if (!isBridgeRequestAuthorized(request.headers)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  if (request.method === "GET" && request.url === "/status") {
    const reader = findReader();
    sendJson(response, 200, {
      connected: Boolean(reader),
      reader: reader?.product || "Not connected",
    });
    return;
  }
  if (request.method === "POST" && request.url === "/scan") {
    try {
      sendJson(response, 200, scanCard());
    } catch (error) {
      sendJson(response, 503, { error: error.message || "The card could not be read." });
    }
    return;
  }
  sendJson(response, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`PATTS NFC-X bridge listening on http://${HOST}:${PORT}`);
  console.log(findReader() ? "NFC-X reader connected." : "Waiting for the NFC-X reader.");
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
