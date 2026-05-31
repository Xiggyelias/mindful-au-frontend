export type CmsRole = "admin" | "counselor" | "peer_counselor" | "student";

export type CmsUserCredentials = {
  email: string;
  password: string;
};

export const apiBaseUrl = (process.env.CMS_E2E_API_URL ?? "http://127.0.0.1:8000/api").replace(
  /\/+$/,
  "",
);

export const authTokenStorageKey = "auth_token";
export const authTokenExpiresAtStorageKey = "auth_token_expires_at";
export const authDeviceIdStorageKey = "auth_device_id";

export const e2eUsers: Record<CmsRole, CmsUserCredentials> = {
  admin: {
    email: process.env.CMS_E2E_ADMIN_EMAIL ?? "admin@example.com",
    password: process.env.CMS_E2E_ADMIN_PASSWORD ?? "password123",
  },
  counselor: {
    email: process.env.CMS_E2E_COUNSELOR_EMAIL ?? "counselor@example.com",
    password: process.env.CMS_E2E_COUNSELOR_PASSWORD ?? "password123",
  },
  peer_counselor: {
    email: process.env.CMS_E2E_PEER_EMAIL ?? "peer.counselor@example.com",
    password: process.env.CMS_E2E_PEER_PASSWORD ?? "password123",
  },
  student: {
    email: process.env.CMS_E2E_STUDENT_EMAIL ?? "student@example.com",
    password: process.env.CMS_E2E_STUDENT_PASSWORD ?? "password123",
  },
};
