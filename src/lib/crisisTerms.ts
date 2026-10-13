/**
 * Mirrors backend MentalHealthMlService::CRISIS_TERMS + normalization so
 * client-side scans align with server verification on POST /sessions/{id}/crisis-signal.
 */
export const CRISIS_TERMS: readonly string[] = [
  // Explicit self-harm/suicide signals
  "suicide",
  "kill myself",
  "end my life",
  "self harm",
  "hurt myself",
  "jump off",
  "wish i were dead",
  "better off without me",
  "take my life",
  "take my own life",
  "dont want to live",
  "sleeping pills",
  "overdose",
  "goodbye everyone",
  "no more pain",
  "done with life",
  "cutting myself",
  "cutting",
  "cut myself",
  "bleeding",
  "hanging",
  "hanging myself",
  "slit my wrist",
  "shoot myself",
  "drown myself",
  "bleed out",
  // Additional high-risk university crisis phrases
  "want to die",
  "don t want to be here",
  "not worth living",
  "life is not worth",
  "ending it all",
  "end it all",
  "rather be dead",
  "die by suicide",
  "suicidal thoughts",
  "suicidal ideation",
  "no reason to live",
  "give up on life",
  "make it stop forever",
  "just want it all to end",
  "leave everything behind",
  "nobody would miss me",
  "tired of being alive",
  "can t keep living like this",
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
