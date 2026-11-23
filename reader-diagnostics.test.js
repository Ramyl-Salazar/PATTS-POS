import test from "node:test";
import assert from "node:assert/strict";
import { appendReaderDiagnostic, readerDiagnostic } from "./reader-diagnostics.js";

test("support report records relevant identifiers without wallet or personal data", () => {
  const entry = readerDiagnostic("repair_requested", { cardKey: "LF:AABB", cardType: "LF", reader: "NFC-X", secret: "omit" }, {
    id: "PRIVATE-ID", name: "PRIVATE-NAME", balance: 999, pin: "PRIVATE-PIN",
    cardKey: "HF:1122", cardType: "HF", cardAliases: ["LF:3344"],
  }, new Date("2026-11-04T00:00:00Z"));
  assert.deepEqual(entry, { event: "repair_requested", recordedAt: "2026-11-04T00:00:00.000Z", detectedKey: "LF:AABB", detectedType: "LF", reader: "NFC-X", savedKey: "HF:1122", savedType: "HF", savedAliases: ["LF:3344"] });
  let history = [];
  for (let i = 0; i < 30; i++) history = appendReaderDiagnostic(history, { ...entry, event: String(i) });
  assert.equal(history.length, 12);
  assert.equal(history[0].event, "18");
  assert.equal(history[11].event, "29");
});
