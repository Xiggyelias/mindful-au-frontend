import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { resolveApiBaseUrl } from '@/lib/runtimeConfig';

const API_BASE_URL = resolveApiBaseUrl();
const HAS_EXPLICIT_API_BASE_URL = String(import.meta.env.VITE_API_URL ?? '').trim() !== '';
const DEFAULT_API_TIMEOUT_MS = (() => {
  const raw = Number(import.meta.env.VITE_API_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 45000;
})();
const DEFAULT_READ_TIMEOUT_MS = Math.max(30000, DEFAULT_API_TIMEOUT_MS);
const TIMEOUT_RETRY_MAX_MS = Math.max(60000, DEFAULT_READ_TIMEOUT_MS);
const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504]);
const NETWORK_ERROR_CODES = new Set([
  'ERR_NETWORK',
  'ERR_NETWORK_CHANGED',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
]);
const MAX_GET_RETRY_ATTEMPTS = 2;
const RESPONSE_CACHE_TTL_MS = 60 * 1000;
const RESPONSE_CACHE_STALE_IF_ERROR_MS = 10 * 60 * 1000;
export const API_RECOVERED_EVENT = 'api:recovered';
export const AUTH_EXPIRED_EVENT = 'auth:expired';
const AUTH_TOKEN_STORAGE_KEY = 'auth_token';
const LOCAL_HOST_PATTERN = /^(localhost|127\.0\.0\.1|::1)$/i;
const VITE_DEV_SERVER_PORTS = new Set(['5173', '4173']);

type ApiRequestConfig = Record<string, unknown> & {
  method?: string;
  timeout?: number;
  baseURL?: string;
  url?: string;
  params?: unknown;
  __retry_count?: number;
  __attempted_base_urls?: string[];
  __response_cache_key?: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const isLikelyViteDevOrigin = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }

  return (
    LOCAL_HOST_PATTERN.test(window.location.hostname)
    && VITE_DEV_SERVER_PORTS.has(String(window.location.port || ''))
  );
};

const parseContentDispositionFilename = (headerValue: unknown): string | null => {
  const raw = typeof headerValue === 'string' ? headerValue : '';
  if (raw.trim() === '') {
    return null;
  }

  const utf8Match = raw.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch {
      return utf8Match[1];
    }
  }

  const asciiMatch = raw.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) {
    return asciiMatch[1];
  }

  return null;
};

const triggerBlobDownload = (blob: Blob, fileName: string): void => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  window.document.body.appendChild(anchor);
  anchor.click();
  window.document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
};

const stableSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));

  return `{${entries.map(([key, entryValue]) => `${key}:${stableSerialize(entryValue)}`).join(',')}}`;
};

const extractResponseMessage = (error: unknown): string | null => {
  const responseMessage = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
  if (typeof responseMessage === 'string' && responseMessage.trim() !== '') {
    return responseMessage;
  }

  return null;
};

export const isApiNetworkError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code || '').toUpperCase();
  if (NETWORK_ERROR_CODES.has(code)) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : '';

  if (/network\s*error/i.test(message) || /failed\s*to\s*fetch/i.test(message)) {
    return true;
  }

  return (error as { response?: unknown })?.response == null && message.trim() !== '';
};

const isTimeoutError = (error: unknown): boolean => {
  const code = String((error as { code?: unknown })?.code || '').toUpperCase();
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
      ? error
      : '';

  return /timeout/i.test(message);
};

export const getApiErrorMessage = (
  error: unknown,
  fallback: string
): string => {
  const responseMessage = extractResponseMessage(error);
  if (responseMessage) {
    return responseMessage;
  }

  const status = Number((error as { response?: { status?: unknown } })?.response?.status);
  if (status === 401) {
    return 'Your session expired. Please sign in again.';
  }

  if (isTimeoutError(error)) {
    return 'The request timed out. Please try again.';
  }

  if (isApiNetworkError(error)) {
    return 'Cannot reach the server right now. Please check your connection and try again.';
  }

  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  if (typeof error === 'string' && error.trim() !== '') {
    return error;
  }

  return fallback;
};

const ensureObjectPayload = (
  data: unknown,
  fallbackMessage: string
): Record<string, unknown> => {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }

  throw new Error(fallbackMessage);
};

class ApiClient {
  private client: AxiosInstance;
  private token: string | null = null;
  private activeBaseUrl: string;
  private readonly apiBaseCandidates: string[];
  private readonly responseCache = new Map<string, { savedAt: number; data: unknown }>();
  private wasApiUnreachable = false;

