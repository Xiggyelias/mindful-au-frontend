import { createContext, useContext } from "react";

/**
 * The auth context object and the hook that reads it, deliberately kept OUT of the module
 * that defines `AuthProvider`.
 *
 * Why they live here: a module whose exports are all components/hooks is a React Fast Refresh
 * boundary, so Vite makes it self-accepting. `useAuth.tsx` qualified (it exported only
 * `AuthProvider` and `useAuth`), which meant every edit to it re-ran the module and
 * `createContext()` produced a *brand new* context object. Fast Refresh then swapped in the
 * new `AuthProvider` — but consumer modules were not re-executed, so they kept calling the
 * previous `useAuth`, which read the previous context, found no provider on it, and threw
 * "useAuth must be used within an AuthProvider". The dev console filled with that error for
 * ScreenshotShield / IncomingCallHost / FloatingCallDock after any auth edit.
 *
 * This file exports no components, so it is not a refresh boundary and is not re-executed
 * when the provider changes. The context object identity therefore survives hot updates, and
 * even a stale `useAuth` reference resolves against the same context the live provider fills.
 *
 * Keep it that way: adding a component export here would reintroduce the bug.
 */

export type AppRole = "admin" | "counselor" | "peer_counselor" | "student";

export type LoginPortal = "student" | "counselor" | "admin";

export const DEFAULT_TWO_FACTOR_STATE = {
  enabled: false,
  required: false,
  setupRequired: false,
  verified: false,
  tokenVerified: false,
};

export type TwoFactorState = typeof DEFAULT_TWO_FACTOR_STATE;

export interface User {
  id: number;
  email: string;
  needs_assessment?: boolean;
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

export interface AuthResult {
  error: Error | null;
  user?: User | null;
  role?: AppRole | null;
  twoFactorRequired?: boolean;
  twoFactorSetupRequired?: boolean;
}

export interface AuthContextType {
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
  /** Clears needs_assessment locally after a successful check-in submit (server sync via refreshUser). */
  markAssessmentComplete: () => void;
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

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
