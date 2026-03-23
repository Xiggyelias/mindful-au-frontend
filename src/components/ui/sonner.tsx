import { isValidElement, type ReactNode } from "react";
import { useTheme } from "next-themes";
/* eslint-disable react-refresh/only-export-components */
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner";
import { announceLiveMessage } from "@/lib/liveAnnouncements";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const flattenNodeText = (value: ReactNode): string => {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => flattenNodeText(item))
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  if (isValidElement(value)) {
    return flattenNodeText(
      (value as { props?: { children?: ReactNode } }).props?.children ?? null
    );
  }

  return "";
};

const announceToast = (
  message: ReactNode,
  options?: ExternalToast,
  priority: "polite" | "assertive" = "polite"
) => {
  const parts = [
    flattenNodeText(message),
    flattenNodeText(options?.description as ReactNode),
  ].filter(Boolean);

  if (parts.length > 0) {
    announceLiveMessage(parts.join(". "), priority);
  }
};

type ToastFn = typeof sonnerToast;

const toast = Object.assign(
  ((message: ReactNode, options?: ExternalToast) => {
    announceToast(message, options, "polite");
    return sonnerToast(message, options);
  }) as ToastFn,
  sonnerToast,
  {
    success: (message: ReactNode, options?: ExternalToast) => {
      announceToast(message, options, "polite");
      return sonnerToast.success(message, options);
    },
    info: (message: ReactNode, options?: ExternalToast) => {
      announceToast(message, options, "polite");
      return sonnerToast.info(message, options);
    },
    warning: (message: ReactNode, options?: ExternalToast) => {
      announceToast(message, options, "assertive");
      return sonnerToast.warning(message, options);
    },
    error: (message: ReactNode, options?: ExternalToast) => {
      announceToast(message, options, "assertive");
      return sonnerToast.error(message, options);
    },
  }
);

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
