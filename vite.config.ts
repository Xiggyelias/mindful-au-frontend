import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    // Keep dev server loopback-only by default to reduce LAN/browser-origin attack surface.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
  },
  plugins: [react()],
  build: {
    cssCodeSplit: true,
    // Largest shared vendor chunk after manualChunks; tune before raising further.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // Keep React and router in the default vendor graph.
          // Splitting them out caused a vendor <-> react-core circular chunk warning.
          if (id.includes("@radix-ui")) return "ui-radix";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("@tanstack/react-query")) return "react-query";
          if (id.includes("recharts")) return "charts";
          if (id.includes("framer-motion")) return "framer-motion";
          // Keep lucide with consuming chunks — a separate icons-lucide chunk caused
          // ReferenceError (e.g. Heart is not defined) on lazy-loaded routes.
          if (id.includes("lucide-react")) return;
          if (id.includes("date-fns")) return "date-fns";
          if (id.includes("axios")) return "axios";
          return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
