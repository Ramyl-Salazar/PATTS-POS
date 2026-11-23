import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { createAuthRecord, hexToBytes, PIN_LOCKOUT_MS, recordFailedPin, remainingLockoutMs, validatePin, verifyPin } from "./access.js";

test("creates and verifies a local teller access record", async () => {
  const auth = await createAuthRecord({
    tellerName: "  Bernard  ",
    pin: "2468",
    confirmPin: "2468",
    now: new Date("2026-10-15T00:00:00.000Z"),
    cryptoProvider: webcrypto,
  });
  assert.equal(auth.value.tellerName, "Bernard");
  assert.equal(auth.value.createdAt, "2026-10-15T00:00:00.000Z");
  assert.equal(await verifyPin("2468", auth, webcrypto), true);
  assert.equal(await verifyPin("1357", auth, webcrypto), false);
});

test("rejects invalid access input", () => {
  assert.throws(() => validatePin("123"), /4 to 8/);
  assert.throws(() => hexToBytes("not-hex"), /invalid/);
});

test("persists a timed lockout after five failed PINs", () => {
  const now = 1_000;
  let throttle = null;
  for (let attempt = 0; attempt < 5; attempt += 1) throttle = recordFailedPin(throttle, now);
  assert.equal(throttle.value.lockedUntil, now + PIN_LOCKOUT_MS);
  assert.equal(remainingLockoutMs(throttle, now + 1_000), PIN_LOCKOUT_MS - 1_000);
  assert.equal(remainingLockoutMs(throttle, now + PIN_LOCKOUT_MS), 0);
});