  constructor() {
    this.activeBaseUrl = API_BASE_URL;
    this.apiBaseCandidates = this.buildBaseUrlCandidates(API_BASE_URL);

    this.client = axios.create({
      baseURL: this.activeBaseUrl,
      timeout: DEFAULT_API_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    // Load token from session storage and migrate legacy localStorage tokens.
    this.token = this.loadPersistedToken();
    if (this.token) {
      this.setToken(this.token);
    }

    // Intercept requests to add token
    this.client.interceptors.request.use((config) => {
      if (this.token) {
        config.headers.Authorization = `Bearer ${this.token}`;
      }

      if (!config.baseURL) {
        config.baseURL = this.activeBaseUrl;
      }

      const requestConfig = config as unknown as ApiRequestConfig;
      const cacheKey = this.buildResponseCacheKey(requestConfig);
      if (cacheKey) {
        requestConfig.__response_cache_key = cacheKey;
      }

      return config;
    });

    // Intercept responses to handle token refresh
    this.client.interceptors.response.use(
      (response) => {
        const requestConfig = response.config as unknown as ApiRequestConfig;
        const usedBaseUrl = String(requestConfig?.baseURL || '');
        if (usedBaseUrl) {
          this.promoteActiveBaseUrl(usedBaseUrl);
        }

        this.persistResponseCache(response);
        this.markApiRecovered();
        return response;
      },
      async (error) => {
        const config = (error as { config?: ApiRequestConfig }).config;
        const errorCode = String((error as { code?: unknown })?.code || '').toUpperCase();
        const isNetworkChangedError = errorCode === 'ERR_NETWORK_CHANGED';
        const isTimeout = isTimeoutError(error);
        const isNetworkError = isApiNetworkError(error);
        const statusCode = Number((error as { response?: { status?: number } })?.response?.status);
        const isTransientStatus = Number.isFinite(statusCode) && TRANSIENT_STATUS_CODES.has(statusCode);
        const method = String(config?.method || '').toLowerCase();
        const retryCount = Number(config?.__retry_count || 0);
        const canRetry =
          Boolean(config)
          && method === 'get'
          && retryCount < MAX_GET_RETRY_ATTEMPTS
          && !isNetworkChangedError;

        if ((isTimeout || isNetworkError || isTransientStatus) && canRetry) {
          const currentTimeout = Number(config?.timeout);
          const nextTimeout = Number.isFinite(currentTimeout) && currentTimeout > 0
            ? Math.min(Math.floor(currentTimeout * 2), TIMEOUT_RETRY_MAX_MS)
            : DEFAULT_READ_TIMEOUT_MS;

          const attemptedBaseUrls = new Set<string>(
            Array.isArray(config?.__attempted_base_urls) ? config.__attempted_base_urls : []
          );
          const currentBaseUrl = String(config?.baseURL || this.activeBaseUrl || '').trim();
          if (currentBaseUrl !== '') {
            attemptedBaseUrls.add(trimTrailingSlash(currentBaseUrl));
          }

          const retryConfig: ApiRequestConfig = {
            ...(config as ApiRequestConfig),
            __retry_count: retryCount + 1,
            timeout: nextTimeout,
          };

          if ((isTimeout || isNetworkError) && !isNetworkChangedError) {
            const fallbackBaseUrl = this.getNextFallbackBaseUrl(attemptedBaseUrls);
            if (fallbackBaseUrl) {
              retryConfig.baseURL = fallbackBaseUrl;
              retryConfig.__attempted_base_urls = Array.from(attemptedBaseUrls);
            }
          }

          const retryDelayMs = isTimeout ? 200 : isNetworkError ? 350 : 250;
          await delay(retryDelayMs);
          return this.client.request(retryConfig);
        }

        const cachedResponse = this.resolveCachedResponse(config, isTimeout || isNetworkError || isTransientStatus);
        if (cachedResponse) {
          return cachedResponse;
        }

        if (isTimeout || isNetworkError) {
          this.markApiUnreachable();
        }

        if (error.response?.status === 401) {
          // Token expired or invalid, clear stored credentials
          const hadToken = Boolean(this.token);
          this.clearToken();
          if (hadToken && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
          }
        }
        return Promise.reject(error);
      }
    );
  }

  private buildBaseUrlCandidates(primaryBaseUrl: string): string[] {
    const candidates = new Set<string>();

    const addCandidate = (value: string | null | undefined) => {
      const normalized = trimTrailingSlash(String(value || '').trim());
      if (!normalized) return;
      if (!/^https?:\/\//i.test(normalized)) return;
      candidates.add(normalized);
    };

    addCandidate(primaryBaseUrl);

    // Only use current-origin API fallback when no explicit API URL is configured.
    // Otherwise, retry failover can incorrectly hit the frontend origin (for example :5173/api) and return 404.
    if (typeof window !== 'undefined' && !HAS_EXPLICIT_API_BASE_URL && !isLikelyViteDevOrigin()) {
      addCandidate(`${trimTrailingSlash(window.location.origin)}/api`);
    }

    return Array.from(candidates);
  }

  private promoteActiveBaseUrl(baseUrl: string): void {
    const normalized = trimTrailingSlash(baseUrl);
    if (!normalized || this.activeBaseUrl === normalized) {
      return;
    }
    if (!this.apiBaseCandidates.includes(normalized)) {
      return;
    }

    this.activeBaseUrl = normalized;
    this.client.defaults.baseURL = normalized;
  }

  private getNextFallbackBaseUrl(excluded: Set<string>): string | null {
    for (const candidate of this.apiBaseCandidates) {
      if (!excluded.has(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  private resolveRequestPath(config: ApiRequestConfig): string | null {
    const rawUrl = String(config.url || '').trim();
    if (!rawUrl) {
      return null;
    }

    try {
      const baseUrl = String(config.baseURL || this.activeBaseUrl || API_BASE_URL);
      const resolved = new URL(rawUrl, baseUrl);
      return resolved.pathname || null;
    } catch {
      return rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`;
    }
  }

  private isCacheableGetPath(path: string): boolean {
    const normalizedPath = path.replace(/\/+$/, '') || '/';

    if (/^\/sessions\/\d+\/messages$/i.test(normalizedPath)) {
      return false;
    }

    if (/^\/sessions\/\d+\/typing$/i.test(normalizedPath)) {
      return false;
    }

    return (
      normalizedPath === '/me' ||
      normalizedPath.startsWith('/appointments') ||
      normalizedPath.startsWith('/users/counselors') ||
      normalizedPath === '/sessions' ||
      normalizedPath.startsWith('/sessions/chat-list') ||
      normalizedPath.startsWith('/ai/wellness-chat/status') ||
      normalizedPath.startsWith('/ai/wellness-chat/history') ||
      normalizedPath.startsWith('/openrouter/conversations')
    );
  }

  private buildResponseCacheKey(config: ApiRequestConfig): string | null {
    const method = String(config.method || '').toLowerCase();
    if (method !== 'get') {
      return null;
    }

    const path = this.resolveRequestPath(config);
    if (!path || !this.isCacheableGetPath(path)) {
      return null;
    }

    const tokenScope = this.token ? this.token.slice(0, 16) : 'anonymous';
    const paramsScope = stableSerialize(config.params);
    return `${tokenScope}|${path}|${paramsScope}`;
  }

  private persistResponseCache(response: AxiosResponse): void {
    const config = response.config as unknown as ApiRequestConfig;
    const key = config.__response_cache_key || this.buildResponseCacheKey(config);
    if (!key) {
      return;
    }

    this.responseCache.set(key, {
      savedAt: Date.now(),
      data: response.data,
    });
  }

  private resolveCachedResponse(
    config: ApiRequestConfig | undefined,
    isErrorPath: boolean
  ): AxiosResponse | null {
    if (!config) {
      return null;
    }

    const key = config.__response_cache_key || this.buildResponseCacheKey(config);
    if (!key) {
      return null;
    }

    const cached = this.responseCache.get(key);
    if (!cached) {
      return null;
    }

    const cacheAge = Date.now() - cached.savedAt;
    const maxAge = isErrorPath ? RESPONSE_CACHE_STALE_IF_ERROR_MS : RESPONSE_CACHE_TTL_MS;
    if (cacheAge > maxAge) {
      return null;
    }

    return {
      data: cached.data,
      status: 200,
      statusText: 'OK',
      headers: {
        'x-client-cache': isErrorPath ? 'stale-if-error' : 'hit',
      },
      config: config as any,
    } as AxiosResponse;
  }

  private markApiUnreachable(): void {
    this.wasApiUnreachable = true;
  }

  private markApiRecovered(): void {
    if (!this.wasApiUnreachable) {
      return;
    }
    this.wasApiUnreachable = false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(API_RECOVERED_EVENT));
    }
  }

  private loadPersistedToken(): string | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const sessionToken = window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (sessionToken) {
      return sessionToken;
    }

    // Legacy migration path: move long-lived localStorage token into session storage.
    const legacyToken = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    if (legacyToken) {
      window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, legacyToken);
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      return legacyToken;
    }

    return null;
  }

  setToken(token: string) {
    this.token = token;
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearToken() {
    this.token = null;
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
    delete this.client.defaults.headers.common['Authorization'];
  }

  hasToken() {
    return Boolean(this.token);
  }

  getToken() {
    return this.token;
  }

  getBaseUrl() {
    return this.activeBaseUrl;
  }

  // Auth endpoints
  async register(data: { email: string; password: string; full_name: string; id_number?: string; role: string }) {
    const response = await this.client.post('/register', data);
    if (response.data.access_token) {
      this.setToken(response.data.access_token);
    }
    return response.data;
  }

  async login(email: string, password: string) {
    const response = await this.client.post('/login', { email, password });
    if (response.data.access_token) {
      this.setToken(response.data.access_token);
    }
    return response.data;
  }

  async exchangeGoogleLoginTicket(ticket: string) {
    const response = await this.client.post('/auth/google/exchange-ticket', { ticket });
    return response.data;
  }

  async logout() {
    await this.client.post('/logout');
    this.clearToken();
  }

  async refreshToken() {
    const response = await this.client.post('/refresh');
    if (response.data.access_token) {
      this.setToken(response.data.access_token);
    }
    return response.data;
  }

  async getMe(params?: { timeout_ms?: number }) {
    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;
    const response = await this.client.get('/me', { timeout: timeoutMs });
    return response.data;
  }

  async getTwoFactorStatus() {
    const response = await this.client.get('/auth/2fa/status');
    return response.data;
  }

  async setupTwoFactor() {
    const response = await this.client.post('/auth/2fa/setup');
    return response.data as {
      secret: string;
      otpauth_uri: string;
      configured: boolean;
      verified: boolean;
    };
  }

  async verifyTwoFactor(code: string) {
    const response = await this.client.post('/auth/2fa/verify', { code });
    return response.data;
  }

  async updatePresence() {
    const response = await this.client.post('/me/presence');
    return response.data;
  }

  // Sessions
  async getSessions(params?: {
    lightweight?: boolean;
    session_type?: 'chat' | 'video' | 'voice';
    status?: 'pending' | 'active' | 'completed' | 'cancelled';
    open_only?: boolean;
    limit?: number;
    page?: number;
    per_page?: number;
    timeout_ms?: number;
  }) {
    const queryParams: Record<string, unknown> = {};

    if (params?.lightweight) {
      queryParams.lightweight = 1;
    }
    if (params?.session_type) {
      queryParams.session_type = params.session_type;
    }
    if (params?.status) {
      queryParams.status = params.status;
    }
    if (params?.open_only) {
      queryParams.open_only = 1;
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : params?.lightweight
        ? DEFAULT_READ_TIMEOUT_MS
        : undefined;

    const response = await this.client.get('/sessions', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async getChatSessions(params?: {
    open_only?: boolean;
    limit?: number;
    page?: number;
    per_page?: number;
    as_role?: 'admin' | 'counselor' | 'peer_counselor' | 'student';
    timeout_ms?: number;
  }) {
    const queryParams: Record<string, unknown> = {};

    if (typeof params?.open_only === 'boolean') {
      queryParams.open_only = params.open_only ? 1 : 0;
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }
    if (params?.as_role) {
      queryParams.as_role = params.as_role;
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/sessions/chat-list', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async getSession(id: string) {
    const response = await this.client.get(`/sessions/${id}`);
    return response.data;
  }

  async createSession(data: { counselor_id?: number; session_type: string; is_anonymous?: boolean }) {
    const response = await this.client.post('/sessions', data);
    return response.data;
  }

  async createSessionAsCounselor(data: { student_id: number; session_type: 'chat' | 'video' | 'voice' }) {
    const response = await this.client.post('/sessions/counselor', data);
    return response.data;
  }

  async assignPeerCounselor(sessionId: number | string, peerCounselorId: number | string) {
    const response = await this.client.post(`/sessions/${sessionId}/assign-peer`, {
      peer_counselor_id: Number(peerCounselorId),
    });
    return response.data;
  }

  async unassignPeerCounselor(sessionId: number | string) {
    const response = await this.client.post(`/sessions/${sessionId}/unassign-peer`);
    return response.data;
  }

  async escalatePeerSession(sessionId: number | string, reason?: string) {
    const payload = reason && reason.trim() !== '' ? { reason: reason.trim() } : {};
    const response = await this.client.post(`/sessions/${sessionId}/escalate`, payload);
    return response.data;
  }

  async panicEscalateSession(
    sessionId: number | string,
    data?: { reason?: string; location?: string }
  ) {
    const payload: Record<string, string> = {};
    const reason = data?.reason?.trim();
    const location = data?.location?.trim();

    if (reason) payload.reason = reason;
    if (location) payload.location = location;

    const response = await this.client.post(`/sessions/${sessionId}/panic-escalate`, payload);
    return response.data;
  }

  async updateSession(id: string, data: any) {
    const response = await this.client.put(`/sessions/${id}`, data);
    return response.data;
  }

  async updateSessionNote(sessionId: number | string, notes: string) {
    const response = await this.client.put(`/sessions/${sessionId}/note`, { notes });
    return response.data;
  }

  async deleteSessionNote(sessionId: number | string) {
    const response = await this.client.delete(`/sessions/${sessionId}/note`);
    return response.data;
  }

  // Messages
  async getMessages(
    sessionId: string,
    params?: { after_id?: number; before_id?: number; limit?: number; timeout_ms?: number }
  ) {
    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;
    const queryParams = {
      after_id: params?.after_id,
      before_id: params?.before_id,
      limit: params?.limit,
    };

    const response = await this.client.get(`/sessions/${sessionId}/messages`, {
      params: queryParams,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async sendMessage(sessionId: string, data: { content: string; message_type?: string; file_url?: string; is_encrypted?: boolean }) {
    const response = await this.client.post(`/sessions/${sessionId}/messages`, data);
    return response.data;
  }

  async deleteMessage(sessionId: string, messageId: number | string) {
    const response = await this.client.delete(`/sessions/${sessionId}/messages/${messageId}`);
    return response.data as { ok?: boolean; id?: number };
  }

  async setTypingState(
    sessionId: string,
    isTyping: boolean,
    params?: { timeout_ms?: number }
  ) {
    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : 5000;
    const response = await this.client.post(
      `/sessions/${sessionId}/typing`,
      { is_typing: isTyping },
      { timeout: timeoutMs }
    );
    return response.data;
  }

  async getTypingState(sessionId: string, params?: { timeout_ms?: number }) {
    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : 5000;
    const response = await this.client.get(`/sessions/${sessionId}/typing`, { timeout: timeoutMs });
    return response.data as { is_typing?: boolean; user_id?: number | null };
  }

  // Appointments
  async getAppointments(params?: {
    status?: 'pending' | 'scheduled' | 'confirmed' | 'completed' | 'cancelled';
    from?: string;
    to?: string;
    limit?: number;
    page?: number;
    per_page?: number;
    timeout_ms?: number;
  }) {
    const queryParams: Record<string, unknown> = {};

    if (params?.status) {
      queryParams.status = params.status;
    }
    if (params?.from) {
      queryParams.from = params.from;
    }
    if (params?.to) {
      queryParams.to = params.to;
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/appointments', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async createAppointment(data: { counselor_id: number; scheduled_at: string; duration_minutes?: number; notes?: string }) {
    const response = await this.client.post('/appointments', data);
    return response.data;
  }

  async updateAppointment(id: string, data: any) {
    const response = await this.client.put(`/appointments/${id}`, data);
    return response.data;
  }

  async deleteAppointment(id: string | number, reason?: string) {
    const payload = reason && reason.trim() !== '' ? { reason: reason.trim() } : undefined;
    const response = await this.client.delete(`/appointments/${id}`, {
      data: payload,
    });
    return response.data;
  }

  // Notifications
  async getNotifications(params?: { limit?: number; unread_only?: boolean }) {
    const response = await this.client.get('/notifications', { params });
    return response.data;
  }

  async markNotificationRead(id: string | number) {
    const response = await this.client.patch(`/notifications/${id}/read`);
    return response.data;
  }

  async markAllNotificationsRead() {
    const response = await this.client.post('/notifications/read-all');
    return response.data;
  }

  // Peer counselor
  async getPeerDashboard() {
    const response = await this.client.get('/peer/dashboard');
    return response.data;
  }

  async getPeerEscalations() {
    const response = await this.client.get('/peer/escalations');
    return response.data;
  }

  async updatePeerAvailability(available: boolean) {
    const response = await this.client.patch('/peer/availability', { available });
    return response.data;
  }

  // Analytics (Admin only)
  async getAnalytics() {
    const response = await this.client.get('/analytics/dashboard');
    return response.data;
  }

  async exportAnalyticsReport(params: {
    report: 'overview' | 'risk_trends' | 'counselor_utilization' | 'faculty_summary';
    format: 'csv' | 'xlsx' | 'pdf';
    days?: number;
  }) {
    const query: Record<string, string | number> = {
      report: params.report,
      format: params.format,
    };

    if (typeof params.days === 'number' && Number.isFinite(params.days) && params.days > 0) {
      query.days = Math.floor(params.days);
    }

    const response = await this.client.get('/analytics/export', {
      params: query,
      responseType: 'blob',
      timeout: TIMEOUT_RETRY_MAX_MS,
    });

    const fileName =
      parseContentDispositionFilename(response.headers?.['content-disposition']) ??
      `${params.report}-${new Date().toISOString().slice(0, 10)}.${params.format}`;
    const blob = response.data instanceof Blob ? response.data : new Blob([response.data]);
    triggerBlobDownload(blob, fileName);
    return { file_name: fileName };
  }

  // Voice Notes
  async uploadVoiceNote(sessionId: string, file: File) {
    const formData = new FormData();
    formData.append('audio', file);
    const response = await this.client.post(`/sessions/${sessionId}/voice-notes`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async downloadVoiceNote(messageId: string) {
    const response = await this.client.get(`/messages/${messageId}/voice-note`);
    return response.data;
  }

  // Video Calls
  async authorizeVideoCall(appointmentId: number | string) {
    const response = await this.client.post('/video-calls/authorize', {
      appointment_id: Number(appointmentId),
    });
    return response.data;
  }

  async endVideoCall(appointmentId: number | string) {
    const response = await this.client.post('/video-calls/end', {
      appointment_id: Number(appointmentId),
    });
    return response.data;
  }

  // Users (Admin)
  async getUsers() {
    const response = await this.client.get('/users');
    return response.data;
  }

  async getCounselors(params?: {
    lightweight?: boolean;
    limit?: number;
    page?: number;
    per_page?: number;
    timeout_ms?: number;
  }) {
    const queryParams: Record<string, unknown> = {};
    if (params?.lightweight) {
      queryParams.lightweight = 1;
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/users/counselors', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async getPeerCounselors(params?: { limit?: number; page?: number; per_page?: number; timeout_ms?: number }) {
    const queryParams: Record<string, unknown> = {};
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/users/peer-counselors', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async approveCounselor(id: number | string) {
    const response = await this.client.post(`/users/counselors/${id}/approve`);
    return response.data;
  }

  async approveCounselorsBulk(ids: Array<number | string>) {
    const response = await this.client.post(`/users/counselors/approve-bulk`, { ids });
    return response.data;
  }

  async rejectCounselor(id: number | string) {
    const response = await this.client.post(`/users/counselors/${id}/reject`);
    return response.data;
  }

  async deleteCounselor(id: number | string) {
    const response = await this.client.delete(`/users/counselors/${id}`);
    return response.data;
  }

  async getStudents(params?: { limit?: number; page?: number; per_page?: number; timeout_ms?: number }) {
    const queryParams: Record<string, unknown> = {};
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/users/students', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  // Institutional Accounts (Admin)
  async getInstitutionAccounts() {
    const response = await this.client.get('/institution-accounts');
    return response.data;
  }

  async createInstitutionAccount(data: {
    email: string;
    role: 'student' | 'staff' | 'counselor' | 'peer_counselor' | 'admin';
    approved?: boolean;
    is_active?: boolean;
    full_name?: string;
    id_number?: string;
  }) {
    const response = await this.client.post('/institution-accounts', data);
    return response.data;
  }

  async updateInstitutionAccount(
    id: number | string,
    data: {
      email?: string;
      role?: 'student' | 'staff' | 'counselor' | 'peer_counselor' | 'admin';
      approved?: boolean;
      is_active?: boolean;
      full_name?: string | null;
      id_number?: string | null;
    }
  ) {
    const response = await this.client.put(`/institution-accounts/${id}`, data);
    return response.data;
  }

  async deleteInstitutionAccount(id: number | string) {
    const response = await this.client.delete(`/institution-accounts/${id}`);
    return response.data;
  }

  // AI Diagnostics
  async getAIDiagnostics(params?: {
    student_id?: number;
    limit?: number;
    page?: number;
    per_page?: number;
    timeout_ms?: number;
  }) {
    const queryParams: Record<string, unknown> = {};
    if (typeof params?.student_id === 'number' && Number.isFinite(params.student_id) && params.student_id > 0) {
      queryParams.student_id = Math.floor(params.student_id);
    }
    if (typeof params?.limit === 'number' && Number.isFinite(params.limit) && params.limit > 0) {
      queryParams.limit = Math.floor(params.limit);
    }
    if (typeof params?.page === 'number' && Number.isFinite(params.page) && params.page > 0) {
      queryParams.page = Math.floor(params.page);
    }
    if (typeof params?.per_page === 'number' && Number.isFinite(params.per_page) && params.per_page > 0) {
      queryParams.per_page = Math.floor(params.per_page);
    }

    const timeoutMs =
      typeof params?.timeout_ms === 'number' && Number.isFinite(params.timeout_ms) && params.timeout_ms > 0
        ? Math.floor(params.timeout_ms)
        : DEFAULT_READ_TIMEOUT_MS;

    const response = await this.client.get('/ai-diagnostics', {
      params: Object.keys(queryParams).length > 0 ? queryParams : undefined,
      timeout: timeoutMs,
    });
    return response.data;
  }

  async getAIDiagnosticsSummary(params?: { days?: number }) {
    const response = await this.client.get('/ai-diagnostics/summary', { params });
    return response.data;
  }

  async getLatestAIDiagnostic() {
    const response = await this.client.get('/ai-diagnostics/latest');
    return response.data;
  }

  async getDiagnosticQuestionnaire() {
    const response = await this.client.get('/diagnostics/questionnaire');
    return response.data;
  }

  async submitDiagnosticAssessment(responses: Record<string, any>, questionnaireId: number, isAnonymous: boolean = false) {
    const response = await this.client.post('/diagnostics/analyze', {
      responses,
      questionnaire_id: questionnaireId,
      is_anonymous: isAnonymous,
    });
    return response.data;
  }

  async getDiagnosticHistory() {
    const response = await this.client.get('/diagnostics/history');
    return response.data;
  }

  async getLatestDiagnostic() {
    const response = await this.client.get('/diagnostics/latest');
    return response.data;
  }

  async getDiagnosticTrends(days: number = 30) {
    const response = await this.client.get(`/diagnostics/trends?days=${days}`);
    return response.data;
  }

  async getCounselorDiagnosticDashboard() {
    const response = await this.client.get('/diagnostics/counselor-dashboard');
    return response.data;
  }

  async getStudentWellnessSummary(studentId?: number) {
    const params = studentId ? { student_id: studentId } : {};
    const response = await this.client.get('/student-wellness/summary', { params });
    return response.data;
  }

  async getStudentMoodToday() {
    const response = await this.client.get('/student-mood/today');
    return response.data;
  }

  async recordStudentMood(mood: 'great' | 'okay' | 'low' | 'stressed' | 'tired') {
    const response = await this.client.post('/student-mood', { mood });
    return response.data;
  }

  // Admin Analytics
  async getAdminAnalyticsDashboard() {
    const response = await this.client.get('/analytics/dashboard');
    return response.data;
  }

  // Activity Logs (Admin)
  async getActivityLogs(params?: { type?: string; search?: string; from?: string; to?: string }) {
    const response = await this.client.get('/activity-logs', { params });
    return response.data;
  }

  async getActivityLogStats() {
    const response = await this.client.get('/activity-logs/stats');
    return response.data;
  }

  // System Settings (Admin)
  async getSettings() {
    const response = await this.client.get('/settings');
    return response.data;
  }

  async updateSettings(settings: Record<string, any>) {
    const response = await this.client.put('/settings', { settings });
    return response.data;
  }

  async clearCache() {
    const response = await this.client.post('/settings/clear-cache');
    return response.data;
  }

  // Backup & DR (Admin)
  async getBackupRuns(params?: { limit?: number }) {
    const response = await this.client.get('/backups', { params });
    return response.data;
  }

  async verifyBackups() {
    const response = await this.client.post('/backups/verify');
    return response.data;
  }

  async runBackupDrill(path?: string) {
    const payload = path && path.trim() !== '' ? { path: path.trim() } : {};
    const response = await this.client.post('/backups/drill', payload);
    return response.data;
  }

  // Integrations (Admin)
  async getAcademicRiskEvents(params?: { status?: string; risk_type?: string; limit?: number }) {
    const response = await this.client.get('/integrations/academic-risk/events', { params });
    return response.data;
  }

  async getAcademicRiskRuns(params?: { limit?: number }) {
    const response = await this.client.get('/integrations/academic-risk/runs', { params });
    return response.data;
  }

  // Panic Logs
  async createPanicLog(data: { location?: string }) {
    const response = await this.client.post('/panic-logs', data);
    return response.data;
  }

  async getPanicLogs() {
    const response = await this.client.get('/panic-logs');
    return response.data;
  }

  async updatePanicLog(id: number | string, data: { resolved?: boolean }) {
    const response = await this.client.put(`/panic-logs/${id}`, data);
    return response.data;
  }

  // AI Wellness Chat
  async aiWellnessChat(
    message: string,
    history: Array<{role: string, content: string}> = [],
    conversationId?: number | null
  ) {
    const response = await this.client.post('/ai/wellness-chat', {
      message,
      history,
      conversation_id: conversationId ?? undefined,
    });
    return ensureObjectPayload(
      response.data,
      'AI service is offline right now. The backend API is not responding correctly.'
    );
  }

  async getAIWellnessHistory(conversationId?: number | null) {
    const response = await this.client.get('/ai/wellness-chat/history', {
      params: {
        conversation_id: conversationId ?? undefined,
      },
    });
    return ensureObjectPayload(
      response.data,
      'AI conversation history is unavailable because the backend API is not responding correctly.'
    );
  }

  async getAIWellnessStatus() {
    const response = await this.client.get('/ai/wellness-chat/status', {
      timeout: DEFAULT_READ_TIMEOUT_MS,
    });

    return ensureObjectPayload(
      response.data,
      'AI status check returned an invalid response.'
    );
  }

  async getReadiness() {
    const response = await this.client.get('/ready', {
      timeout: DEFAULT_READ_TIMEOUT_MS,
    });

    return ensureObjectPayload(
      response.data,
      'Backend readiness check returned an invalid response.'
    );
  }

  // AI Diagnostics
  async analyzeSession(sessionId: string) {
    const response = await this.client.post(`/sessions/${sessionId}/analyze`);
    return response.data;
  }

  // Counselor Wellness
  async getCounselorWellness(counselorId?: number) {
    const params = counselorId ? { counselor_id: counselorId } : {};
    const response = await this.client.get('/counselor-wellness', { params });
    return response.data;
  }

  async getCounselorWellnessSummary(counselorId?: number) {
    const params = counselorId ? { counselor_id: counselorId } : {};
    const response = await this.client.get('/counselor-wellness/summary', { params });
    return response.data;
  }

  async createCounselorWellness(data: {
    mood_score?: number;
    stress_level?: number;
    burnout_index?: number;
    notes?: string;
    check_in?: {
      emotional_drain: number;
      disconnect_difficulty: number;
      calm_control: number;
      energy_level: number;
      break_quality: number;
      support_level: number;
      sleep_quality: number;
      burnout_worry: number;
    };
  }) {
    const response = await this.client.post('/counselor-wellness', data);
    return response.data;
  }

  async runCounselorHealthCheck(counselorId?: number) {
    const data = counselorId ? { counselor_id: counselorId } : {};
    const response = await this.client.post('/counselor-wellness/health-check', data);
    return response.data;
  }

  // Profile
  async getProfile() {
    const response = await this.client.get('/profile');
    return response.data;
  }

  async updateProfile(data: { full_name?: string; id_number?: string; email?: string; avatar_url?: string; anonymous_mode?: boolean }) {
    const response = await this.client.put('/profile', data);
    return response.data;
  }

  // AI Reports (Admin)
  async getAIReports() {
    const response = await this.client.get('/ai-reports');
    return response.data;
  }

  async getAIReport(id: string) {
    const response = await this.client.get(`/ai-reports/${id}`);
    return response.data;
  }

  async generateAIReport(type: 'weekly_heatmap' | 'monthly_trend' | 'risk_assessment' | 'counselor_burnout') {
    const response = await this.client.post('/ai-reports/generate', { type });
    return response.data;
  }

  async deleteAIReport(id: string) {
    const response = await this.client.delete(`/ai-reports/${id}`);
    return response.data;
  }
}

export const api = new ApiClient();
