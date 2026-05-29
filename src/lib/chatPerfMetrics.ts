type ChatPerfCounters = {
  prefetchAttempts: number;
  prefetchSuccess: number;
  warmHydrateHits: number;
  warmHydrateMisses: number;
  openLatencySamples: number;
  openLatencyTotalMs: number;
  latencyBuckets: {
    lt500: number;
    ms500to1000: number;
    ms1000to2000: number;
    gte2000: number;
  };
  perSessionOpen: Record<
    string,
    {
      samples: number;
      totalMs: number;
      lastMs: number;
      recentMs?: number[];
    }
  >;
  recentOpenLatencies: number[];
};

const STORAGE_KEY = "mindful:chat-perf-metrics:v1";
const RECENT_WINDOW_SIZE = 50;
const RECENT_SESSION_WINDOW_SIZE = 15;
const TREND_SLICE_SIZE = 10;

function emptyCounters(): ChatPerfCounters {
  return {
    prefetchAttempts: 0,
    prefetchSuccess: 0,
    warmHydrateHits: 0,
    warmHydrateMisses: 0,
    openLatencySamples: 0,
    openLatencyTotalMs: 0,
    latencyBuckets: {
      lt500: 0,
      ms500to1000: 0,
      ms1000to2000: 0,
      gte2000: 0,
    },
    perSessionOpen: {},
    recentOpenLatencies: [],
  };
}

function readCounters(): ChatPerfCounters {
  if (typeof localStorage === "undefined") return emptyCounters();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyCounters();
    const parsed = JSON.parse(raw) as Partial<ChatPerfCounters>;
    return {
      prefetchAttempts: Number(parsed.prefetchAttempts || 0),
      prefetchSuccess: Number(parsed.prefetchSuccess || 0),
      warmHydrateHits: Number(parsed.warmHydrateHits || 0),
      warmHydrateMisses: Number(parsed.warmHydrateMisses || 0),
      openLatencySamples: Number(parsed.openLatencySamples || 0),
      openLatencyTotalMs: Number(parsed.openLatencyTotalMs || 0),
      latencyBuckets: {
        lt500: Number(parsed.latencyBuckets?.lt500 || 0),
        ms500to1000: Number(parsed.latencyBuckets?.ms500to1000 || 0),
        ms1000to2000: Number(parsed.latencyBuckets?.ms1000to2000 || 0),
        gte2000: Number(parsed.latencyBuckets?.gte2000 || 0),
      },
      perSessionOpen:
        parsed.perSessionOpen && typeof parsed.perSessionOpen === "object"
          ? parsed.perSessionOpen
          : {},
      recentOpenLatencies: Array.isArray(parsed.recentOpenLatencies)
        ? parsed.recentOpenLatencies
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value >= 0)
            .slice(-RECENT_WINDOW_SIZE)
        : [],
    };
  } catch {
    return emptyCounters();
  }
}

function writeCounters(next: ChatPerfCounters): void {
  if (typeof localStorage === "undefined") return;
  const capped: ChatPerfCounters = {
    ...next,
    perSessionOpen: Object.fromEntries(
      Object.entries(next.perSessionOpen).slice(-20)
    ),
    recentOpenLatencies: next.recentOpenLatencies.slice(-RECENT_WINDOW_SIZE),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch {
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyCounters()));
    } catch {
      // best effort only
    }
  }
}

function mutateCounters(mutator: (current: ChatPerfCounters) => ChatPerfCounters): void {
  const current = readCounters();
  const next = mutator(current);
  writeCounters(next);
  if (import.meta.env.DEV) {
    const avgOpenLatencyMs =
      next.openLatencySamples > 0 ? Math.round(next.openLatencyTotalMs / next.openLatencySamples) : 0;
    console.debug("[chat-perf]", {
      ...next,
      avgOpenLatencyMs,
    });
  }
}

export function recordPrefetchAttempt(): void {
  mutateCounters((current) => ({
    ...current,
    prefetchAttempts: current.prefetchAttempts + 1,
  }));
}

export function recordPrefetchResult(success: boolean): void {
  if (!success) return;
  mutateCounters((current) => ({
    ...current,
    prefetchSuccess: current.prefetchSuccess + 1,
  }));
}

export function recordWarmHydrateResult(hit: boolean): void {
  mutateCounters((current) => ({
    ...current,
    warmHydrateHits: current.warmHydrateHits + (hit ? 1 : 0),
    warmHydrateMisses: current.warmHydrateMisses + (hit ? 0 : 1),
  }));
}

