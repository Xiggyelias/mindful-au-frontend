export const normalizeChatRole = (role?: string | null) => {
  const value = String(role || "").trim();
  if (value === "peer_counselor" || value === "counselor" || value === "student" || value === "admin") {
    return value;
  }
  return "student";
};

export const chatRoleLabel = (role?: string | null) => {
  switch (normalizeChatRole(role)) {
    case "peer_counselor":
      return "Peer Counselor";
    case "counselor":
      return "Counselor";
    case "admin":
      return "Admin";
    default:
      return "Student";
  }
};

export const chatRoleBadgeClass = (role?: string | null) => {
  switch (normalizeChatRole(role)) {
    case "peer_counselor":
      return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200";
    case "counselor":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200";
    case "admin":
      return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-200";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200";
  }
};

export const chatAvatarClass = (role?: string | null) => {
  switch (normalizeChatRole(role)) {
    case "peer_counselor":
      return "bg-sky-500";
    case "counselor":
      return "bg-emerald-600";
    case "admin":
      return "bg-violet-600";
    default:
      return "bg-slate-600";
  }
};

export const chatSenderDisplayName = (message: any, fallback = "Participant") => {
  const sender = message.sender as { name?: string } | undefined;
  const name = String(
    message.sender_display_name ||
      message.sender_name_snapshot ||
      sender?.name ||
      fallback
  ).trim();

  return name || fallback;
};

export const chatInitials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
};
