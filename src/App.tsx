import { Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { BandwidthProvider } from "@/hooks/useBandwidthMode";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ScreenshotShield } from "@/components/ScreenshotShield";

import { lazyWithRetry } from "@/lib/lazyWithRetry";

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
const CounselorAppointments = lazyWithRetry(() => import("./pages/counselor/CounselorAppointments"));
const CounselorStudents = lazyWithRetry(() => import("./pages/counselor/CounselorStudents"));
const CounselorAIInsights = lazyWithRetry(() => import("./pages/counselor/CounselorAIInsights"));
const CounselorVideo = lazyWithRetry(() => import("./pages/counselor/CounselorVideo"));
const CounselorNotes = lazyWithRetry(() => import("./pages/counselor/CounselorNotes"));
const CounselorWellness = lazyWithRetry(() => import("./pages/counselor/CounselorWellness"));
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
    <div className="flex flex-col items-center gap-4">
      <div className="h-12 w-12 rounded-full border-4 border-primary border-t-transparent animate-spin" />
      <p className="text-muted-foreground">Loading page...</p>
    </div>
  </div>
);

const App = () => (
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
              <ScreenshotShield />
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
                  path="/counselor/2fa"
                  element={
                    <ProtectedRoute
                      allowedRoles={["counselor", "peer_counselor"]}
                      redirectTo="/counselor/login"
                    >
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
                    <ProtectedRoute
                      allowedRoles={["counselor", "peer_counselor"]}
                      redirectTo="/counselor/login"
                    >
                      <CounselorMessages />
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
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </BandwidthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
