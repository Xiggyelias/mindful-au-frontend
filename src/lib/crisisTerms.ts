/**
 * Mirrors backend MentalHealthMlService::CRISIS_TERMS + normalization so
 * client-side scans align with server verification on POST /sessions/{id}/crisis-signal.
 */
export const CRISIS_TERMS: readonly string[] = [
  "suicide",
  "kill myself",
  "end my life",
  "self harm",
  "hurt myself",
  "jump off",
  "wish i were dead",
  "better off without me",
  "take my life",
  "dont want to live",
  "sleeping pills",
  "overdose",
  "goodbye everyone",
  "no more pain",
  "done with life",
  "cutting",
  "bleeding",
  "hanging",
] as const;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMatchedKeywords(normalizedMessage: string, terms: readonly string[]): string[] {
  const matches: string[] = [];
  for (const term of terms) {
    const needle = normalizeText(term);
    if (needle !== "" && normalizedMessage.includes(needle)) {
      matches.push(term);
    }
  }
  return [...new Set(matches)];
}

export function detectCrisisTermsInText(text: string): string[] {
  const normalized = normalizeText(text);
  if (normalized === "") {
    return [];
  }
  return getMatchedKeywords(normalized, CRISIS_TERMS);
}

/** True for E2E public key / session-key handshake envelopes — never crisis-scanned. */
export function isE2EHandshakeEnvelopeContent(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  try {
    const parsed = JSON.parse(trimmed) as { __e2e?: string; kind?: string };
    return (
      parsed.__e2e === "v1" && (parsed.kind === "pub" || parsed.kind === "key")
    );
  } catch {
    return false;
  }
}
