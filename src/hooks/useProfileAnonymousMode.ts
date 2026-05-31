/**
 * Unified hook for toggling the user's profile-level anonymous mode.
 *
 * Every student page that offers an anonymous-mode toggle should use this
 * instead of re-implementing the confirm -> api -> refreshUser -> dispatch cycle.
 */
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { api, getApiErrorMessage } from "@/lib/api";
import { isProfileAnonymousMode } from "@/lib/anonymousMode";
import {
  PROFILE_ANON_MODE_OFF_CONFIRMATION,
  getProfileAnonymousModeSuccessTitle,
  PROFILE_ANON_MODE_TOAST_DESCRIPTION,
  PROFILE_ANON_MODE_UPDATE_ERROR,
} from "@/lib/profileAnonymousMode";
import { dispatchChatAnonymitySync } from "@/lib/chatRealtimeEvents";
import { useConfirm } from "@/hooks/useConfirm";

export interface UseProfileAnonymousModeReturn {
  /** Current profile-level anonymous mode derived from `user.profile.anonymous_mode`. */
  profileAnonymousMode: boolean;
  /** Whether the API call to toggle anonymous mode is in flight. */
  isSaving: boolean;
  /**
   * Toggle anonymous mode for the current user's profile.
   * Handles confirmation dialogs, API call, user refresh, and toast feedback.
   * Pass `true` to turn on anonymous mode, `false` to turn it off.
   */
  toggleProfileAnonymousMode: (nextChecked: boolean) => Promise<boolean>;
}

export function useProfileAnonymousMode(): UseProfileAnonymousModeReturn {
  const { user, refreshUser } = useAuth();
  const { confirm } = useConfirm();
  const [isSaving, setIsSaving] = useState(false);

  const profileAnonymousMode = isProfileAnonymousMode(user?.profile?.anonymous_mode);

  const toggleProfileAnonymousMode = useCallback(
    async (nextChecked: boolean) => {
      if (!user?.id || isSaving) return false;

      const current = isProfileAnonymousMode(user.profile?.anonymous_mode);
      if (current === nextChecked) return true;

      if (current && !nextChecked) {
        const ok = await confirm(PROFILE_ANON_MODE_OFF_CONFIRMATION);
        if (!ok) return false;
      }

      setIsSaving(true);
      try {
        await api.updateProfile({ anonymous_mode: nextChecked });
        await refreshUser();
        dispatchChatAnonymitySync();
        toast.success(getProfileAnonymousModeSuccessTitle(nextChecked), {
          description: PROFILE_ANON_MODE_TOAST_DESCRIPTION,
        });
        return true;
      } catch (error: unknown) {
        const message = getApiErrorMessage(error, "Failed to update anonymous mode");
        toast.error(message || PROFILE_ANON_MODE_UPDATE_ERROR);
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [confirm, isSaving, refreshUser, user?.id, user?.profile?.anonymous_mode],
  );

  return {
    profileAnonymousMode,
    isSaving,
    toggleProfileAnonymousMode,
  };
}
