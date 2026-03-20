import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";
import { BandwidthProvider } from "@/hooks/useBandwidthMode";
import { ProtectedRoute } from "@/components/ProtectedRoute";

const Index = lazy(() => import("./pages/Index"));
const OAuthCallback = lazy(() => import("./pages/auth/OAuthCallback"));
const NotFound = lazy(() => import("./pages/NotFound"));

const StudentLogin = lazy(() => import("./pages/student/StudentLogin"));
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const StudentChat = lazy(() => import("./pages/student/StudentChat"));
const StudentAppointments = lazy(() => import("./pages/student/StudentAppointments"));
const StudentAISupport = lazy(() => import("./pages/student/StudentAISupport"));
const StudentVideoCall = lazy(() => import("./pages/student/StudentVideoCall"));
const StudentHistory = lazy(() => import("./pages/student/StudentHistory"));
const StudentWellness = lazy(() => import("./pages/student/StudentWellness"));
const StudentReferrals = lazy(() => import("./pages/student/StudentReferrals"));

const CounselorLogin = lazy(() => import("./pages/counselor/CounselorLogin"));
const CounselorRegister = lazy(() => import("./pages/counselor/CounselorRegister"));
const CounselorDashboard = lazy(() => import("./pages/counselor/CounselorDashboard"));
const CounselorMessages = lazy(() => import("./pages/counselor/CounselorMessages"));
const CounselorAppointments = lazy(() => import("./pages/counselor/CounselorAppointments"));
const CounselorStudents = lazy(() => import("./pages/counselor/CounselorStudents"));
const CounselorAIInsights = lazy(() => import("./pages/counselor/CounselorAIInsights"));
const CounselorVideo = lazy(() => import("./pages/counselor/CounselorVideo"));
const CounselorNotes = lazy(() => import("./pages/counselor/CounselorNotes"));
const CounselorWellness = lazy(() => import("./pages/counselor/CounselorWellness"));
const CounselorTwoFactor = lazy(() => import("./pages/counselor/CounselorTwoFactor"));
const CounselorReferrals = lazy(() => import("./pages/counselor/CounselorReferrals"));
const PeerLogin = lazy(() => import("./pages/peer/PeerLogin"));
const PeerDashboard = lazy(() => import("./pages/peer/PeerDashboard"));
const PeerEscalatedCases = lazy(() => import("./pages/peer/PeerEscalatedCases"));
const PeerEthics = lazy(() => import("./pages/peer/PeerEthics"));
const PeerProfile = lazy(() => import("./pages/peer/PeerProfile"));

const AdminLogin = lazy(() => import("./pages/admin/AdminLogin"));
const AdminRegister = lazy(() => import("./pages/admin/AdminRegister"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const AdminStudents = lazy(() => import("./pages/admin/AdminStudents"));
const AdminCounselors = lazy(() => import("./pages/admin/AdminCounselors"));
const AdminAnalytics = lazy(() => import("./pages/admin/AdminAnalytics"));
const AdminAIReports = lazy(() => import("./pages/admin/AdminAIReports"));
const AdminAlerts = lazy(() => import("./pages/admin/AdminAlerts"));
const AdminLogs = lazy(() => import("./pages/admin/AdminLogs"));
const AdminSettings = lazy(() => import("./pages/admin/AdminSettings"));
const AdminReferrals = lazy(() => import("./pages/admin/AdminReferrals"));

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
                  path="/student/referrals"
                  element={
                    <ProtectedRoute allowedRoles={["student"]} redirectTo="/student/login">
                      <StudentReferrals />
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
                <Route
                  path="/counselor/referrals"
                  element={
                    <ProtectedRoute
                      allowedRoles={["counselor", "peer_counselor"]}
                      redirectTo="/counselor/login"
                    >
                      <CounselorReferrals />
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
                <Route
                  path="/admin/referrals"
                  element={
                    <ProtectedRoute allowedRoles={["admin"]} redirectTo="/admin/login">
                      <AdminReferrals />
                    </ProtectedRoute>
                  }
                />

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
