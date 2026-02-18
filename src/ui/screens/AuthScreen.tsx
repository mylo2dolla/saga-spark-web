import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useAuth } from "@/hooks/useAuth";
import { runOperation } from "@/lib/ops/runOperation";
import type { OperationState } from "@/lib/ops/operationState";
import { sanitizeError } from "@/lib/observability/redact";
import { createLogger } from "@/lib/observability/logger";
import { recordHealthFailure, recordHealthSuccess } from "@/lib/observability/health";

interface AuthScreenProps {
  mode: "login" | "signup";
}

const logger = createLogger("auth-screen");
const AUTH_OPERATION_TIMEOUT_MS = 45_000;
const AUTH_OPERATION_RETRIES = 1;

interface AuthFailureDescriptor {
  status: number | null;
  code: string | null;
  requestId: string | null;
  message: string;
}

const errorRequestId = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const payload = error as Record<string, unknown>;
  const details = payload.details && typeof payload.details === "object"
    ? payload.details as Record<string, unknown>
    : null;
  return (
    (typeof payload.requestId === "string" ? payload.requestId : null)
    ?? (typeof payload.request_id === "string" ? payload.request_id : null)
    ?? (typeof payload.sb_request_id === "string" ? payload.sb_request_id : null)
    ?? (typeof details?.requestId === "string" ? details.requestId : null)
    ?? (typeof details?.request_id === "string" ? details.request_id : null)
    ?? (typeof details?.sb_request_id === "string" ? details.sb_request_id : null)
    ?? null
  );
};

const classifyAuthFailure = (error: unknown): AuthFailureDescriptor => {
  const normalized = sanitizeError(error);
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? Number((error as { status: number }).status)
    : null;
  const requestId = errorRequestId(error);
  const lower = normalized.message.toLowerCase();
  const has522Signal =
    status === 522
    || lower.includes("error code 522")
    || lower.includes("connection timed out")
    || lower.includes("cloudflare 522");
  const hasTimeoutSignal = lower.includes("timed out") || lower.includes("timeout");
  const hasNetworkSignal = lower.includes("failed to fetch") || lower.includes("network") || lower.includes("load failed");

  if (has522Signal || hasTimeoutSignal) {
    return {
      status: status ?? 522,
      code: "auth_gateway_timeout",
      requestId,
      message: `Supabase auth gateway unreachable. Retry in a moment or switch networks.${requestId ? ` sb-request-id: ${requestId}` : ""}`,
    };
  }
  if (hasNetworkSignal) {
    return {
      status: status ?? 503,
      code: "network_unreachable",
      requestId,
      message: `Supabase auth network path failed. Check DNS/router and retry.${requestId ? ` requestId: ${requestId}` : ""}`,
    };
  }
  return {
    status,
    code: normalized.code,
    requestId,
    message: normalized.message,
  };
};

