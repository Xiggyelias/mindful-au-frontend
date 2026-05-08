import { useEffect, useMemo, useState } from "react";
import { getChatPerfMetrics, resetChatPerfMetrics } from "@/lib/chatPerfMetrics";

const REFRESH_MS = 2000;

type ImportedSnapshot = {
  exportedAt?: string;
  metrics?: {
    recentAvgOpenLatencyMs?: number;
    avgOpenLatencyMs?: number;
    warmHydrateHits?: number;
    warmHydrateMisses?: number;
    prefetchAttempts?: number;
    prefetchSuccess?: number;
  };
};

export function ChatPerfDevBadge() {
  const [metrics, setMetrics] = useState(() => getChatPerfMetrics());
  const [baseline, setBaseline] = useState<ImportedSnapshot | null>(null);

  useEffect(() => {
    const sync = () => setMetrics(getChatPerfMetrics());
    sync();
    const timer = window.setInterval(sync, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);

  const warmHitRate = useMemo(() => {
    const total = metrics.warmHydrateHits + metrics.warmHydrateMisses;
    if (total <= 0) return 0;
    return Math.round((metrics.warmHydrateHits / total) * 100);
  }, [metrics.warmHydrateHits, metrics.warmHydrateMisses]);

  const prefetchSuccessRate = useMemo(() => {
    if (metrics.prefetchAttempts <= 0) return 0;
    return Math.round((metrics.prefetchSuccess / metrics.prefetchAttempts) * 100);
  }, [metrics.prefetchAttempts, metrics.prefetchSuccess]);

  const trendLabel = useMemo(() => {
    if (metrics.recentTrend.status === "improving") return "Improving";
    if (metrics.recentTrend.status === "regressing") return "Regressing";
    if (metrics.recentTrend.status === "stable") return "Stable";
    return "Collecting";
  }, [metrics.recentTrend.status]);

  const trendClassName = useMemo(() => {
    if (metrics.recentTrend.status === "improving") return "text-emerald-300";
    if (metrics.recentTrend.status === "regressing") return "text-rose-300";
    if (metrics.recentTrend.status === "stable") return "text-amber-200";
    return "text-cyan-200/90";
  }, [metrics.recentTrend.status]);

  const latencySparkline = useMemo(() => {
    const window = metrics.recentOpenLatencies.slice(-12);
    if (window.length === 0) return "n/a";
    const min = Math.min(...window);
    const max = Math.max(...window);
    const spread = Math.max(1, max - min);
    const glyphs = [".", ":", "-", "=", "+", "*", "#", "@"];
    return window
      .map((value) => {
        const idx = Math.min(
          glyphs.length - 1,
          Math.max(0, Math.round(((value - min) / spread) * (glyphs.length - 1)))
        );
        return glyphs[idx];
      })
      .join("");
  }, [metrics.recentOpenLatencies]);

  const handleExport = () => {
    const snapshot = getChatPerfMetrics();
    const payload = {
      exportedAt: new Date().toISOString(),
      metrics: snapshot,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chat-perf-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSnapshot = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as ImportedSnapshot;
      if (!parsed || typeof parsed !== "object" || !parsed.metrics) return;
      setBaseline(parsed);
    } catch {
      // ignore invalid import files
    }
  };

  const baselineWarmHitRate = useMemo(() => {
    const hits = Number(baseline?.metrics?.warmHydrateHits || 0);
    const misses = Number(baseline?.metrics?.warmHydrateMisses || 0);
    const total = hits + misses;
    if (total <= 0) return 0;
    return Math.round((hits / total) * 100);
  }, [baseline]);

  const baselinePrefetchRate = useMemo(() => {
    const attempts = Number(baseline?.metrics?.prefetchAttempts || 0);
    const success = Number(baseline?.metrics?.prefetchSuccess || 0);
    if (attempts <= 0) return 0;
    return Math.round((success / attempts) * 100);
  }, [baseline]);

  return (
    <div className="fixed bottom-3 right-3 z-[1000] rounded-md border border-cyan-300 bg-cyan-950/90 px-3 py-2 text-[11px] text-cyan-100 shadow-lg backdrop-blur">
      <div className="mb-1 font-semibold tracking-wide text-cyan-200">Chat Perf (DEV)</div>
      <div>Avg open (recent): {metrics.recentAvgOpenLatencyMs}ms</div>
      <div className="text-[10px] text-cyan-200/90">Lifetime avg: {metrics.avgOpenLatencyMs}ms</div>
      <div className={`text-[10px] ${trendClassName}`}>
        Trend: {trendLabel}
        {metrics.recentTrend.status !== "insufficient_data" && (
          <> ({metrics.recentTrend.deltaMs > 0 ? "+" : ""}{metrics.recentTrend.deltaMs}ms)</>
        )}
      </div>
      <div className="text-[10px] text-cyan-200/90">Recent: {latencySparkline}</div>
      <div>Warm hit: {warmHitRate}%</div>
      <div>Prefetch ok: {prefetchSuccessRate}%</div>
      <div className="mt-1 text-[10px] text-cyan-200/90">
        Buckets: &lt;500 {metrics.latencyBuckets.lt500} | 500-1k {metrics.latencyBuckets.ms500to1000} | 1k-2k{" "}
        {metrics.latencyBuckets.ms1000to2000} | 2k+ {metrics.latencyBuckets.gte2000}
      </div>
      {metrics.topSlowSessions.length > 0 && (
        <div className="mt-1 text-[10px] text-cyan-100/95">
          <div className="font-semibold text-cyan-200">Slow sessions</div>
          {metrics.topSlowSessions.map((item) => (
            <div key={item.sessionId}>
              {item.sessionId}: {item.recentAvgMs || item.avgMs}ms ({item.samples}x)
            </div>
          ))}
        </div>
      )}
      {baseline?.metrics && (
        <div className="mt-1 text-[10px] text-cyan-100/95">
          <div className="font-semibold text-cyan-200">Compare vs imported</div>
          <div>
            Recent avg: {metrics.recentAvgOpenLatencyMs - Number(baseline.metrics.recentAvgOpenLatencyMs || 0)}ms
          </div>
          <div>Warm hit: {warmHitRate - baselineWarmHitRate}%</div>
          <div>Prefetch ok: {prefetchSuccessRate - baselinePrefetchRate}%</div>
          <div className="text-cyan-200/80">Baseline: {baseline.exportedAt || "unknown time"}</div>
        </div>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          className="rounded border border-cyan-400 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-800/60"
          onClick={handleExport}
        >
          Export
        </button>
        <label className="cursor-pointer rounded border border-cyan-400 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-800/60">
          Import
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              void handleImportSnapshot(file);
              event.currentTarget.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="rounded border border-cyan-400 px-2 py-0.5 text-[10px] font-semibold text-cyan-100 hover:bg-cyan-800/60"
          onClick={() => {
            resetChatPerfMetrics();
            setMetrics(getChatPerfMetrics());
          }}
        >
          Reset
        </button>
      </div>
    </div>
  );
}
