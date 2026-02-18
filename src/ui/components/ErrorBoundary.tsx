import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] Uncaught error", { message: error.message, stack: error.stack, info });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6">
          <div className="max-w-md rounded-lg border border-border bg-card p-6 text-sm">
            <div className="mb-2 text-lg font-semibold text-foreground">Something went wrong</div>
            <p className="text-muted-foreground">
              {this.state.error?.message ?? "Unexpected UI error"}
            </p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