export default function AuthScreen({ mode }: AuthScreenProps) {
  const navigate = useNavigate();
  const { lastError, setLastError, lastErrorAt, recordOperation, setAuthProbe } = useDiagnostics();
  useAuth(); // keep subscription active on auth screen
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authOp, setAuthOp] = useState<OperationState | null>(null);
  const [didCopyError, setDidCopyError] = useState(false);
  const [authDebug, setAuthDebug] = useState<{
    message?: string;
    status?: number | null;
    code?: string | null;
    name?: string | null;
    requestId?: string | null;
  } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const isSubmitting = authOp?.status === "RUNNING" || authOp?.status === "PENDING";
  const pendingSeconds = authOp?.started_at ? Math.max(1, Math.floor((Date.now() - authOp.started_at) / 1000)) : 0;

  const cancelSubmit = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();

    if (!email.trim() || !password.trim()) {
      setLastError("Email and password are required.");
      return;
    }

    if (isSubmitting) {
      logger.warn("auth.submit.blocked", { reason: "already_running", mode });
      return;
    }

    setLastError(null);
    setAuthDebug(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const submitStartedAt = Date.now();

    try {
      const { result } = await runOperation({
        name: `auth.${mode}`,
        signal: controller.signal,
        timeoutMs: AUTH_OPERATION_TIMEOUT_MS,
        maxRetries: AUTH_OPERATION_RETRIES,
        onUpdate: (state) => {
          setAuthOp(state);
          recordOperation(state);
        },
        run: async ({ signal }) => {
          if (signal.aborted) {
            throw new DOMException("Operation aborted", "AbortError");
          }

          if (mode === "login") {
            const response = await supabase.auth.signInWithPassword({
              email: email.trim(),
              password,
            });
            if (response.error) throw response.error;
            return { session: response.data.session, user: response.data.user };
          }

          const response = await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: { display_name: displayName || email.split("@")[0] },
            },
          });
          if (response.error) throw response.error;
          return { session: response.data.session, user: response.data.user };
        },
      });

      if (mode === "login") {
        if (!result.session) {
          throw new Error("Sign-in completed without an active session");
        }
        setAuthProbe({
          endpoint: "auth_login",
          status: 200,
          request_id: null,
          latency_ms: Date.now() - submitStartedAt,
          checked_at: Date.now(),
          code: null,
          message: "ok",
        });
        recordHealthSuccess("auth", 0);
        navigate("/dashboard");
        return;
      }

      if (result.user && !result.session) {
        setLastError("Account created. Check your email to confirm and then log in.");
        return;
      }

      if (result.session) {
        navigate("/dashboard");
      }
    } catch (error) {
      const normalized = sanitizeError(error);
      const classified = classifyAuthFailure(error);
      const message = classified.message || formatError(error, "Failed to authenticate");
      const operationLatency = Date.now() - submitStartedAt;
      setLastError(message);
      setAuthDebug({
        message: normalized.message,
        status: classified.status,
        code: classified.code ?? normalized.code,
        name: (error as { name?: string })?.name ?? null,
        requestId: classified.requestId,
      });
      setAuthProbe({
        endpoint: "auth_login",
        status: classified.status,
        request_id: classified.requestId,
        latency_ms: operationLatency,
        checked_at: Date.now(),
        code: classified.code ?? normalized.code,
        message,
      });
      recordHealthFailure("auth", error, operationLatency, {
        route: "supabase-auth",
        code: classified.code ?? normalized.code,
      });
      logger.error("auth.submit.failed", error, { mode });
    } finally {
      abortRef.current = null;
    }
  };

  return (
    <div className="mx-auto w-full max-w-md rounded-xl border border-border bg-card p-6">
      <h1 className="mb-2 text-2xl font-semibold">
        {mode === "login" ? "Welcome back" : "Create account"}
      </h1>
      <p className="mb-6 text-sm text-muted-foreground">
        {mode === "login" ? "Sign in to continue." : "Start a new campaign."}
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {mode === "signup" ? (
          <div className="space-y-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Name"
            />
          </div>
        ) : null}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        <Button className="w-full" type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Working..." : mode === "login" ? "Login" : "Sign up"}
        </Button>
        {isSubmitting ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-background/30 p-3 text-xs text-muted-foreground">
            <div>Auth request pending for {pendingSeconds}s</div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={cancelSubmit}
            >
              Cancel
            </Button>
          </div>
        ) : null}
        {lastError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">
                  {authDebug?.code === "auth_gateway_timeout" ? "Supabase auth gateway unreachable" : "Auth error"}
                </div>
                <div className="break-words">{lastError}</div>
                {authDebug ? (
                  <div className="mt-2 text-xs text-destructive/80">
                    Status {authDebug.status ?? "?"} | code {authDebug.code ?? "?"}
                  </div>
                ) : null}
                {authDebug?.requestId ? (
                  <div className="mt-1 text-xs text-destructive/80">
                    requestId: {authDebug.requestId}
                  </div>
                ) : null}
                {lastErrorAt ? (
                  <div className="mt-1 text-xs text-destructive/80">
                    {new Date(lastErrorAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={async () => {
                    setDidCopyError(false);
                    try {
                      await navigator.clipboard.writeText(lastError);
                      setDidCopyError(true);
                      setTimeout(() => setDidCopyError(false), 1500);
                    } catch {
                      // Clipboard denied.
                    }
                  }}
                >
                  {didCopyError ? "Copied" : "Copy"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </form>

      <div className="mt-4 text-xs text-muted-foreground">
        {mode === "login" ? (
          <span>
            Need an account? <Link to="/signup" className="text-primary">Sign up</Link>
          </span>
        ) : (
          <span>
            Already have an account? <Link to="/login" className="text-primary">Log in</Link>
          </span>
        )}
      </div>
    </div>
  );
}
