const LOGIN_CHAT_SECURITY_PREFIX = "chat_login_secured_";

const getLoginChatSecurityKey = (userId: string | number | null | undefined) => {
  const normalized = String(userId ?? "").trim();
  return normalized ? `${LOGIN_CHAT_SECURITY_PREFIX}${normalized}` : "";
};

export function hasCompletedLoginChatSecurity(userId: string | number | null | undefined): boolean {
  const key = getLoginChatSecurityKey(userId);
  if (!key || typeof sessionStorage === "undefined") {
    return false;
  }

  try {
    return sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function markLoginChatSecurityComplete(userId: string | number | null | undefined): void {
  const key = getLoginChatSecurityKey(userId);
  if (!key || typeof sessionStorage === "undefined") {
    return;
  }

  try {
    sessionStorage.setItem(key, "1");
  } catch {
    // Session storage can be unavailable in private / restricted contexts.
  }
}
