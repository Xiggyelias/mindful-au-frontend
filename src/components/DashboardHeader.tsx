import { formatDistanceToNow } from "date-fns";
import { Bell, CheckCheck, Loader2, Menu, ShieldX, Volume2, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { useNotifications } from "@/hooks/useNotifications";
import { useAuth } from "@/hooks/useAuth";
import { SessionManagerDialog } from "./SessionManagerDialog";
import { NotificationSoundSettingsPanel } from "./settings/NotificationSoundSettingsPanel";
import { primeNotificationAudioFromUserGesture } from "@/lib/sounds/notificationSoundManager";

interface DashboardHeaderProps {
  title: string;
  onMenuClick?: () => void;
}

export const DashboardHeader = ({ title, onMenuClick }: DashboardHeaderProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const {
    notifications,
    unreadCount,
    isLoading,
    refreshNotifications,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  } = useNotifications();

  const formatTimestamp = (dateString?: string) => {
    if (!dateString) return "";
    try {
      return formatDistanceToNow(new Date(dateString), { addSuffix: true });
    } catch {
      return "";
    }
  };

  const handleQuickExit = () => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.sessionStorage.setItem("quick_exit_at", new Date().toISOString());
    } catch {
      // Ignore storage failures.
    }

    void signOut();

    const path = location.pathname.toLowerCase();
    const quickExitPath = path.startsWith("/admin")
      ? "/admin/login"
      : path.startsWith("/counselor")
      ? "/counselor/login"
      : path.startsWith("/peer")
      ? "/peer/login"
      : path.startsWith("/student")
      ? "/student/login"
      : "/";

    navigate(quickExitPath, { replace: true });
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-4 p-4 lg:p-6 bg-background/80 backdrop-blur-lg border-b border-border">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onMenuClick}
        >
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-xl lg:text-2xl font-display font-bold text-foreground">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="destructive"
          size="sm"
          onClick={handleQuickExit}
          className="hidden sm:inline-flex"
        >
          <ShieldX className="h-4 w-4 mr-2" />
          Quick Exit
        </Button>
        <Button
          variant="destructive"
          size="icon"
          onClick={handleQuickExit}
          className="sm:hidden"
          aria-label="Quick exit"
        >
          <ShieldX className="h-4 w-4" />
        </Button>
        <SessionManagerDialog />
        <ThemeToggle />
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Sound settings"
              onClick={() => primeNotificationAudioFromUserGesture()}
            >
              <Volume2 className="h-5 w-5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto max-w-[min(100vw-2rem,20rem)]">
            <p className="text-sm font-semibold mb-1">Sound & alerts</p>
            <NotificationSoundSettingsPanel />
          </PopoverContent>
        </Popover>
        <DropdownMenu onOpenChange={(open) => {
          if (open) {
            void refreshNotifications();
          }
        }}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 min-w-[0.95rem] h-[0.95rem] px-1 rounded-full bg-primary text-[9px] leading-none text-primary-foreground flex items-center justify-center">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[22rem] p-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
              <p className="text-sm font-semibold">Notifications</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                disabled={unreadCount === 0}
                onClick={() => void markAllAsRead()}
              >
                <CheckCheck className="h-3.5 w-3.5 mr-1" />
                Mark all
              </Button>
            </div>

            {isLoading ? (
              <div className="py-8 text-center text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin mx-auto mb-2" />
                Loading notifications...
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-8 px-4 text-center text-muted-foreground text-sm">
                No notifications yet
              </div>
            ) : (
              <ScrollArea className="max-h-96">
                <div className="py-1">
                  {notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      className={`group w-full text-left px-3 py-2.5 hover:bg-secondary/60 transition-colors border-b last:border-b-0 border-border/30 ${
                        notification.read ? "opacity-80" : ""
                      }`}
                      onClick={() => {
                        void markAsRead(notification.id);
                        
                        // Navigate based on notification type/content
                        const title = notification.title?.toLowerCase() ?? '';
                        const meta = notification.meta;
                        
                        const currentPath = location.pathname.toLowerCase();
                        let basePath = '/student';
                        if (currentPath.startsWith('/counselor')) basePath = '/counselor';
                        else if (currentPath.startsWith('/peer')) basePath = '/peer';
                        else if (currentPath.startsWith('/admin')) basePath = '/admin';

                        const getChatPath = () => {
                          if (basePath === '/counselor') return '/counselor/messages';
                          if (basePath === '/peer') return '/peer/chats';
                          if (basePath === '/admin') return '/admin/dashboard';
                          return '/student/chat';
                        };

                        if (meta?.chat_session_id) {
                          navigate(`${getChatPath()}?session=${meta.chat_session_id}`);
                        } else if (meta?.appointment_id) {
                          navigate(`${basePath}/appointments`);
                        } else if (title.includes('appointment')) {
                          navigate(`${basePath}/appointments`);
                        } else if (title.includes('session') || title.includes('message')) {
                          navigate(getChatPath());
                        } else if (title.includes('wellness')) {
                          navigate(`${basePath}/wellness`);
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${
                            notification.read ? "bg-muted-foreground/40" : "bg-primary"
                          }`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold truncate">{notification.title}</p>
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {formatTimestamp(notification.created_at)}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {notification.message}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation(); // prevent triggering the parent onClick
                            void deleteNotification(notification.id);
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
