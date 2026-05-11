import { useState, useEffect, createContext, useContext, ReactNode, useRef } from "react";
import { api, AUTH_EXPIRED_EVENT, getApiErrorMessage } from "@/lib/api";

type AppRole = "admin" | "counselor" | "peer_counselor" | "student";
type LoginPortal = "student" | "counselor" | "admin";
const PRESENCE_PING_INTERVAL_MS = 20 * 1000;
const PRESENCE_MIN_GAP_MS = 10 * 1000;
const DEFAULT_TWO_FACTOR_STATE = {
  enabled: false,
  required: false,
  setupRequired: false,
  verified: false,
  tokenVerified: false,
};

type TwoFactorState = typeof DEFAULT_TWO_FACTOR_STATE;

interface User {
  id: number;
  email: string;
  profile?: {
    full_name?: string;
    id_number?: string;
    avatar_url?: string;
    anonymous_mode?: boolean;
  };
  roles?: Array<{
    role: AppRole;
    approved: boolean;
  }>;
}

interface AuthResult {
  error: Error | null;
  user?: User | null;
  role?: AppRole | null;
  twoFactorRequired?: boolean;
  twoFactorSetupRequired?: boolean;
}

interface AuthContextType {
  user: User | null;
  role: AppRole | null;
  twoFactor: TwoFactorState;
  isLoading: boolean;
  signInWithGoogle: (portal?: LoginPortal) => Promise<{ error: Error | null }>;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult>;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    idNumber: string,
    role: AppRole
  ) => Promise<AuthResult>;
  completeOAuthLogin: (token: string) => Promise<AuthResult>;
  completeOAuthLoginWithTicket: (ticket: string) => Promise<AuthResult>;
  refreshUser: () => Promise<void>;
  refreshTwoFactorStatus: () => Promise<TwoFactorState>;
  setupTwoFactor: () => Promise<{
    secret: string;
    otpauth_uri: string;
    configured: boolean;
    verified: boolean;
  }>;
  verifyTwoFactor: (code: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const resolveRole = (user: User | null) => {
  if (!user?.roles?.length) {
    return null;
  }

  // Admin role should always take precedence across portals.
  const adminRole = user.roles.find((r) => r.approved && r.role === "admin")?.role;
  if (adminRole) {
    return adminRole;
  }

  const counselorRole = user.roles.find((r) => r.approved && r.role === "counselor")?.role;
  if (counselorRole) {
    return counselorRole;
  }

  const peerRole = user.roles.find((r) => r.approved && r.role === "peer_counselor")?.role;
  if (peerRole) {
    return peerRole;
  }

  const studentRole = user.roles.find((r) => r.approved && r.role === "student")?.role;
  return studentRole ?? null;
};

const toBool = (value: unknown): boolean => value === true || value === 1 || value === "1";

const parseTwoFactorState = (payload: any): TwoFactorState => {
  if (!payload || typeof payload !== "object") {
    return { ...DEFAULT_TWO_FACTOR_STATE };
  }

  const enabled = toBool(payload.two_factor_enabled ?? payload.enabled);
  const required = toBool(payload.two_factor_required ?? payload.required);
  const setupRequired = toBool(payload.two_factor_setup_required ?? payload.setup_required);
  const verified = toBool(payload.two_factor_verified ?? payload.verified);
  const tokenVerified = toBool(payload.two_factor_token_verified ?? payload.token_verified);

  return {
    enabled,
    required,
    setupRequired,
    verified,
    tokenVerified,
  };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [twoFactor, setTwoFactor] = useState<TwoFactorState>({ ...DEFAULT_TWO_FACTOR_STATE });
  const [isLoading, setIsLoading] = useState(true);
  const presenceInFlightRef = useRef(false);
  const lastPresencePingAtRef = useRef(0);

  const refreshUser = async () => {
    if (!api.hasToken()) {
      setUser(null);
      setRole(null);
      setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });
      return;
    }

    try {
      const userData = await api.getMe({ timeout_ms: 12000 });
      setUser(userData);
      const userRole = resolveRole(userData);
      setRole(userRole);
      setTwoFactor(parseTwoFactorState(userData));
    } catch {
      setUser(null);
      setRole(null);
      setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });
      api.clearToken();
    }
  };

  useEffect(() => {
    const loadUser = async () => {
      if (!api.hasToken()) {
        setIsLoading(false);
        return;
      }

      try {
        await api.ensureFreshToken();
      } catch {
        // Let refreshUser handle invalid or expired tokens consistently.
      }

      await refreshUser();
      setIsLoading(false);
    };

    void loadUser();
  }, []);

  useEffect(() => {
    const onAuthExpired = () => {
      setUser(null);
      setRole(null);
      setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, onAuthExpired);
    };
  }, []);

  useEffect(() => {
    if (!user?.id) return;

    const pingPresence = async (force = false) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastPresencePingAtRef.current < PRESENCE_MIN_GAP_MS) {
        return;
      }
      if (presenceInFlightRef.current) {
        return;
      }

      presenceInFlightRef.current = true;
      try {
        await api.updatePresence();
        lastPresencePingAtRef.current = Date.now();
      } catch {
        // Presence updates are best-effort and should not interrupt auth UX.
      } finally {
        presenceInFlightRef.current = false;
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pingPresence(true);
      }
    };

    void pingPresence(true);

    const intervalId = window.setInterval(() => {
      void pingPresence();
    }, PRESENCE_PING_INTERVAL_MS);

    const onFocus = () => {
      void pingPresence(true);
    };

    const onOnline = () => {
      void pingPresence(true);
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!api.hasToken()) {
      return;
    }

    const refreshIfNeeded = async (minRemainingMs?: number) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        return;
      }

      try {
        await api.ensureFreshToken(minRemainingMs);
      } catch {
        // Expired-session handling is centralized in the API client.
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshIfNeeded();
    }, 60 * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshIfNeeded(15 * 60 * 1000);
      }
    };

    const onFocus = () => {
      void refreshIfNeeded(15 * 60 * 1000);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [user?.id]);

  const signInWithGoogle = async (portal?: LoginPortal) => {
    const base = api.getBaseUrl().replace(/\/+$/, '');
    const query = new URLSearchParams();
    if (portal) {
      query.set("portal", portal);
    }
    if (typeof window !== "undefined") {
      const frontendBaseUrl = new URL(import.meta.env.BASE_URL, window.location.origin).toString().replace(/\/+$/, "");
      query.set("frontend_url", frontendBaseUrl);
    }
    const queryString = query.toString();
    window.location.href = `${base}/auth/google${queryString ? `?${queryString}` : ""}`;
    return { error: null };
  };

  const completeOAuthLogin = async (token: string): Promise<AuthResult> => {
    try {
      api.setToken(token);
      const userData = await api.getMe({ timeout_ms: 12000 });
      setUser(userData);
      const userRole = resolveRole(userData);
      setRole(userRole);
      const twoFactorState = parseTwoFactorState(userData);
      setTwoFactor(twoFactorState);

      if (!userRole) {
        api.clearToken();
        setUser(null);
        setRole(null);
        setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });
        return { error: new Error("No authorized role was assigned to this account.") };
      }

      return {
        error: null,
        user: userData,
        role: userRole,
        twoFactorRequired: twoFactorState.required,
        twoFactorSetupRequired: twoFactorState.setupRequired,
      };
    } catch (error: any) {
      api.clearToken();
      setUser(null);
      setRole(null);
      setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });

      let errorMessage = "Google sign-in failed. Please try again.";
      errorMessage = getApiErrorMessage(
        error,
        "Unable to complete Google sign-in. Please try again."
      );

      return { error: new Error(errorMessage) };
    }
  };

  const completeOAuthLoginWithTicket = async (ticket: string): Promise<AuthResult> => {
    try {
      const exchange = await api.exchangeGoogleLoginTicket(ticket);
      const token = String(exchange?.access_token || "").trim();
      if (!token) {
        return { error: new Error("Google sign-in ticket was invalid or expired.") };
      }

      return await completeOAuthLogin(token);
    } catch (error: any) {
      const errorMessage = getApiErrorMessage(
        error,
        "Unable to complete Google sign-in. Please try again."
      );
      return { error: new Error(errorMessage) };
    }
  };

  const signInWithEmail = async (email: string, password: string): Promise<AuthResult> => {
    try {
      const data = await api.login(email.trim(), password);

      if (data.access_token) {
        api.setToken(data.access_token);
      }

      let userData: User | null = data.user ?? null;
      if (!userData) {
        userData = await api.getMe({ timeout_ms: 12000 });
      }

      setUser(userData);
      const userRole = resolveRole(userData);
      setRole(userRole);
      const twoFactorState = parseTwoFactorState(data);
      setTwoFactor(twoFactorState);

      return {
        error: null,
        user: userData,
        role: userRole,
        twoFactorRequired: twoFactorState.required,
        twoFactorSetupRequired: twoFactorState.setupRequired,
      };
    } catch (error: any) {
      let errorMessage = "Login failed. Please check your credentials and try again.";

      if (error.response?.status === 422 || error.response?.status === 401) {
        if (error.response?.data?.message) {
          errorMessage = error.response.data.message;
        }
        if (error.response?.data?.errors) {
          const firstErrorKey = Object.keys(error.response.data.errors)[0];
          const firstError = error.response.data.errors[firstErrorKey];
          if (Array.isArray(firstError) && firstError.length > 0) {
            errorMessage = firstError[0];
          }
        }
      } else {
        errorMessage = getApiErrorMessage(
          error,
          "Login failed. Please check your credentials and try again."
        );
      }

      return { error: new Error(errorMessage) };
    }
  };

  const signUp = async (
    email: string,
    password: string,
    fullName: string,
    idNumber: string,
    role: AppRole
  ): Promise<AuthResult> => {
    try {
      const data = await api.register({
        email,
        password,
        full_name: fullName,
        id_number: idNumber,
        role,
      });

      if (data.access_token) {
        api.setToken(data.access_token);
      }

      let userData: User | null = data.user ?? null;
      if (!userData) {
        userData = await api.getMe({ timeout_ms: 12000 });
      }

      setUser(userData);
      const userRole = resolveRole(userData);
      setRole(userRole);
      setTwoFactor(parseTwoFactorState(data));

      return { error: null, user: userData, role: userRole };
    } catch (error: any) {
      let errorMessage = "Registration failed. Please try again.";
      if (error.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error.response?.data?.errors) {
        const firstError = Object.values(error.response.data.errors)[0];
        errorMessage = Array.isArray(firstError) ? firstError[0] : String(firstError);
      } else {
        errorMessage = getApiErrorMessage(error, "Registration failed. Please try again.");
      }
      return { error: new Error(errorMessage) };
    }
  };

  const refreshTwoFactorStatus = async (): Promise<TwoFactorState> => {
    if (!api.hasToken()) {
      const next = { ...DEFAULT_TWO_FACTOR_STATE };
      setTwoFactor(next);
      return next;
    }

    try {
      const payload = await api.getTwoFactorStatus();
      const next = parseTwoFactorState(payload);
      setTwoFactor(next);
      return next;
    } catch {
      const next = { ...DEFAULT_TWO_FACTOR_STATE };
      setTwoFactor(next);
      return next;
    }
  };

  const setupTwoFactor = async () => {
    const payload = await api.setupTwoFactor();
    await refreshTwoFactorStatus();
    return payload;
  };

  const verifyTwoFactor = async (code: string): Promise<{ error: Error | null }> => {
    try {
      await api.verifyTwoFactor(code);
      await refreshUser();
      await refreshTwoFactorStatus();
      return { error: null };
    } catch (error) {
      const message = getApiErrorMessage(error, "Two-factor verification failed.");
      return { error: new Error(message) };
    }
  };

/* eslint-disable react-refresh/only-export-components */
  const signOut = async () => {
    // Make logout responsive even if backend is slow/unreachable.
    const logoutRequest = api.logout().catch(() => {
      // Logout failures are logged server-side; ignore client error.
    });

    setUser(null);
    setRole(null);
    setTwoFactor({ ...DEFAULT_TWO_FACTOR_STATE });
    api.clearToken();

    void logoutRequest;

    try {
      const { clearAllChatSessionSecrets } = await import("@/lib/chatSessionKeys");
      await clearAllChatSessionSecrets();
    } catch {
      /* ignore */
    }

    // Clear RSA device keys from IndexedDB
    try {
      const { clearDeviceKeyPair } = await import("@/lib/encryption");
      await clearDeviceKeyPair();
    } catch {
      /* ignore */
    }
  };

  return (
    <AuthContext.Provider value={{
      user,
      role,
      twoFactor,
      isLoading,
      signInWithGoogle,
      signInWithEmail,
      signUp,
      completeOAuthLogin,
      completeOAuthLoginWithTicket,
      refreshUser,
      refreshTwoFactorStatus,
      setupTwoFactor,
      verifyTwoFactor,
      signOut,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
