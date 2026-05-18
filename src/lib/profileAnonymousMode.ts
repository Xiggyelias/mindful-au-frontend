export const PROFILE_ANON_MODE_OFF_CONFIRMATION =
  "Turning off anonymous mode will show your real name to counselors in chat. Continue?";

export const PROFILE_ANON_MODE_TOAST_DESCRIPTION =
  "This is your default for new conversations. Open chats stay as they are until you change them in the chat.";

export const PROFILE_ANON_MODE_UPDATE_ERROR = "Could not update anonymous mode.";

export function getProfileAnonymousModeSuccessTitle(nextChecked: boolean): string {
  return nextChecked ? "Anonymous mode is on." : "Anonymous mode is off.";
}
