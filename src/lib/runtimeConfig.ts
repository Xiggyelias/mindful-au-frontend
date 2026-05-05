const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;
const VITE_DEV_SERVER_PORTS = new Set(["5173", "4173"]);
const LOCAL_DEV_API_BASE_URL = "http://127.0.0.1:8000/api";

const isLoopbackApiUrl = (value: string): boolean => {
  try {
    const resolved = new URL(value, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    return LOCAL_HOST_PATTERN.test(resolved.hostname);
  } catch {
    return false;
  }
};

export const resolveApiBaseUrl = (): string => {
  const configured = String(import.meta.env.VITE_API_URL ?? "").trim();
  if (configured !== "") {
    const normalized = trimTrailingSlash(configured);
    if (typeof window !== "undefined") {
      const isRemoteHost = !LOCAL_HOST_PATTERN.test(window.location.hostname);
      if (isRemoteHost && isLoopbackApiUrl(normalized)) {
        // Prevent accidental production builds pointing to localhost.
        return `${trimTrailingSlash(window.location.origin)}/api`;
      }
    }
    return normalized;
  }

  if (typeof window !== "undefined") {
    const origin = trimTrailingSlash(window.location.origin);
    const hostname = window.location.hostname;
    const port = window.location.port;

    // Keep local dev zero-config when frontend is on Vite dev server.
    if (LOCAL_HOST_PATTERN.test(hostname) && VITE_DEV_SERVER_PORTS.has(port)) {
      return LOCAL_DEV_API_BASE_URL;
    }

    // Production default: frontend and backend share the same host.
    return `${origin}/api`;
  }

  return "http://127.0.0.1:8000/api";
};

/**
 * Optional `tel:` link for the public landing page crisis line (E.164 or tel: URL).
 * Returns null when unset so we never ship a dummy/invalid hotline number in production.
 */
export const resolveCrisisHotlineTelHref = (): string | null => {
  const raw = String(import.meta.env.VITE_CRISIS_HOTLINE_TEL ?? "").trim();
  if (raw === "") {
    return null;
  }
  if (raw.toLowerCase().startsWith("tel:")) {
    return raw;
  }
  return `tel:${raw.replace(/\s+/g, "")}`;
};
