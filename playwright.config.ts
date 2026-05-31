import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.CMS_E2E_BASE_URL ?? "http://127.0.0.1:4173";
const appURL = new URL(baseURL);
const appPort = appURL.port || (appURL.protocol === "https:" ? "443" : "80");
const apiBaseURL = process.env.CMS_E2E_API_URL ?? "http://127.0.0.1:8000/api";
const apiURL = new URL(apiBaseURL);
const apiPort = apiURL.port || (apiURL.protocol === "https:" ? "443" : "80");
const apiHealthURL = new URL("health", apiBaseURL.endsWith("/") ? apiBaseURL : `${apiBaseURL}/`).toString();
const backendRoot = path.resolve(process.env.CMS_BACKEND_DIR ?? "../mindful-au-backend");
const reportRoot = path.resolve(
  process.env.CMS_E2E_REPORT_DIR ?? path.join(backendRoot, "storage", "testing", "reports"),
);
const runFullMatrix = process.env.CMS_E2E_FULL_MATRIX === "1";
const skipBackendServer = process.env.CMS_E2E_SKIP_BACKEND === "1";

const projects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ...(runFullMatrix
    ? [
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
        { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
      ]
    : []),
];

export default defineConfig({
  testDir: "./e2e",
  outputDir: path.join(reportRoot, "test-results"),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(reportRoot, "playwright-html") }],
    ["json", { outputFile: path.join(reportRoot, "playwright-results.json") }],
    ["junit", { outputFile: path.join(reportRoot, "playwright-junit.xml") }],
  ],
  use: {
    baseURL,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects,
  webServer: [
    ...(!skipBackendServer
      ? [
          {
            command: `php artisan serve --host=${apiURL.hostname} --port=${apiPort}`,
            cwd: backendRoot,
            env: {
              ...process.env,
              FRONTEND_URL: process.env.FRONTEND_URL ?? baseURL,
              CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS ?? baseURL,
            },
            url: apiHealthURL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
        ]
      : []),
    {
      command: `vite preview --host ${appURL.hostname} --port ${appPort} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
