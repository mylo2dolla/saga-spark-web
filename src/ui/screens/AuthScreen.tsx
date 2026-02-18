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
import { redactText, sanitizeError } from "@/lib/observability/redact";
import { createLogger } from "@/lib/observability/logger";
import { recordHealthFailure, recordHealthSuccess } from "@/lib/observability/health";

interface AuthScreenProps {
  mode: "login" | "signup";
}

const logger = createLogger("auth-screen");

export default function AuthScreen({ mode }: AuthScreenProps) {
  const navigate = useNavigate();
  const { lastError, setLastError, lastErrorAt, recordOperation } = useDiagnostics();
  useAuth(); // keep subscription active on auth screen
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authOp, setAuthOp] = useState<OperationState | null>(null);
  const [didCopyError, setDidCopyError] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    authStatus?: string;
    restStatus?: string;
    error?: string;
    authDetail?: string;
  } | null>(null);
  const [authDebug, setAuthDebug] = useState<{
    message?: string;
    status?: number | null;
    code?: string | null;
    name?: string | null;
  } | null>(null);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const [authTestResult, setAuthTestResult] = useState<string | null>(null);
  const [isAuthTesting, setIsAuthTesting] = useState(false);
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

    try {
      const { result } = await runOperation({
        name: `auth.${mode}`,
        signal: controller.signal,
        // Supabase auth can intermittently be slow/variable behind Cloudflare. Use a higher budget
        // and rely on explicit cancel + connectivity checks to avoid false timeouts.
        timeoutMs: 45_000,
        maxRetries: 1,
        onUpdate: (state) => {
          setAuthOp(state);
          recordOperation(state);
        },
        run: async ({ signal }) => {
          if (signal.aborted) {
            throw new DOMException("Operation aborted", "AbortError");
          }

          if (mode === "login") {
            const trimmedEmail = email.trim();
            const tokenUrl = `${supabaseUrl}/auth/v1/token?grant_type=password`;
            const tokenRes = await fetch(tokenUrl, {
              method: "POST",
              headers: {
                apikey: supabaseAnonKey,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ email: trimmedEmail, password }),
              signal,
            });

            if (!tokenRes.ok) {
              const requestId =
                tokenRes.headers.get("sb-request-id")
                ?? tokenRes.headers.get("x-request-id")
                ?? tokenRes.headers.get("cf-ray");
              let message = `Auth failed (${tokenRes.status})`;
              try {
                const json = await tokenRes.clone().json() as { error_description?: string; message?: string } | null;
                message = json?.error_description ?? json?.message ?? message;
              } catch {
                // Non-JSON responses (e.g. Cloudflare HTML 522) are expected in some outage modes.
                message = tokenRes.status === 522 ? "Supabase auth gateway timed out (522)" : message;
              }
              if (requestId) {
                message = `${message} (requestId: ${requestId})`;
              }
              throw Object.assign(new Error(message), { status: tokenRes.status });
            }

            const tokenJson = await tokenRes.json() as { access_token?: string; refresh_token?: string };
            if (!tokenJson.access_token || !tokenJson.refresh_token) {
              throw new Error("Auth completed without tokens");
            }

            const setRes = await supabase.auth.setSession({
              access_token: tokenJson.access_token,
              refresh_token: tokenJson.refresh_token,
            });
            if (setRes.error) throw setRes.error;
            return { session: setRes.data.session, user: setRes.data.user };
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
      const message = formatError(error, "Failed to authenticate");
      setLastError(message);
      setAuthDebug({
        message: normalized.message,
        status: (error as { status?: number })?.status ?? null,
        code: normalized.code,
        name: (error as { name?: string })?.name ?? null,
      });
      recordHealthFailure("auth", error);
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
                <div className="font-semibold">Auth error</div>
                <div className="break-words">{lastError}</div>
                {authDebug ? (
                  <div className="mt-2 text-xs text-destructive/80">
                    Debug: {authDebug.name ?? "Error"} | status {authDebug.status ?? "?"} | code {authDebug.code ?? "?"}
                  </div>
                ) : null}
                {lastErrorAt ? (
                  <div className="mt-1 text-xs text-destructive/80">
                    {new Date(lastErrorAt).toLocaleTimeString()}
                  </div>
                ) : null}
              </div>
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
        ) : null}
        <div className="rounded-lg border border-border bg-background/30 p-3 text-xs text-muted-foreground">
          <div className="mb-2 font-semibold text-foreground">Connectivity Check</div>
          <div className="mb-2">Supabase URL: <span className="font-mono">{supabaseUrl || "(missing)"}</span></div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isChecking || !supabaseUrl}
              onClick={async () => {
                if (!supabaseUrl) return;
                setIsChecking(true);
                setCheckResult(null);
                try {
                  const headers = supabaseAnonKey ? { apikey: supabaseAnonKey } : undefined;
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 12_000);
                  const [authRes, restRes] = await Promise.all([
                    fetch(`${supabaseUrl}/auth/v1/health`, { method: "GET", headers, signal: controller.signal }),
                    fetch(`${supabaseUrl}/rest/v1/`, { method: "GET", headers, signal: controller.signal }),
                  ]).finally(() => clearTimeout(timeoutId));
                  setCheckResult({
                    authStatus: `auth ${authRes.status}${authRes.status === 401 ? " (key required)" : ""}`,
                    restStatus: `rest ${restRes.status}${restRes.status === 401 ? " (key required)" : ""}`,
                  });
                } catch (e) {
                  setCheckResult({ error: e instanceof Error ? e.message : "Connectivity check failed" });
                } finally {
                  setIsChecking(false);
                }
              }}
            >
              {isChecking ? "Checking..." : "Run Check"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isAuthTesting || !supabaseUrl || !supabaseAnonKey || !email.trim() || !password.trim()}
              onClick={async () => {
                if (!supabaseUrl || !supabaseAnonKey) return;
                setIsAuthTesting(true);
                setAuthTestResult(null);
                try {
                  const controller = new AbortController();
                  const timeoutId = setTimeout(() => controller.abort(), 12_000);
                  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                    method: "POST",
                    headers: {
                      apikey: supabaseAnonKey,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ email, password }),
                    signal: controller.signal,
                  }).finally(() => clearTimeout(timeoutId));
                  const text = await res.text();
                  const redacted = redactText(text);
                  const snippet = redacted.length > 200 ? `${redacted.slice(0, 200)}...` : redacted;
                  setAuthTestResult(`status ${res.status} ${res.statusText} :: ${snippet || "(empty body)"}`);
                  setCheckResult((prev) => ({ ...(prev ?? {}), authDetail: `token ${res.status}` }));
                } catch (e) {
                  setAuthTestResult(e instanceof Error ? e.message : "Auth test failed");
                } finally {
                  setIsAuthTesting(false);
                }
              }}
            >
              {isAuthTesting ? "Testing..." : "Auth Test"}
            </Button>
            {checkResult?.error ? (
              <span className="text-destructive">{checkResult.error}</span>
            ) : checkResult ? (
              <span className="text-muted-foreground">
                {checkResult.authStatus ?? "auth ?"} · {checkResult.restStatus ?? "rest ?"}
              </span>
            ) : null}
          </div>
          {authTestResult ? (
            <div className="mt-2 rounded border border-border bg-background/40 p-2 text-[11px] text-muted-foreground">
              Auth test: {authTestResult}
            </div>
          ) : null}
          <div className="mt-2 text-[11px] text-muted-foreground">
            If this fails, it’s usually DNS/router blocking `supabase.co` or a captive network. This check tells us whether the router is the problem.
          </div>
        </div>
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