export function recordChatOpenLatency(elapsedMs: number, sessionId?: string | null): void {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return;
  const normalizedSessionId = String(sessionId || "").trim();
  mutateCounters((current) => ({
    ...current,
    openLatencySamples: current.openLatencySamples + 1,
    openLatencyTotalMs: current.openLatencyTotalMs + elapsedMs,
    latencyBuckets: {
      lt500: current.latencyBuckets.lt500 + (elapsedMs < 500 ? 1 : 0),
      ms500to1000: current.latencyBuckets.ms500to1000 + (elapsedMs >= 500 && elapsedMs < 1000 ? 1 : 0),
      ms1000to2000: current.latencyBuckets.ms1000to2000 + (elapsedMs >= 1000 && elapsedMs < 2000 ? 1 : 0),
      gte2000: current.latencyBuckets.gte2000 + (elapsedMs >= 2000 ? 1 : 0),
    },
    perSessionOpen: normalizedSessionId
      ? {
          ...current.perSessionOpen,
          [normalizedSessionId]: {
            samples: Number(current.perSessionOpen[normalizedSessionId]?.samples || 0) + 1,
            totalMs: Number(current.perSessionOpen[normalizedSessionId]?.totalMs || 0) + elapsedMs,
            lastMs: elapsedMs,
            recentMs: [
              ...((current.perSessionOpen[normalizedSessionId] as { recentMs?: number[] } | undefined)
                ?.recentMs || []),
              elapsedMs,
            ].slice(-RECENT_SESSION_WINDOW_SIZE),
          },
        }
      : current.perSessionOpen,
    recentOpenLatencies: [...current.recentOpenLatencies, elapsedMs].slice(-RECENT_WINDOW_SIZE),
  }));
}

export function getChatPerfMetrics(): ChatPerfCounters & {
  avgOpenLatencyMs: number;
  recentAvgOpenLatencyMs: number;
  recentTrend: {
    status: "improving" | "stable" | "regressing" | "insufficient_data";
    deltaMs: number;
    latestAvgMs: number;
    previousAvgMs: number;
  };
  topSlowSessions: Array<{
    sessionId: string;
    avgMs: number;
    recentAvgMs: number;
    samples: number;
    lastMs: number;
  }>;
} {
  const counters = readCounters();
  const avgOpenLatencyMs =
    counters.openLatencySamples > 0
      ? Math.round(counters.openLatencyTotalMs / counters.openLatencySamples)
      : 0;
  const recentAvgOpenLatencyMs =
    counters.recentOpenLatencies.length > 0
      ? Math.round(
          counters.recentOpenLatencies.reduce((sum, value) => sum + value, 0)
            / counters.recentOpenLatencies.length
        )
      : 0;
  const topSlowSessions = Object.entries(counters.perSessionOpen)
    .map(([sessionId, row]) => {
      const samples = Number(row?.samples || 0);
      const totalMs = Number(row?.totalMs || 0);
      const recent = Array.isArray((row as { recentMs?: number[] }).recentMs)
        ? (row as { recentMs?: number[] }).recentMs || []
        : [];
      const recentAvgMs =
        recent.length > 0
          ? Math.round(recent.reduce((sum, value) => sum + Number(value || 0), 0) / recent.length)
          : 0;
      return {
        sessionId,
        samples,
        lastMs: Number(row?.lastMs || 0),
        avgMs: samples > 0 ? Math.round(totalMs / samples) : 0,
        recentAvgMs,
      };
    })
    .sort((a, b) => b.recentAvgMs - a.recentAvgMs || b.avgMs - a.avgMs)
    .slice(0, 3);
  const recent = counters.recentOpenLatencies;
  const latest = recent.slice(-TREND_SLICE_SIZE);
  const previous = recent.slice(-(TREND_SLICE_SIZE * 2), -TREND_SLICE_SIZE);
  const latestAvgMs =
    latest.length > 0
      ? Math.round(latest.reduce((sum, value) => sum + value, 0) / latest.length)
      : 0;
  const previousAvgMs =
    previous.length > 0
      ? Math.round(previous.reduce((sum, value) => sum + value, 0) / previous.length)
      : 0;
  const deltaMs = latestAvgMs - previousAvgMs;
  const status: "improving" | "stable" | "regressing" | "insufficient_data" =
    latest.length < TREND_SLICE_SIZE || previous.length < TREND_SLICE_SIZE
      ? "insufficient_data"
      : deltaMs <= -75
        ? "improving"
        : deltaMs >= 75
          ? "regressing"
          : "stable";
  return {
    ...counters,
    avgOpenLatencyMs,
    recentAvgOpenLatencyMs,
    recentTrend: {
      status,
      deltaMs,
      latestAvgMs,
      previousAvgMs,
    },
    topSlowSessions,
  };
}

export function resetChatPerfMetrics(): void {
  writeCounters(emptyCounters());
}
