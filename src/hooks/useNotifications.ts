import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export type AppNotificationType = "info" | "warning" | "success" | "error" | "panic";

export interface AppNotification {
  id: number;
  title: string;
  message: string;
  type: AppNotificationType;
  read: boolean;
  created_at: string;
  updated_at?: string;
}

interface NotificationsState {
  notifications: AppNotification[];
  unreadCount: number;
}

const POLL_INTERVAL_MS = 15000;
const DEFAULT_LIMIT = 30;
const POLL_MIN_GAP_MS = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const normalizeNotification = (value: unknown): AppNotification | null => {
  if (!isRecord(value)) return null;

  const id = Number(value.id);
  const title = typeof value.title === "string" ? value.title : "";
  const message = typeof value.message === "string" ? value.message : "";
  const type = typeof value.type === "string" ? (value.type as AppNotificationType) : "info";
  const read = Boolean(value.read);
  const createdAt = typeof value.created_at === "string" ? value.created_at : "";
  const updatedAt = typeof value.updated_at === "string" ? value.updated_at : undefined;

  if (!Number.isFinite(id) || !title || !message) return null;

  return {
    id,
    title,
    message,
    type,
    read,
    created_at: createdAt,
    updated_at: updatedAt,
  };
};

const normalizeNotificationPayload = (value: unknown): NotificationsState => {
  if (Array.isArray(value)) {
    const notifications = value
      .map((item) => normalizeNotification(item))
      .filter((item): item is AppNotification => item !== null);
    return {
      notifications,
      unreadCount: notifications.filter((notification) => !notification.read).length,
    };
  }

  if (isRecord(value)) {
    // Non-paginated branch: { notifications, unread_count }
    if (Array.isArray(value.notifications)) {
      const notifications = value.notifications
        .map((item) => normalizeNotification(item))
        .filter((item): item is AppNotification => item !== null);

      const unreadCountRaw = Number(value.unread_count);
      const unreadCount = Number.isFinite(unreadCountRaw)
        ? unreadCountRaw
        : notifications.filter((notification) => !notification.read).length;

      return {
        notifications,
        unreadCount,
      };
    }

    // Paginated branch (PaginationPayload): { data: [...], meta: {...}, unread_count }
    if (Array.isArray(value.data)) {
      const notifications = value.data
        .map((item) => normalizeNotification(item))
        .filter((item): item is AppNotification => item !== null);

      const unreadCountRaw = Number(value.unread_count);
      const unreadCount = Number.isFinite(unreadCountRaw)
        ? unreadCountRaw
        : notifications.filter((notification) => !notification.read).length;

      return {
        notifications,
        unreadCount,
      };
    }
  }

  return { notifications: [], unreadCount: 0 };
};

