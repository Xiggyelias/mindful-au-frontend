import type { APIRequestContext, APIResponse } from "@playwright/test";
import { apiBaseUrl, e2eUsers, type CmsRole } from "./env";

export type CmsUser = {
  id: number;
  email: string;
  profile?: {
    full_name?: string | null;
  } | null;
  roles?: Array<{
    role: string;
    approved?: boolean;
  }>;
};

export type LoginOk = {
  ok: true;
  token: string;
  deviceId: string;
  deviceName: string;
  expiresIn: number;
  user: CmsUser;
};

export type LoginFailed = {
  ok: false;
  status: number;
  message: string;
};

export type LoginResult = LoginOk | LoginFailed;

export type SessionPayload = {
  id: number;
  student_id?: number;
  counselor_id?: number | null;
  peer_counselor_id?: number | null;
  assigned_role?: string | null;
  session_type?: string;
  status?: string;
  is_anonymous?: boolean;
  panic_log_id?: number;
};

export type MessagePayload = {
  id: number;
  session_id: number;
  sender_id: number;
  recipient_id: number | null;
  sender_role: string;
  content: string;
  message_type: string;
  is_deleted?: boolean;
  delete_for_everyone_until?: string | null;
};

export type SeedUserIds = {
  studentId: number;
  counselorId: number;
  peerCounselorId: number;
  adminId: number;
};

type JsonMap = Record<string, any>;

export class CmsApi {
  private readonly tokenDeviceContexts = new Map<string, { deviceId: string; deviceName: string }>();

  constructor(private readonly request: APIRequestContext) {}

  async health(): Promise<APIResponse> {
    return this.request.get(`${apiBaseUrl}/health`);
  }

  async login(role: CmsRole): Promise<LoginResult> {
    const credentials = e2eUsers[role];
    const deviceContext = this.deviceContext(role);
    const response = await this.request.post(`${apiBaseUrl}/login`, {
      data: credentials,
      headers: {
        Accept: "application/json",
        "X-Device-ID": deviceContext.deviceId,
        "X-Device-Name": deviceContext.deviceName,
      },
    });
    const body = await readJson(response);

    if (!response.ok()) {
      return {
        ok: false,
        status: response.status(),
        message: String(body?.message ?? `Login failed for ${role}`),
      };
    }

    if (body?.two_factor_required && !body?.two_factor_token_verified) {
      return {
        ok: false,
        status: response.status(),
        message: `Two-factor authentication is required for ${role}`,
      };
    }

    const token = String(body?.access_token ?? "");
    if (token === "") {
      return {
        ok: false,
        status: response.status(),
        message: `Login response did not include an access token for ${role}`,
      };
    }
    this.tokenDeviceContexts.set(token, deviceContext);

    return {
      ok: true,
      token,
      ...deviceContext,
      expiresIn: Number(body?.expires_in ?? 3600),
      user: body.user as CmsUser,
    };
  }

  async requireLogin(role: CmsRole): Promise<LoginOk> {
    const login = await this.login(role);
    if (!login.ok) {
      throw new Error(`${role} login unavailable: ${login.status} ${login.message}`);
    }
    return login;
  }

  async get(path: string, token: string): Promise<APIResponse> {
    return this.request.get(this.url(path), {
      headers: this.authHeaders(token),
    });
  }

  async post(path: string, token: string, data?: JsonMap): Promise<APIResponse> {
    return this.request.post(this.url(path), {
      data,
      headers: this.authHeaders(token),
    });
  }

  async patch(path: string, token: string, data?: JsonMap): Promise<APIResponse> {
    return this.request.patch(this.url(path), {
      data,
      headers: this.authHeaders(token),
    });
  }

  async put(path: string, token: string, data?: JsonMap): Promise<APIResponse> {
    return this.request.put(this.url(path), {
      data,
      headers: this.authHeaders(token),
    });
  }

  async delete(path: string, token: string): Promise<APIResponse> {
    return this.request.delete(this.url(path), {
      headers: this.authHeaders(token),
    });
  }

  async seedUserIds(adminToken: string): Promise<SeedUserIds> {
    const response = await this.get("/users?limit=500", adminToken);
    if (!response.ok()) {
      throw new Error(`Could not load seeded users: ${response.status()} ${await response.text()}`);
    }
    const users = extractArray(await response.json()) as CmsUser[];
    const byEmail = new Map(users.map((user) => [String(user.email).toLowerCase(), user]));

    const student = byEmail.get(e2eUsers.student.email.toLowerCase());
    const counselor = byEmail.get(e2eUsers.counselor.email.toLowerCase());
    const peer = byEmail.get(e2eUsers.peer_counselor.email.toLowerCase());
    const admin = byEmail.get(e2eUsers.admin.email.toLowerCase());

    if (!student || !counselor || !peer || !admin) {
      throw new Error("Expected TestUserSeeder users are missing. Run php artisan db:seed --class=TestUserSeeder.");
    }

    return {
      studentId: Number(student.id),
      counselorId: Number(counselor.id),
      peerCounselorId: Number(peer.id),
      adminId: Number(admin.id),
    };
  }

