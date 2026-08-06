const DEFAULT_TIMEOUT_MS = 20_000;
const SERVICE_HEADER = "X-Nuvio-Service-Token";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function proxyOrigin(value) {
  assert(typeof value === "string" && value.trim(), "PEOPLE_HERO_PROXY_URL is required");
  const url = new URL(value.trim());
  assert(url.protocol === "https:", "PEOPLE_HERO_PROXY_URL must use HTTPS");
  assert(url.username === "" && url.password === "" && url.port === "" && url.pathname === "/" && !url.search && !url.hash,
    "PEOPLE_HERO_PROXY_URL must be an HTTPS origin without credentials, port, path, query, or fragment");
  return url.origin;
}

export function createTmdbProxyClient({
  baseUrl = process.env.PEOPLE_HERO_PROXY_URL,
  serviceToken = process.env.PEOPLE_HERO_PROXY_TOKEN,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const origin = proxyOrigin(baseUrl);
  assert(typeof fetchImpl === "function", "A fetch implementation is required");
  assert(Number.isFinite(timeoutMs) && timeoutMs > 0, "timeoutMs must be positive");
  assert(serviceToken === undefined || (typeof serviceToken === "string" && serviceToken.trim()),
    "PEOPLE_HERO_PROXY_TOKEN cannot be blank when supplied");

  async function getPersonSnapshot(personId) {
    assert(Number.isSafeInteger(personId) && personId > 0, "personId must be a positive safe integer");
    const url = new URL(`/3/person/${personId}`, origin);
    url.searchParams.set("append_to_response", "combined_credits,images");
    url.searchParams.set("include_image_language", "en,null");
    url.searchParams.set("language", "en-US");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { Accept: "application/json" };
    if (serviceToken) headers[SERVICE_HEADER] = serviceToken;

    let response;
    try {
      response = await fetchImpl(url, { method: "GET", headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`People metadata proxy returned HTTP ${response.status}`);
    const payload = await response.json();
    assert(payload && payload.id === personId, "People metadata proxy returned the wrong identity");
    return payload;
  }

  return Object.freeze({ getPersonSnapshot });
}

export const tmdbProxyServiceHeader = SERVICE_HEADER;
