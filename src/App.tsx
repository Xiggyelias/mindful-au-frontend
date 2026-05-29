import { Suspense, lazy, useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { BandwidthProvider } from "@/hooks/useBandwidthMode";
import { ConfirmDialogProvider } from "@/hooks/useConfirm";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScreenshotShield } from "@/components/ScreenshotShield";
import { ChatIncomingNotificationHost } from "@/components/chat/ChatIncomingNotificationHost";
import { IncomingCallHost } from "@/components/call/IncomingCallHost";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";
import { PushNotificationPrompt } from "@/components/pwa/PushNotificationPrompt";
import { ChatPerfDevBadge } from "@/components/dev/ChatPerfDevBadge";

import { lazyWithRetry, clearLazyRetryGuard } from "@/lib/lazyWithRetry";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { Button } from "@/components/ui/button";

// Preload critical pages after initial render for instant navigation
// This runs after the app mounts and doesn't block the initial render
const preloadCriticalPages = () => {
  // Use requestIdleCallback to not block the main thread
  const doPreload = () => {
    // Preload the most visited pages
    const preloaders = [
      () => import("./pages/student/StudentDashboard"),
      () => import("./pages/student/StudentChat"),
      () => import("./pages/counselor/CounselorDashboard"),
      () => import("./pages/counselor/CounselorMessages"),
    ];
    
    preloaders.forEach((fn, i) => {
      setTimeout(() => fn().catch(() => {}), 500 + i * 200);
    });
  };
  
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(doPreload, { timeout: 2000 });
  } else {
    setTimeout(doPreload, 500);
  }
};

const Index = lazyWithRetry(() => import("./pages/Index"));
const OAuthCallback = lazyWithRetry(() => import("./pages/auth/OAuthCallback"));
const NotFound = lazyWithRetry(() => import("./pages/NotFound"));

const StudentLogin = lazyWithRetry(() => import("./pages/student/StudentLogin"));
const StudentDashboard = lazyWithRetry(() => import("./pages/student/StudentDashboard"));
const StudentChat = lazyWithRetry(() => import("./pages/student/StudentChat"));
const StudentAppointments = lazyWithRetry(() => import("./pages/student/StudentAppointments"));
const StudentAISupport = lazyWithRetry(() => import("./pages/student/StudentAISupport"));
const StudentVideoCall = lazyWithRetry(() => import("./pages/student/StudentVideoCall"));
const StudentHistory = lazyWithRetry(() => import("./pages/student/StudentHistory"));
const StudentWellness = lazyWithRetry(() => import("./pages/student/StudentWellness"));
const StudentDiagnosticAssessment = lazyWithRetry(() => import("./pages/student/StudentDiagnosticAssessment"));
// Dev-only OpenRouter chat tester. Tree-shaken out of production builds.
const ChatTestPage = import.meta.env.DEV
  ? lazyWithRetry(() => import("./pages/ChatTestPage").then((mod) => ({ default: mod.ChatTestPage })))
  : null;

const CounselorLogin = lazyWithRetry(() => import("./pages/counselor/CounselorLogin"));
const CounselorRegister = lazyWithRetry(() => import("./pages/counselor/CounselorRegister"));
const CounselorDashboard = lazyWithRetry(() => import("./pages/counselor/CounselorDashboard"));
const CounselorMessages = lazyWithRetry(() => import("./pages/counselor/CounselorMessages"));
const CounselorMessagesPortal = lazyWithRetry(() => import("./pages/counselor/CounselorMessagesPortal"));
const CounselorAppointments = lazyWithRetry(() => import("./pages/counselor/CounselorAppointments"));
const CounselorStudents = lazyWithRetry(() => import("./pages/counselor/CounselorStudents"));
const CounselorAIInsights = lazyWithRetry(() => import("./pages/counselor/CounselorAIInsights"));
const CounselorVideo = lazyWithRetry(() => import("./pages/counselor/CounselorVideo"));
const CounselorNotes = lazyWithRetry(() => import("./pages/counselor/CounselorNotes"));
const CounselorWellness = lazyWithRetry(() => import("./pages/counselor/CounselorWellness"));
const CounselorAlerts = lazyWithRetry(() => import("./pages/counselor/CounselorAlerts"));
const CounselorTwoFactor = lazyWithRetry(() => import("./pages/counselor/CounselorTwoFactor"));
const PeerLogin = lazyWithRetry(() => import("./pages/peer/PeerLogin"));
const PeerDashboard = lazyWithRetry(() => import("./pages/peer/PeerDashboard"));
const PeerEscalatedCases = lazyWithRetry(() => import("./pages/peer/PeerEscalatedCases"));
const PeerEthics = lazyWithRetry(() => import("./pages/peer/PeerEthics"));
const PeerProfile = lazyWithRetry(() => import("./pages/peer/PeerProfile"));

