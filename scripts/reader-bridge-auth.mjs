export const BRIDGE_HEADER = "x-patts-bridge";
export const BRIDGE_CLIENT = "patts-emulator-v1";

const ALLOWED_HOSTS = new Set(["127.0.0.1:8765", "localhost:8765", "10.0.2.2:8765"]);

export function isBridgeRequestAuthorized(headers = {}) {
  const get = (name) => typeof headers.get === "function" ? headers.get(name) : headers[name];
  return !get("origin")
    && ALLOWED_HOSTS.has(String(get("host") || "").toLowerCase())
    && get(BRIDGE_HEADER) === BRIDGE_CLIENT;
}
