const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "");

const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;
const VITE_DEV_SERVER_PORTS = new Set(["5173", "4173"]);
const LOCAL_DEV_API_BASE_URL = "http://127.0.0.1:8000/api";
const PRODUCTION_API_BASE_URL = "https://mindfulapi.africau.co.zw/api";

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
    const hostname = window.location.hostname;
    const port = window.location.port;

    // Keep local dev zero-config when frontend is on Vite dev server.
    if (LOCAL_HOST_PATTERN.test(hostname) && VITE_DEV_SERVER_PORTS.has(port)) {
      return LOCAL_DEV_API_BASE_URL;
    }

    // Production default for the deployed AU counseling app. Builds can still
    // override this with VITE_API_URL for forks, staging, or same-host setups.
    return PRODUCTION_API_BASE_URL;
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

/**
 * Institution display name used in copyright notices, login help text, and email examples.
 * Override with VITE_INSTITUTION_NAME for forks / rebranding.
 */
export const resolveInstitutionName = (): string =>
  String(import.meta.env.VITE_INSTITUTION_NAME ?? "").trim() || "Africa University";

/**
 * Primary email domain shown as example on login pages and help text.
 * Override with VITE_INSTITUTION_EMAIL_DOMAIN.
 */
export const resolveInstitutionEmailDomain = (): string =>
  String(import.meta.env.VITE_INSTITUTION_EMAIL_DOMAIN ?? "").trim() || "africau.edu";

/**
 * Emergency / on-call counselor telephone number shown on the student dashboard.
 * Set VITE_COUNSELOR_PHONE to override (E.164 or any tel: value).
 * Returns null when not configured — caller should hide the "Call Now" button.
 */
export const resolveCounselorPhone = (): string | null => {
  const raw = String(import.meta.env.VITE_COUNSELOR_PHONE ?? "").trim();
  if (raw === "") return null;
  if (raw.toLowerCase().startsWith("tel:")) return raw;
  return `tel:${raw.replace(/\s+/g, "")}`;
};