const AdminLogin = lazyWithRetry(() => import("./pages/admin/AdminLogin"));
const AdminRegister = lazyWithRetry(() => import("./pages/admin/AdminRegister"));
const AdminDashboard = lazyWithRetry(() => import("./pages/admin/AdminDashboard"));
const AdminStudents = lazyWithRetry(() => import("./pages/admin/AdminStudents"));
const AdminCounselors = lazyWithRetry(() => import("./pages/admin/AdminCounselors"));
const AdminAnalytics = lazyWithRetry(() => import("./pages/admin/AdminAnalytics"));
const AdminAIReports = lazyWithRetry(() => import("./pages/admin/AdminAIReports"));
const AdminAlerts = lazyWithRetry(() => import("./pages/admin/AdminAlerts"));
const AdminLogs = lazyWithRetry(() => import("./pages/admin/AdminLogs"));
const AdminSettings = lazyWithRetry(() => import("./pages/admin/AdminSettings"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

const RouteLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <div className="flex flex-col items-center gap-3">
      {/* Faster spinner - use CSS animation instead of border trick */}
      <div className="relative h-10 w-10">
        <div className="absolute inset-0 rounded-full border-3 border-primary/20" />
        <div className="absolute inset-0 rounded-full border-3 border-primary border-t-transparent animate-spin" />
      </div>
      <p className="text-sm text-muted-foreground animate-pulse">Loading...</p>
    </div>
  </div>
);

const LazyRouteErrorFallback = () => (
  <div className="min-h-screen bg-background flex items-center justify-center p-6">
    <div className="max-w-md w-full rounded-2xl border border-border bg-card p-8 text-center space-y-4">
      <h2 className="text-lg font-semibold">This page did not load</h2>
      <p className="text-sm text-muted-foreground">
        That usually means the app was updated in the background. Reload to fetch the latest version.
      </p>
      <Button
        type="button"
        onClick={() => {
          clearLazyRetryGuard();
          window.location.reload();
        }}
      >
        Reload app
      </Button>
    </div>
  </div>
);

const App = () => {
  // Trigger critical pages preload after initial render
  useEffect(() => {
    preloadCriticalPages();
  }, []);
  
  return (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <BandwidthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter
            future={{
              v7_startTransition: true,
              v7_relativeSplatPath: true,
            }}
          >
            <AuthProvider>
              <ConfirmDialogProvider>
              <ChatIncomingNotificationHost />
              <IncomingCallHost />
              <PushNotificationPrompt />
              <PwaInstallBanner />
              {import.meta.env.DEV && <ChatPerfDevBadge />}
              <ScreenshotShield />
              <ErrorBoundary fallback={<LazyRouteErrorFallback />}>
              <Suspense fallback={<RouteLoader />}>
                <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/oauth/callback" element={<OAuthCallback />} />

                <Route path="/student/login" element={<StudentLogin />} />
                <Route
                  path="/student/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/chat"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentChat />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/appointments"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentAppointments />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/ai-support"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentAISupport />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/video-call"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentVideoCall />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/history"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentHistory />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/wellness"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentWellness />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/student/diagnostic-assessment"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentDiagnosticAssessment />
                    </ProtectedRoute>
                  }
                />
                <Route path="/counselor/login" element={<CounselorLogin />} />
                <Route path="/peer/login" element={<PeerLogin />} />
                <Route path="/peer/messages" element={<Navigate to="/peer/chats" replace />} />
                <Route path="/peer/chat" element={<Navigate to="/peer/chats" replace />} />
                <Route
                  path="/peer/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <PeerDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/peer/chats"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <CounselorMessages />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/peer/escalations"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <PeerEscalatedCases />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/peer/ethics"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <PeerEthics />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/peer/profile"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <PeerProfile />
                    </ProtectedRoute>
                  }
                />
                <Route path="/counselor/register" element={<CounselorRegister />} />
                <Route
                  path="/peer/2fa"
                  element={
                    <ProtectedRoute allowedRoles={["peer_counselor"]} redirectTo="/peer/login">
                      <CounselorTwoFactor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/2fa"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorTwoFactor />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/messages"
                  element={
                    <ProtectedRoute allowedRoles={["counselor", "peer_counselor"]} redirectTo="/counselor/login">
                      <CounselorMessagesPortal />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/appointments"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorAppointments />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/students"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorStudents />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/ai-insights"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorAIInsights />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/video"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorVideo />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/notes"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorNotes />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/wellness"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorWellness />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/counselor/alerts"
                  element={
                    <ProtectedRoute allowedRoles={["counselor"]} redirectTo="/counselor/login">
                      <CounselorAlerts />
                    </ProtectedRoute>
                  }
                />
                <Route path="/admin/login" element={<AdminLogin />} />
                <Route path="/admin/register" element={<AdminRegister />} />
                <Route
                  path="/admin/dashboard"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminDashboard />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/students"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminStudents />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/counselors"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminCounselors />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/analytics"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminAnalytics />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/ai-reports"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminAIReports />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/alerts"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminAlerts />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/logs"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminLogs />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminSettings />
                    </ProtectedRoute>
                  }
                />
                {import.meta.env.DEV && ChatTestPage && (
                  <Route path="/chat-test" element={<ChatTestPage />} />
                )}
                <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
              </ConfirmDialogProvider>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </BandwidthProvider>
    </ThemeProvider>
  </QueryClientProvider>
  );
};

export default App;
