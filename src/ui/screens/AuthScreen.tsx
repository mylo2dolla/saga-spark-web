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
  const submitLockRef = useRef(false);
  const [didCopyError, setDidCopyError] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<{
    authStatus?: string;
    restStatus?: string;
    error?: string;
  } | null>(null);
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

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
    setLastError(null);
    console.info("[auth] log", { step: "login_submit" });

    try {
      (globalThis as { __authSubmitInProgress?: boolean }).__authSubmitInProgress = true;
      console.info("[auth] log", { step: "login_signin_call" });
      const action = mode === "login"
        ? () => supabase.auth.signInWithPassword({ email, password })
        : () => supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
          },
        });

      const result = await action();
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
      throw new Error("No session returned from sign-in");
    } catch (error) {
      if (error instanceof TypeError) {
        const message = error.message || "Failed to fetch";
        const description = import.meta.env.DEV ? `Network/CORS failure — ${message}` : "Network error. Please try again.";
        setLastError(description);
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
      setIsSubmitting(false);
      submitLockRef.current = false;
      (globalThis as { __authSubmitInProgress?: boolean }).__authSubmitInProgress = false;
      console.info("[auth] log", { step: "login_submit_unlock" });
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
        {lastError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold">Auth error</div>
                <div className="break-words">{lastError}</div>
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
            {checkResult?.error ? (
              <span className="text-destructive">{checkResult.error}</span>
            ) : checkResult ? (
              <span className="text-muted-foreground">
                {checkResult.authStatus ?? "auth ?"} · {checkResult.restStatus ?? "rest ?"}
              </span>
            ) : null}
          </div>
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
