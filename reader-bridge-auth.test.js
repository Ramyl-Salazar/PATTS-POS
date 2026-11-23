import test from "node:test";
import assert from "node:assert/strict";
import { BRIDGE_CLIENT, BRIDGE_HEADER, isBridgeRequestAuthorized } from "./scripts/reader-bridge-auth.mjs";

test("authorizes only the expected emulator bridge caller", () => {
  const valid = { host: "10.0.2.2:8765", [BRIDGE_HEADER]: BRIDGE_CLIENT };
  assert.equal(isBridgeRequestAuthorized(valid), true);
  assert.equal(isBridgeRequestAuthorized({ host: "127.0.0.1:8765" }), false);
  assert.equal(isBridgeRequestAuthorized({ ...valid, origin: "https://attacker.example" }), false);
  assert.equal(isBridgeRequestAuthorized({ ...valid, host: "attacker.example" }), false);
});
