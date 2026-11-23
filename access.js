export const PIN_PATTERN = /^\d{4,8}$/;
export const PIN_HASH_ITERATIONS = 150000;
export const PIN_ATTEMPT_LIMIT = 5;
export const PIN_LOCKOUT_MS = 30_000;

export const bytesToHex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

export function hexToBytes(value) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) throw new Error("Stored access data is invalid.");
  return new Uint8Array(value.match(/.{2}/g).map((pair) => Number.parseInt(pair, 16)));
}

export function validatePin(pin) {
  if (!PIN_PATTERN.test(pin)) throw new Error("Use a PIN containing 4 to 8 digits.");
  return pin;
}

export async function derivePinHash(pin, salt, cryptoProvider = globalThis.crypto) {
  validatePin(pin);
  const key = await cryptoProvider.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await cryptoProvider.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PIN_HASH_ITERATIONS }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

export function hashesMatch(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function createAuthRecord({ tellerName, pin, confirmPin, now = new Date(), cryptoProvider = globalThis.crypto }) {
  const normalizedName = String(tellerName).trim();
  validatePin(pin);
  if (!normalizedName) throw new Error("Enter the teller name.");
  if (pin !== confirmPin) throw new Error("The PIN entries do not match.");
  const salt = cryptoProvider.getRandomValues(new Uint8Array(16));
  return {
    key: "auth",
    value: {
      tellerName: normalizedName,
      salt: bytesToHex(salt),
      hash: await derivePinHash(pin, salt, cryptoProvider),
      createdAt: now.toISOString(),
    },
  };
}

export async function verifyPin(pin, authRecord, cryptoProvider = globalThis.crypto) {
  validatePin(pin);
  const attemptedHash = await derivePinHash(pin, hexToBytes(authRecord.value.salt), cryptoProvider);
  return hashesMatch(attemptedHash, authRecord.value.hash);
}

export function remainingLockoutMs(throttle, now = Date.now()) {
  return Math.max(0, Number(throttle?.value?.lockedUntil || 0) - now);
}

export function recordFailedPin(throttle, now = Date.now()) {
  const previousFailures = Number.isSafeInteger(throttle?.value?.failures) ? throttle.value.failures : 0;
  const failures = previousFailures + 1;
  if (failures >= PIN_ATTEMPT_LIMIT) {
    return { key: "authThrottle", value: { failures: 0, lockedUntil: now + PIN_LOCKOUT_MS } };
  }
  return { key: "authThrottle", value: { failures, lockedUntil: 0 } };
}