  async openSessionIds(adminToken: string): Promise<Set<number>> {
    const response = await this.get("/sessions/chat-list?lightweight=1&open_only=1&limit=500&as_role=admin", adminToken);
    if (!response.ok()) {
      throw new Error(`Could not list open sessions: ${response.status()} ${await response.text()}`);
    }

    return new Set(
      extractArray(await response.json())
        .map((session) => Number(session.id))
        .filter((id) => Number.isFinite(id) && id > 0),
    );
  }

  async createCounselorSession(adminToken: string, ids: SeedUserIds): Promise<SessionPayload> {
    const response = await this.post("/sessions/counselor", adminToken, {
      student_id: ids.studentId,
      counselor_id: ids.counselorId,
      session_type: "chat",
    });
    if (!response.ok()) {
      throw new Error(`Could not create counselor session: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as SessionPayload;
  }

  async assignPeer(adminToken: string, sessionId: number, peerCounselorId: number): Promise<SessionPayload> {
    const response = await this.post(`/sessions/${sessionId}/assign-peer`, adminToken, {
      peer_counselor_id: peerCounselorId,
    });
    if (!response.ok()) {
      throw new Error(`Could not assign peer counselor: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as SessionPayload;
  }

  async unassignPeer(adminToken: string, sessionId: number): Promise<SessionPayload> {
    const response = await this.post(`/sessions/${sessionId}/unassign-peer`, adminToken);
    if (!response.ok()) {
      throw new Error(`Could not unassign peer counselor: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as SessionPayload;
  }

  async sendMessage(token: string, sessionId: number, content: string): Promise<MessagePayload> {
    const response = await this.post(`/sessions/${sessionId}/messages`, token, {
      content,
      message_type: "text",
      is_encrypted: false,
    });
    if (!response.ok()) {
      throw new Error(`Could not send message: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as MessagePayload;
  }

  async sessionMessages(token: string, sessionId: number): Promise<MessagePayload[]> {
    const response = await this.get(`/sessions/${sessionId}/messages?limit=50&mark_read=0`, token);
    if (!response.ok()) {
      throw new Error(`Could not read messages: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as MessagePayload[];
  }

  async incomingDigest(token: string, afterId: number): Promise<{ after_id: number; messages: JsonMap[] }> {
    const response = await this.get(`/chat/incoming-digest?after_id=${afterId}`, token);
    if (!response.ok()) {
      throw new Error(`Could not read incoming digest: ${response.status()} ${await response.text()}`);
    }

    return (await response.json()) as { after_id: number; messages: JsonMap[] };
  }

  async markAllNotificationsRead(token: string): Promise<void> {
    const response = await this.post("/notifications/read-all", token);
    if (!response.ok()) {
      throw new Error(`Could not mark notifications read: ${response.status()} ${await response.text()}`);
    }
  }

  async unreadNotifications(token: string): Promise<JsonMap[]> {
    const response = await this.get("/notifications?unread_only=1&limit=100", token);
    if (!response.ok()) {
      throw new Error(`Could not read notifications: ${response.status()} ${await response.text()}`);
    }

    const body = (await response.json()) as JsonMap;
    return extractArray(body.notifications ?? body.data ?? body);
  }

  async safeDeleteSession(adminToken: string, sessionId: number): Promise<void> {
    const response = await this.delete(`/sessions/${sessionId}`, adminToken);
    if (!response.ok() && response.status() !== 404) {
      throw new Error(`Could not clean up session ${sessionId}: ${response.status()} ${await response.text()}`);
    }
  }

  private url(path: string): string {
    return `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private authHeaders(token: string): Record<string, string> {
    const deviceContext = this.tokenDeviceContexts.get(token);
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    };

    if (deviceContext) {
      headers["X-Device-ID"] = deviceContext.deviceId;
      headers["X-Device-Name"] = deviceContext.deviceName;
    }

    return headers;
  }

  private deviceContext(role: CmsRole): { deviceId: string; deviceName: string } {
    return {
      deviceId: `cms-e2e-${role}`,
      deviceName: `CMS E2E ${role}`,
    };
  }
}

export function extractArray(value: any): any[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.data)) {
    return value.data;
  }
  return [];
}

async function readJson(response: APIResponse): Promise<JsonMap | null> {
  try {
    return (await response.json()) as JsonMap;
  } catch {
    return null;
  }
}
