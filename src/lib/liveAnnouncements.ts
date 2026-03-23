export type LiveAnnouncementPriority = "polite" | "assertive";

export type LiveAnnouncement = {
  id: number;
  message: string;
  priority: LiveAnnouncementPriority;
};

type LiveAnnouncementListener = (announcement: LiveAnnouncement) => void;

const listeners = new Set<LiveAnnouncementListener>();
let nextAnnouncementId = 1;

export const announceLiveMessage = (
  message: string,
  priority: LiveAnnouncementPriority = "polite"
): void => {
  const normalizedMessage = message.trim();
  if (normalizedMessage === "") {
    return;
  }

  const announcement: LiveAnnouncement = {
    id: nextAnnouncementId++,
    message: normalizedMessage,
    priority,
  };

  listeners.forEach((listener) => {
    listener(announcement);
  });
};

export const subscribeLiveAnnouncements = (
  listener: LiveAnnouncementListener
): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};
