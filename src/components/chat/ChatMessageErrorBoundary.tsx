import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

type Props = { children: ReactNode };

type State = { hasError: boolean };

/**
 * Prevents a single bad message render from blanking the whole thread.
 */
export class ChatMessageErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.warn("[chat] Message render error", error, info.componentStack);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-950/40 px-3 py-2 text-sm text-amber-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p className="leading-snug">This message could not be displayed. Try reloading the conversation.</p>
        </div>
      );
    }
    return this.props.children;
  }
}
