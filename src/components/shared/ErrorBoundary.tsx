import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
  title?: string;
  description?: string;
  /** When true, renders a compact page-level card rather than a full-screen overlay */
  inline?: boolean;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error("Uncaught error:", error, errorInfo);
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoBack = () => {
    window.history.back();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const title = this.props.title ?? "Something went wrong";
      const description =
        this.props.description ??
        "An unexpected error occurred on this page. Try again or go back.";

      // Compact inline card — used for per-route boundaries so the crash
      // is contained to the page area and the user can navigate away.
      if (this.props.inline) {
        return (
          <div className="min-h-screen bg-background flex items-center justify-center p-6">
            <div className="max-w-md w-full rounded-2xl border border-destructive/20 bg-destructive/5 p-8 text-center space-y-5 animate-in fade-in duration-300">
              <div className="mx-auto w-fit p-3 rounded-full bg-destructive/10 text-destructive">
                <AlertCircle className="h-8 w-8" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-bold tracking-tight">{title}</h2>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button variant="outline" size="sm" onClick={this.handleGoBack} className="gap-2">
                  <ArrowLeft className="h-4 w-4" />
                  Go back
                </Button>
                <Button size="sm" onClick={this.handleReset} className="gap-2">
                  <RotateCcw className="h-4 w-4" />
                  Try again
                </Button>
              </div>
              {import.meta.env.DEV && (
                <pre className="mt-2 p-3 rounded-lg bg-secondary/50 text-[10px] text-left overflow-auto">
                  {this.state.error?.toString()}
                </pre>
              )}
            </div>
          </div>
        );
      }

      // Full-screen fallback — used at the root level only
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 animate-in fade-in duration-500 min-h-[400px]">
          <div className="p-4 rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-12 w-12" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">{title}</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              An unexpected error occurred. Try reloading the page. If the problem continues, sign out and sign in again.
            </p>
          </div>
          <Button
            onClick={this.handleReload}
            className="rounded-full gap-2 shadow-lg shadow-primary/20"
          >
            <RotateCcw className="h-4 w-4" />
            Reload Page
          </Button>
          {import.meta.env.DEV && (
            <pre className="mt-4 p-4 rounded-lg bg-secondary/50 text-[10px] text-left overflow-auto max-w-full">
              {this.state.error?.toString()}
            </pre>
          )}
        </div>
      );
    }

    return this.props.children;
  }
}
