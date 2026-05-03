import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
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
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-6 animate-in fade-in duration-500 min-h-[400px]">
          <div className="p-4 rounded-full bg-destructive/10 text-destructive">
            <AlertCircle className="h-12 w-12" />
          </div>
          <div className="space-y-2">
            <h2 className="text-xl font-bold tracking-tight">Something went wrong</h2>
            <p className="text-muted-foreground max-w-xs mx-auto">
              The clinical chat encountered an unexpected error. This might be due to a connection issue or an encryption sync failure.
            </p>
          </div>
          <Button 
            onClick={this.handleReset}
            className="rounded-full gap-2 shadow-lg shadow-primary/20"
          >
            <RotateCcw className="h-4 w-4" />
            Reload Page
          </Button>
          {process.env.NODE_ENV === 'development' && (
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
