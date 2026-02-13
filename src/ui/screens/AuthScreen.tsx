import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useAuth } from "@/hooks/useAuth";

interface AuthScreenProps {
  mode: "login" | "signup";
}

export default function AuthScreen({ mode }: AuthScreenProps) {
  const navigate = useNavigate();
  const { lastError, setLastError, lastErrorAt } = useDiagnostics();
  useAuth(); // ensure auth subscription is active on the login screen
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSince, setPendingSince] = useState<number | null>(null);
  const submitLockRef = useRef(false);
  const submitAttemptRef = useRef(0);
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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const nativeEvent = event.nativeEvent as SubmitEvent | undefined;
    if (nativeEvent && nativeEvent.isTrusted === false) {
      console.info("[auth] log", { step: "login_submit_blocked_untrusted" });
      return;
    }
    if (!email.trim() || !password.trim()) {
      setLastError("Email and password are required.");
      return;
    }

    if (submitLockRef.current || isSubmitting) {
      console.info("[auth] log", { step: "login_submit_blocked" });
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    setPendingSince(Date.now());
    submitAttemptRef.current += 1;
    const attemptId = submitAttemptRef.current;
    setLastError(null);
    setAuthDebug(null);
    console.info("[auth] log", { step: "login_submit" });

    try {
      (globalThis as { __authSubmitInProgress?: boolean }).__authSubmitInProgress = true;
      console.info("[auth] log", { step: "login_signin_call" });
      const action = mode === "login"
        ? async () => {
          if (!supabaseUrl || !supabaseAnonKey) {
            throw new Error("Supabase env is not configured");
          }
          const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
            method: "POST",
            headers: {
              apikey: supabaseAnonKey,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ email, password }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            const msg = (json as { error_description?: string; error?: string })?.error_description
              ?? (json as { error?: string })?.error
              ?? "Login failed";
            throw new Error(msg);
          }
          const access_token = (json as { access_token?: string })?.access_token ?? null;
          const refresh_token = (json as { refresh_token?: string })?.refresh_token ?? null;
          const expires_in = Number((json as { expires_in?: number })?.expires_in ?? 3600);
          const expires_at = Number((json as { expires_at?: number })?.expires_at ?? (Math.floor(Date.now() / 1000) + expires_in));
          if (!access_token || !refresh_token) {
            throw new Error("Auth tokens missing from response");
          }
          const sessionPayload = {
            access_token,
            refresh_token,
            token_type: (json as { token_type?: string })?.token_type ?? "bearer",
            expires_in,
            expires_at,
            user: (json as { user?: unknown })?.user ?? null,
          };

          const setSessionWithTimeout = async () => {
            const timeoutMs = 2000;
            const timeoutPromise = new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("setSession timed out")), timeoutMs)
            );
            const setPromise = supabase.auth.setSession({ access_token, refresh_token });
            return await Promise.race([setPromise, timeoutPromise]);
          };

          try {
            const { error: setErr } = await setSessionWithTimeout();
            if (setErr) throw setErr;
          } catch (e) {
            // Fallback: write session directly to storage if setSession hangs.
            const projectRef = supabaseUrl.replace("https://", "").split(".")[0] ?? "supabase";
            const storageKey = `sb-${projectRef}-auth-token`;
            try {
              window.localStorage.setItem(storageKey, JSON.stringify(sessionPayload));
            } catch {
              // If storage fails, we still proceed; login flow will show error if session is missing.
            }
          }

          return { data: { session: { access_token }, user: sessionPayload.user }, error: null } as const;
        }
        : () => supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
          },
        });

      const timeoutMs = 12000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Auth request timed out")), timeoutMs);
      });

      const result = await Promise.race([action(), timeoutPromise]);
      if (attemptId !== submitAttemptRef.current) {
        console.info("[auth] log", { step: "login_result_ignored", attemptId });
        return;
      }
      console.info("[auth] log", { step: "login_signin_end" });
      if (result.error) throw result.error;
      const session = result.data?.session ?? null;
      const user = result.data?.user ?? null;
      const hasSession = Boolean(session);
      console.info("[auth] log", {
        step: "login_result",
        hasSession,
        userId: user?.id ?? null,
        error: null,
      });
      if (hasSession) {
        console.info("[auth] log", { step: "login_success_bootstrap" });
        console.info("[auth] log", { step: "login_navigate" });
        navigate("/dashboard");
        return;
      }
      if (result.data?.user) {
        const note = mode === "signup"
          ? "Account created. Check your email to confirm and then log in."
          : "Sign-in succeeded without a session. If email confirmation is required, confirm your email and try again.";
        setLastError(note);
        return;
      }
      throw new Error("No session returned from sign-in");
    } catch (error) {
      if (error instanceof TypeError) {
        const message = error.message || "Failed to fetch";
        const description = import.meta.env.DEV ? `Network/CORS failure — ${message}` : "Network error. Please try again.";
        setLastError(description);
        setAuthDebug({ message, status: null, code: null, name: "TypeError" });
        console.info("[auth] log", {
          step: "login_result",
          hasSession: false,
          userId: null,
          error: { message, status: null, name: "TypeError" },
        });
        return;
      }

      const message = formatError(error, "Failed to authenticate");
      setLastError(message);
      setAuthDebug({
        message,
        status: (error as { status?: number })?.status ?? null,
        code: (error as { code?: string })?.code ?? null,
        name: (error as { name?: string })?.name ?? null,
      });
      console.info("[auth] log", {
        step: "login_result",
        hasSession: false,
        userId: null,
        error: {
          message,
          status: (error as { status?: number })?.status ?? null,
          name: (error as { name?: string })?.name ?? null,
        },
      });
    } finally {
      if (attemptId === submitAttemptRef.current) {
        setIsSubmitting(false);
        submitLockRef.current = false;
        setPendingSince(null);
        (globalThis as { __authSubmitInProgress?: boolean }).__authSubmitInProgress = false;
        console.info("[auth] log", { step: "login_submit_unlock" });
      }
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
        {isSubmitting && pendingSince ? (
          <div className="flex items-center justify-between rounded-lg border border-border bg-background/30 p-3 text-xs text-muted-foreground">
            <div>Auth request pending for {Math.max(1, Math.floor((Date.now() - pendingSince) / 1000))}s</div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                submitAttemptRef.current += 1;
                setIsSubmitting(false);
                submitLockRef.current = false;
                setPendingSince(null);
              }}
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
                    // Clipboard permission denied; no-op.
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
                  const timeout = (ms: number) =>
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms));
                  const headers = supabaseAnonKey ? { apikey: supabaseAnonKey } : undefined;
                  const authReq = fetch(`${supabaseUrl}/auth/v1/health`, { method: "GET", headers });
                  const restReq = fetch(`${supabaseUrl}/rest/v1/`, { method: "GET", headers });
                  const [authRes, restRes] = await Promise.all([
                    Promise.race([authReq, timeout(6000)]),
                    Promise.race([restReq, timeout(6000)]),
                  ]);
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
                  const timeout = (ms: number) =>
                    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timed out")), ms));
                  const res = await Promise.race([
                    fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
                      method: "POST",
                      headers: {
                        apikey: supabaseAnonKey,
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({ email, password }),
                    }),
                    timeout(8000),
                  ]);
                  const text = await res.text();
                  const snippet = text.length > 200 ? `${text.slice(0, 200)}...` : text;
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