export const useNotifications = () => {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const announcedNotificationIdsRef = useRef<Set<number>>(new Set());
  const hasPrimedNotificationCacheRef = useRef(false);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const lastLoadAtRef = useRef(0);

  const loadNotifications = useCallback(
    async (options?: { silent?: boolean; force?: boolean }) => {
      if (!user?.id) {
        setNotifications([]);
        setUnreadCount(0);
        setError(null);
        announcedNotificationIdsRef.current.clear();
        hasPrimedNotificationCacheRef.current = false;
        loadInFlightRef.current = null;
        lastLoadAtRef.current = 0;
        return;
      }

      const silent = Boolean(options?.silent);
      const force = Boolean(options?.force);
      if (loadInFlightRef.current) {
        await loadInFlightRef.current;
        return;
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setError(null);
        if (!silent) {
          setIsLoading(false);
        }
        return;
      }

      if (!force && Date.now() - lastLoadAtRef.current < POLL_MIN_GAP_MS) {
        return;
      }

      const requestPromise = (async () => {
        if (!silent) {
          setIsLoading(true);
        }

        try {
          const response = await api.getNotifications({ limit: DEFAULT_LIMIT });
          const normalized = normalizeNotificationPayload(response);

          const newUnreadNotifications = normalized.notifications.filter(
            (notification) =>
              !notification.read && !announcedNotificationIdsRef.current.has(notification.id)
          );
          if (hasPrimedNotificationCacheRef.current && newUnreadNotifications.length > 0) {
            newUnreadNotifications.slice(0, 3).forEach((notification) => {
              if (notification.type === "panic") {
                // Panic notifications are surfaced with an error-style toast,
                // a long duration, and optional vibration so responders cannot
                // miss them.
                toast.error(notification.title, {
                  description: notification.message,
                  duration: 30000,
                });
                if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
                  try {
                    navigator.vibrate([200, 100, 200, 100, 200]);
                  } catch {
                    // Vibration is best-effort; ignore platform errors.
                  }
                }
              } else if (notification.type === "error") {
                toast.error(notification.title, {
                  description: notification.message,
                });
              } else if (notification.type === "warning") {
                toast.warning(notification.title, {
                  description: notification.message,
                });
              } else if (notification.type === "success") {
                toast.success(notification.title, {
                  description: notification.message,
                });
              } else {
                toast(notification.title, {
                  description: notification.message,
                });
              }
            });
          }

          normalized.notifications.forEach((notification) => {
            announcedNotificationIdsRef.current.add(notification.id);
          });
          hasPrimedNotificationCacheRef.current = true;

          setNotifications(normalized.notifications);
          setUnreadCount(normalized.unreadCount);
          setError(null);
        } catch (err: unknown) {
          const message =
            isRecord(err) &&
            isRecord(err.response) &&
            isRecord(err.response.data) &&
            typeof err.response.data.message === "string"
              ? err.response.data.message
              : "Failed to load notifications";
          setError(message);
        } finally {
          lastLoadAtRef.current = Date.now();
          if (!silent) {
            setIsLoading(false);
          }
        }
      })();

      loadInFlightRef.current = requestPromise;
      try {
        await requestPromise;
      } finally {
        loadInFlightRef.current = null;
      }
    },
    [user?.id]
  );

  const refreshNotifications = useCallback(async () => {
    await loadNotifications({ silent: true, force: true });
  }, [loadNotifications]);

  const markAsRead = useCallback(
    async (id: number) => {
      const target = notifications.find((notification) => notification.id === id);
      if (!target || target.read) return;

      setNotifications((previous) =>
        previous.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification
        )
      );
      setUnreadCount((previous) => Math.max(0, previous - 1));

      try {
        const response = await api.markNotificationRead(id);
        if (isRecord(response) && Number.isFinite(Number(response.unread_count))) {
          setUnreadCount(Number(response.unread_count));
        }
      } catch {
        await loadNotifications({ silent: true });
      }
    },
    [loadNotifications, notifications]
  );

  const markAllAsRead = useCallback(async () => {
    if (unreadCount === 0) return;

    setNotifications((previous) =>
      previous.map((notification) => ({ ...notification, read: true }))
    );
    setUnreadCount(0);

    try {
      const response = await api.markAllNotificationsRead();
      if (isRecord(response) && Number.isFinite(Number(response.unread_count))) {
        setUnreadCount(Number(response.unread_count));
      }
    } catch {
      await loadNotifications({ silent: true });
    }
  }, [loadNotifications, unreadCount]);

  useEffect(() => {
    if (!user?.id) return;

    void loadNotifications();

    const onVisibilityOrFocus = () => {
      if (document.visibilityState !== "visible") return;
      void loadNotifications({ silent: true });
    };

    const onOnline = () => {
      if (document.visibilityState !== "visible") return;
      void loadNotifications({ silent: true, force: true });
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadNotifications({ silent: true });
    }, POLL_INTERVAL_MS);

    window.addEventListener("focus", onVisibilityOrFocus);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onVisibilityOrFocus);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [loadNotifications, user?.id]);

  return {
    notifications,
    unreadCount,
    isLoading,
    error,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
  };
};
