/**
 * Programmatic confirm / prompt dialogs.
 *
 * Usage:
 *   const { confirm, prompt } = useConfirm();
 *
 *   // Instead of: if (window.confirm("Delete?")) { ... }
 *   if (await confirm("Delete?")) { ... }
 *
 *   // Instead of: const val = window.prompt("Enter reason:", "")
 *   const val = await prompt({ description: "Enter reason:", defaultValue: "" });
 *
 * Wrap your app with <ConfirmDialogProvider> once (already done in App.tsx).
 */

import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ─── Public option types ──────────────────────────────────────────────────────

export type ConfirmOptions = {
  /** Modal title. Defaults to "Are you sure?" */
  title?: string;
  /** Body text shown below the title. */
  description: string;
  /** Label for the confirm/OK button. Defaults to "Confirm". */
  confirmLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
  /**
   * Button colour scheme for the confirm action.
   * Use "destructive" for irreversible delete actions.
   */
  variant?: "default" | "destructive";
};

export type PromptOptions = ConfirmOptions & {
  /** Label rendered above the text input. */
  inputLabel?: string;
  /** Placeholder text for the text input. */
  inputPlaceholder?: string;
  /** Pre-filled value for the text input. */
  defaultValue?: string;
};

// ─── Context ─────────────────────────────────────────────────────────────────

type ConfirmContextType = {
  /**
   * Show a styled confirmation dialog and resolve with `true` (OK) or
   * `false` (Cancel).  Pass a plain string as shorthand for `{ description }`.
   */
  confirm: (options: ConfirmOptions | string) => Promise<boolean>;
  /**
   * Show a styled prompt dialog with a text input and resolve with the
   * entered string, or `null` if the user cancelled.
   * Pass a plain string as shorthand for `{ description }`.
   */
  prompt: (options: PromptOptions | string) => Promise<string | null>;
};

const ConfirmContext = createContext<ConfirmContextType | null>(null);

// ─── Internal dialog state ────────────────────────────────────────────────────

type DialogStateClosed = { open: false };

type DialogStateConfirm = {
  open: true;
  mode: "confirm";
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "default" | "destructive";
  resolve: (value: boolean) => void;
};

type DialogStatePrompt = {
  open: true;
  mode: "prompt";
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  variant: "default" | "destructive";
  inputLabel: string;
  inputPlaceholder: string;
  resolve: (value: string | null) => void;
};

type DialogState = DialogStateClosed | DialogStateConfirm | DialogStatePrompt;

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ConfirmDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState>({ open: false });
  const [inputValue, setInputValue] = useState("");
  // Guard against resolving the same promise twice (e.g. double-click).
  const resolvedRef = useRef(false);

  const close = useCallback(() => {
    resolvedRef.current = false;
    setDialog({ open: false });
    setInputValue("");
  }, []);

  const confirm = useCallback((options: ConfirmOptions | string): Promise<boolean> => {
    const opts = typeof options === "string" ? { description: options } : options;
    resolvedRef.current = false;
    return new Promise<boolean>((resolve) => {
      setDialog({
        open: true,
        mode: "confirm",
        title: opts.title ?? "Are you sure?",
        description: opts.description,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        variant: opts.variant ?? "default",
        resolve,
      });
    });
  }, []);

  const prompt = useCallback((options: PromptOptions | string): Promise<string | null> => {
    const opts = typeof options === "string" ? { description: options } : options;
    resolvedRef.current = false;
    setInputValue(opts.defaultValue ?? "");
    return new Promise<string | null>((resolve) => {
      setDialog({
        open: true,
        mode: "prompt",
        title: opts.title ?? "Input required",
        description: opts.description,
        confirmLabel: opts.confirmLabel ?? "Confirm",
        cancelLabel: opts.cancelLabel ?? "Cancel",
        variant: opts.variant ?? "default",
        inputLabel: opts.inputLabel ?? "",
        inputPlaceholder: opts.inputPlaceholder ?? "",
        resolve,
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!dialog.open || resolvedRef.current) return;
    resolvedRef.current = true;
    if (dialog.mode === "confirm") {
      dialog.resolve(true);
    } else {
      // Return null (treated as cancel) when the input is blank so callers
      // can rely on `null` meaning "user cancelled or provided nothing".
      dialog.resolve(inputValue.trim() === "" ? null : inputValue.trim());
    }
    close();
  }, [close, dialog, inputValue]);

  const handleCancel = useCallback(() => {
    if (!dialog.open || resolvedRef.current) return;
    resolvedRef.current = true;
    if (dialog.mode === "confirm") {
      dialog.resolve(false);
    } else {
      dialog.resolve(null);
    }
    close();
  }, [close, dialog]);

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}

      <AlertDialog open={dialog.open}>
        <AlertDialogContent>
          {dialog.open && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
                <AlertDialogDescription className="whitespace-pre-line">
                  {dialog.description}
                </AlertDialogDescription>
              </AlertDialogHeader>

              {dialog.mode === "prompt" && (
                <div className="space-y-1.5">
                  {dialog.inputLabel && (
                    <Label htmlFor="confirm-dialog-input">{dialog.inputLabel}</Label>
                  )}
                  <Input
                    id="confirm-dialog-input"
                    value={inputValue}
                    placeholder={dialog.inputPlaceholder}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleConfirm();
                    }}
                    autoFocus
                  />
                </div>
              )}

              <AlertDialogFooter>
                <Button variant="outline" onClick={handleCancel}>
                  {dialog.cancelLabel}
                </Button>
                <Button
                  variant={dialog.variant === "destructive" ? "destructive" : "default"}
                  onClick={handleConfirm}
                >
                  {dialog.confirmLabel}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useConfirm(): ConfirmContextType {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm() must be called inside a <ConfirmDialogProvider>.");
  }
  return ctx;
}
