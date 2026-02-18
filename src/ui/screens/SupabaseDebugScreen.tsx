import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseConfigInfo } from "@/ui/data/supabaseConfig";

const DEV_DEBUG = import.meta.env.DEV;

interface TestResult {
  status?: number;
  ok?: boolean;
  text?: string;
  error?: { name?: string; message?: string; cause?: unknown };
  headers?: Record<string, string>;
}

const formatError = (error: unknown) => ({
  name: (error as { name?: string })?.name,
  message: (error as { message?: string })?.message,
  cause: (error as { cause?: unknown })?.cause,
});

export default function SupabaseDebugScreen() {
  const config = getSupabaseConfigInfo();
  const [authHealth, setAuthHealth] = useState<TestResult>({});
  const [restHealth, setRestHealth] = useState<TestResult>({});
  const [dbProbe, setDbProbe] = useState<TestResult>({});
  const [sessionResult, setSessionResult] = useState<TestResult>({});
  const [signInResult, setSignInResult] = useState<TestResult>({});
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const headersPreview = useMemo(() => {
    if (!config.anonKey) return {};
    return {
      apikey: `(${config.anonKey.length} chars)`,
    };
  }, [config.anonKey]);

  const runAuthHealth = useCallback(async () => {
    if (!config.url || !config.anonKey) return;
    try {
      const response = await fetch(`${config.url}/auth/v1/health`, {
        headers: { apikey: config.anonKey },
      });
      const text = await response.text();
      setAuthHealth({
        ok: response.ok,
        status: response.status,
        text,
        headers: {
          "access-control-allow-origin": response.headers.get("access-control-allow-origin") ?? "",
        },
      });
    } catch (error) {
      setAuthHealth({ error: formatError(error) });
    }
  }, [config.anonKey, config.url]);

  const runRestHealth = useCallback(async () => {
    if (!config.url || !config.anonKey) return;
    try {
      const response = await fetch(`${config.url}/rest/v1/`, {
        method: "HEAD",
        headers: { apikey: config.anonKey },
      });
      setRestHealth({
        ok: response.ok,
        status: response.status,
        headers: {
          "access-control-allow-origin": response.headers.get("access-control-allow-origin") ?? "",
          "access-control-allow-headers": response.headers.get("access-control-allow-headers") ?? "",
        },
      });
    } catch (error) {
      setRestHealth({ error: formatError(error) });
    }
  }, [config.anonKey, config.url]);

  const runDbProbe = useCallback(async () => {
    try {
      const { error, count } = await supabase
        .from("campaigns")
        .select("id", { head: true, count: "exact" })
        .limit(1);
      if (error) {
        setDbProbe({ ok: false, error: formatError(error) });
        return;
      }
      setDbProbe({ ok: true, text: `count=${count ?? "unknown"}` });
    } catch (error) {
      setDbProbe({ error: formatError(error) });
    }
  }, []);

  const runGetSession = useCallback(async () => {
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        setSessionResult({ error: formatError(error) });
        return;
      }
      setSessionResult({
        ok: Boolean(data.session),
        text: data.session ? `session user ${data.session.user?.id}` : "no session",
      });
    } catch (error) {
      setSessionResult({ error: formatError(error) });
    }
  }, []);

  const runSignIn = useCallback(async () => {
    if (!email || !password) {
      setSignInResult({ error: { name: "InputError", message: "Email and password required" } });
      return;
    }
    try {
      const result = await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        const authError = result.error;
        setSignInResult({
          error: {
            name: authError.name,
            message: authError.message,
            cause: {
              status: (authError as { status?: number })?.status,
              code: (authError as { code?: string })?.code,
            },
          },
        });
        return;
      }
      const nextSession = result.data.session;
      setSignInResult({
        ok: Boolean(nextSession),
        text: nextSession ? `user ${result.data.user?.id ?? nextSession.user?.id}` : "no session",
      });
    } catch (error) {
      setSignInResult({ error: formatError(error) });
    }
  }, [email, password]);

  const runAll = useCallback(async () => {
    setIsRunning(true);
    await runAuthHealth();
    await runRestHealth();
    await runDbProbe();
    await runGetSession();
    setIsRunning(false);
  }, [runAuthHealth, runDbProbe, runGetSession, runRestHealth]);

  if (!DEV_DEBUG) {
    return (
      <div className="text-sm text-muted-foreground">
        Supabase debug tools are available in development builds only.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Supabase Config</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <div>URL: {config.url ?? "-"}</div>
          <div>Host: {config.host ?? "-"}</div>
          <div>Anon key length: {config.keyLength}</div>
          <div>Anon key: {config.maskedKey ?? "-"}</div>
          <div>Errors: {config.errors.length ? config.errors.join(", ") : "none"}</div>
          <div>Headers preview: {JSON.stringify(headersPreview)}</div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={runAll} disabled={isRunning}>
          {isRunning ? "Running..." : "Run health checks"}
        </Button>
        <Button variant="outline" onClick={runAuthHealth} disabled={isRunning}>
          Auth health
        </Button>
        <Button variant="outline" onClick={runRestHealth} disabled={isRunning}>
          REST HEAD
        </Button>
        <Button variant="outline" onClick={runDbProbe} disabled={isRunning}>
          DB probe
        </Button>
        <Button variant="outline" onClick={runGetSession} disabled={isRunning}>
          getSession
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <div>
            <div className="font-semibold text-foreground">Auth health</div>
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(authHealth, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold text-foreground">REST HEAD</div>
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(restHealth, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold text-foreground">DB probe</div>
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(dbProbe, null, 2)}</pre>
          </div>
          <div>
            <div className="font-semibold text-foreground">getSession</div>
            <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(sessionResult, null, 2)}</pre>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sign in test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="email"
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
          />
          <Input
            placeholder="password"
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
          />
          <Button variant="outline" onClick={runSignIn} disabled={isRunning}>
            Test sign-in
          </Button>
          <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
            {JSON.stringify(signInResult, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
