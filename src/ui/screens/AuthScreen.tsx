import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";

interface AuthScreenProps {
  mode: "login" | "signup";
}

export default function AuthScreen({ mode }: AuthScreenProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { setLastError } = useDiagnostics();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitLockRef = useRef(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password.trim()) {
      toast({ title: "Missing info", description: "Email and password are required", variant: "destructive" });
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
      const action = mode === "login"
        ? () => supabase.auth.signInWithPassword({ email, password })
        : () => supabase.auth.signUp({
          email,
          password,
          options: {
            data: { display_name: displayName || email.split("@")[0] },
          },
        });

      const result = await withTimeout(action(), 25000);
      if (result.error) throw result.error;
      const hasSession = Boolean(result.session);
      console.info("[auth] log", {
        step: "login_result",
        hasSession,
        userId: result.user?.id ?? null,
        error: null,
      });
      console.info("[auth] log", { step: "login_success_bootstrap" });
      navigate("/dashboard");
    } catch (error) {
      if (isAbortError(error)) {
        toast({
          title: "Request canceled/timeout",
          description: "Please try again.",
          variant: "destructive",
        });
        setLastError("Request canceled/timeout");
        console.info("[auth] log", {
          step: "login_result",
          hasSession: false,
          userId: null,
          error: { message: "AbortError", status: null, name: "AbortError" },
        });
        return;
      }

      const message = formatError(error, "Failed to authenticate");
      setLastError(message);
      toast({ title: "Authentication failed", description: message, variant: "destructive" });
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
