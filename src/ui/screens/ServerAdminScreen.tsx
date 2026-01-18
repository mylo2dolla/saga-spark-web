import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { callEdgeFunctionRaw } from "@/lib/edge";
import { useAuth } from "@/hooks/useAuth";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";
import { useNetworkHealth } from "@/ui/data/networkHealth";

interface ServerNodeRow {
  id: string;
  node_name: string;
  status: "online" | "offline" | "degraded";
  last_heartbeat: string;
  active_players: number;
  active_campaigns: number;
  realtime_connections: number;
  database_latency_ms: number;
}

export default function ServerAdminScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const { setLastError, engineSnapshot, lastError, lastErrorAt } = useDiagnostics();
  const networkHealth = useNetworkHealth(1000);
  const [nodes, setNodes] = useState<ServerNodeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbTest, setDbTest] = useState<{ ok: boolean; status?: number; message?: string } | null>(null);
  const [edgeTest, setEdgeTest] = useState<{ ok: boolean; status?: number; body?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const DEV_DEBUG = import.meta.env.DEV;
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
  const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

  const fetchNodes = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    setLastError(null);

    try {
      const response = await supabase
        .from("server_nodes")
        .select("*")
        .eq("user_id", user.id)
        .order("last_heartbeat", { ascending: false });

      if (response.error) {
        console.error("[server_nodes] supabase error", {
          message: response.error.message,
          code: response.error.code,
          details: response.error.details,
          hint: response.error.hint,
          status: response.error.status,
        });
        throw response.error;
      }

      setNodes(response.data ?? []);
    } catch (err) {
      const message = formatError(err, "Failed to load server nodes");
      setError(message);
      setLastError(message);
    } finally {
      setIsLoading(false);
    }
  }, [setLastError, user]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const handleDbTest = useCallback(async () => {
    setIsTesting(true);
    setDbTest(null);
    try {
      const response = await supabase.from("campaigns").select("id").limit(1);
      if (response.error) {
        setDbTest({ ok: false, status: response.error.status, message: response.error.message });
        return;
      }
      setDbTest({ ok: true, status: 200, message: "ok" });
    } catch (err) {
      setDbTest({ ok: false, message: formatError(err, "DB test failed") });
    } finally {
      setIsTesting(false);
    }
  }, []);

  const handleEdgeTest = useCallback(async () => {
    if (!DEV_DEBUG) return;
    setIsTesting(true);
    setEdgeTest(null);
    try {
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setEdgeTest({ ok: false, body: "Missing Supabase env" });
        return;
      }
      const response = await callEdgeFunctionRaw("generate-class", {
        requireAuth: false,
        body: { classDescription: "Quick test class" },
      });
      const body = await response.text();
      setEdgeTest({ ok: response.ok, status: response.status, body });
    } catch (err) {
      setEdgeTest({ ok: false, body: formatError(err, "Edge test failed") });
    } finally {
      setIsTesting(false);
    }
  }, [DEV_DEBUG, SUPABASE_ANON_KEY, SUPABASE_URL]);

  const handleReconnectSession = useCallback(async () => {
    setIsTesting(true);
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        setLastError(error.message);
      } else {
        setLastError(null);
      }
      await fetchNodes();
    } catch (err) {
      setLastError(formatError(err, "Failed to refresh session"));
    } finally {
      setIsTesting(false);
    }
  }, [fetchNodes, setLastError]);

  const handleReconnectAll = useCallback(async () => {
    setIsTesting(true);
    try {
      const { error } = await supabase.auth.refreshSession();
      if (error) {
        setLastError(error.message);
      } else {
        setLastError(null);
      }
      await fetchNodes();
      await handleDbTest();
    } catch (err) {
      setLastError(formatError(err, "Reconnect failed"));
    } finally {
      setIsTesting(false);
    }
  }, [fetchNodes, handleDbTest, setLastError]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("ui-server-nodes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server_nodes" },
        payload => {
          const row = payload.new as ServerNodeRow | undefined;
          if (row && row.node_name) {
            setNodes(prev => {
              const idx = prev.findIndex(item => item.id === row.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = row;
                return next;
              }
              return [row, ...prev];
            });
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (authLoading) {
    console.info("[auth] log", {
      step: "auth_guard",
      path: "/servers",
      hasSession: Boolean(user),
      userId: user?.id ?? null,
      isLoading: authLoading,
      reason: "auth_loading",
    });
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) {
    console.info("[auth] log", {
      step: "auth_guard",
      path: "/servers",
      hasSession: false,
      userId: null,
      isLoading: authLoading,
      reason: "no_user",
    });
    return <div className="text-sm text-muted-foreground">Login required.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Servers/Admin</h1>
          <div className="text-xs text-muted-foreground">Live server nodes</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchNodes}>Reconnect</Button>
          <Button variant="outline" onClick={handleReconnectAll} disabled={isTesting}>
            Reconnect + Refresh
          </Button>
          <Button variant="outline" onClick={handleReconnectSession} disabled={isTesting}>
            Reconnect Session
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Nodes</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : error ? (
            <div className="space-y-2 text-sm">
              <div className="text-destructive">{error}</div>
              <Button variant="outline" onClick={fetchNodes}>Retry</Button>
            </div>
          ) : nodes.length === 0 ? (
            <div className="text-sm text-muted-foreground">No nodes reported.</div>
          ) : (
            <div className="space-y-3">
              {nodes.map(node => {
                const lastHeartbeat = new Date(node.last_heartbeat);
                const stale = Date.now() - lastHeartbeat.getTime() > 30000;
                const status = stale ? "offline" : node.status;
                return (
                  <div key={node.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-xs">
                    <div>
                      <div className="font-semibold">{node.node_name}</div>
                      <div className="text-muted-foreground">Last: {lastHeartbeat.toLocaleTimeString()}</div>
                    </div>
                    <div className="text-right">
                      <div>Status: {status}</div>
                      <div>Latency: {node.database_latency_ms}ms</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Diagnostics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-muted-foreground">
          <div>Auth: {user?.email ?? "guest"}</div>
          <div>DB: {dbTest?.ok ? "ok" : "unknown"}</div>
          <div>Requests/min: {networkHealth.requestsPerMinute}</div>
          <div>Last DB read: {networkHealth.lastDbReadAt ? new Date(networkHealth.lastDbReadAt).toLocaleTimeString() : "-"}</div>
          <div>Last DB write: {networkHealth.lastDbWriteAt ? new Date(networkHealth.lastDbWriteAt).toLocaleTimeString() : "-"}</div>
          <div>Last DB load: {networkHealth.lastDbLoadAt ? new Date(networkHealth.lastDbLoadAt).toLocaleTimeString() : "-"}</div>
          <div>Last Edge call: {networkHealth.lastEdgeCallAt ? new Date(networkHealth.lastEdgeCallAt).toLocaleTimeString() : "-"}</div>
          {lastError ? <div className="text-destructive">Last error: {lastError}</div> : null}
          {lastErrorAt ? <div>Last error at: {new Date(lastErrorAt).toLocaleTimeString()}</div> : null}
          {engineSnapshot ? (
            <div className="space-y-1">
              <div>
                Engine: {engineSnapshot.state ?? "unknown"} | Location: {engineSnapshot.locationName ?? "-"} ({engineSnapshot.locationId ?? "-"})
              </div>
              <div>Campaign: {engineSnapshot.campaignSeedTitle ?? "-"} ({engineSnapshot.campaignSeedId ?? "-"})</div>
              <div>
                Travel: {engineSnapshot.travel?.currentLocationId ?? "-"} | In transit: {engineSnapshot.travel?.isInTransit ? "yes" : "no"} | {Math.round(engineSnapshot.travel?.transitProgress ?? 0)}%
              </div>
              <div>Combat: {engineSnapshot.combatState ?? "-"}</div>
            </div>
          ) : (
            <div>Engine: no snapshot</div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={handleDbTest} disabled={isTesting}>
              Test DB
            </Button>
            {DEV_DEBUG ? (
              <Button variant="outline" onClick={handleEdgeTest} disabled={isTesting || !SUPABASE_URL}>
                Test generate-class
              </Button>
            ) : null}
          </div>
          {dbTest ? (
            <div>DB test: {dbTest.ok ? "ok" : "error"} {dbTest.status ? `(${dbTest.status})` : ""} {dbTest.message ?? ""}</div>
          ) : null}
          {edgeTest ? (
            <div>Edge test: {edgeTest.ok ? "ok" : "error"} {edgeTest.status ? `(${edgeTest.status})` : ""}</div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
