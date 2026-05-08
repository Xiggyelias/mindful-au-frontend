import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { registerServiceWorker } from "@/lib/pwa/registerServiceWorker";
import { getChatPerfMetrics, resetChatPerfMetrics } from "@/lib/chatPerfMetrics";

declare global {
  interface Window {
    __mindfulChatPerf?: {
      get: typeof getChatPerfMetrics;
      reset: typeof resetChatPerfMetrics;
    };
  }
}

registerServiceWorker();

if (import.meta.env.DEV) {
  window.__mindfulChatPerf = {
    get: getChatPerfMetrics,
    reset: resetChatPerfMetrics,
  };
}

createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
