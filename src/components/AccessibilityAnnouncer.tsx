import { useEffect, useState } from "react";
import {
  subscribeLiveAnnouncements,
  type LiveAnnouncement,
} from "@/lib/liveAnnouncements";

export const AccessibilityAnnouncer = () => {
  const [politeMessage, setPoliteMessage] = useState<LiveAnnouncement | null>(null);
  const [assertiveMessage, setAssertiveMessage] = useState<LiveAnnouncement | null>(null);

  useEffect(() => {
    return subscribeLiveAnnouncements((announcement: LiveAnnouncement) => {
      if (announcement.priority === "assertive") {
        setAssertiveMessage(announcement);
        return;
      }

      setPoliteMessage(announcement);
    });
  }, []);

  return (
    <div className="sr-only">
      <div role="status" aria-live="polite" aria-atomic="true">
        <span key={politeMessage?.id ?? "polite-empty"}>
          {politeMessage?.message ?? ""}
        </span>
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true">
        <span key={assertiveMessage?.id ?? "assertive-empty"}>
          {assertiveMessage?.message ?? ""}
        </span>
      </div>
    </div>
  );
};
