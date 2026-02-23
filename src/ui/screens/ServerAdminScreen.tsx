import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/useDiagnostics";
import { useNetworkHealth } from "@/ui/data/networkHealth";
import { createLogger } from "@/lib/observability/logger";

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

interface WorldEventRow {
  id: string;
  campaign_id: string;
  user_id: string;
  action_text: string;
  created_at: string;
}

const normalizeNodeStatus = (value: string | null | undefined): ServerNodeRow["status"] => {
  if (value === "online" || value === "offline" || value === "degraded") {
    return value;
  }
  return "degraded";
};

const formatBundleTimestamp = (date: Date) => date.toISOString().replace(/[:.]/g, "-");

export default function ServerAdminScreen() {
  const { user, isLoading: authLoading } = useAuth();
  const { setLastError, engineSnapshot, lastError, lastErrorAt, healthChecks } = useDiagnostics();
  const networkHealth = useNetworkHealth(1000);
  const logger = useMemo(() => createLogger("server-admin-screen"), []);
  const [nodes, setNodes] = useState<ServerNodeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dbTest, setDbTest] = useState<{ ok: boolean; status?: number; message?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [worldEvents, setWorldEvents] = useState<WorldEventRow[]>([]);
  const [worldEventsStatus, setWorldEventsStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [worldEventsError, setWorldEventsError] = useState<string | null>(null);

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
        logger.error("server_nodes.fetch.failed", response.error);
        throw response.error;
      }

      const nextNodes = (response.data ?? []).map((row) => ({
        ...row,
        status: normalizeNodeStatus((row as { status?: string }).status),
      }));
      setNodes(nextNodes);
    } catch (err) {
      const message = formatError(err, "Failed to load server nodes");
      setError(message);
      setLastError(message);
    } finally {
      setIsLoading(false);
    }
  }, [logger, setLastError, user]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  const fetchWorldEvents = useCallback(async () => {
    if (!user) return;
    setWorldEventsStatus("loading");
    setWorldEventsError(null);
    const { data, error } = await supabase
      .from("world_events")
      .select("id, campaign_id, user_id, action_text, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      setWorldEventsStatus("error");
      setWorldEventsError(error.message);
      return;
    }
    setWorldEvents(data ?? []);
    setWorldEventsStatus("ok");
  }, [user]);

  useEffect(() => {
    fetchWorldEvents();
  }, [fetchWorldEvents]);

  const handleDbTest = useCallback(async () => {
    setIsTesting(true);
    setDbTest(null);
    try {
      const response = await supabase.from("campaigns").select("id").limit(1);
      if (response.error) {
        setDbTest({ ok: false, message: response.error.message });
        return;
      }
      setDbTest({ ok: true, status: 200, message: "ok" });
    } catch (err) {
      setDbTest({ ok: false, message: formatError(err, "DB test failed") });
    } finally {
      setIsTesting(false);
    }
  }, []);

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

  const handleExportDebugBundle = useCallback(() => {
    if (typeof document === "undefined" || typeof URL === "undefined") {
      setLastError("Debug bundle export is only available in the browser.");
      return;
    }

    try {
      const now = new Date();
      const payload = {
        generated_at: now.toISOString(),
        route: "/servers",
        user: {
          id: user.id,
          email: user.email ?? null,
        },
        diagnostics: {
          last_error: lastError ?? null,
          last_error_at: lastErrorAt ? new Date(lastErrorAt).toISOString() : null,
          health_checks: healthChecks,
          engine_snapshot: engineSnapshot ?? null,
          db_test: dbTest,
        },
        network_health: networkHealth,
        nodes,
        world_events: worldEvents,
        runtime: {
          functions_base_url:
            import.meta.env.VITE_MYTHIC_FUNCTIONS_BASE_URL
            ?? import.meta.env.VITE_TAILSCALE_FUNCTIONS_BASE_URL
            ?? import.meta.env.NEXT_PUBLIC_MYTHIC_FUNCTIONS_BASE_URL
            ?? import.meta.env.NEXT_PUBLIC_TAILSCALE_FUNCTIONS_BASE_URL
            ?? null,
          supabase_url:
            import.meta.env.VITE_SUPABASE_URL
            ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL
            ?? null,
          user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
          page_url: typeof window !== "undefined" ? window.location.href : null,
        },
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const filename = `mythic-debug-bundle-${formatBundleTimestamp(now)}.json`;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);

      logger.info("debug_bundle.exported", {
        filename,
        node_count: nodes.length,
        world_event_count: worldEvents.length,
      });
    } catch (err) {
      const message = formatError(err, "Failed to export debug bundle");
      setLastError(message);
      logger.error("debug_bundle.export.failed", err);
    }
  }, [dbTest, engineSnapshot, healthChecks, lastError, lastErrorAt, logger, networkHealth, nodes, setLastError, user, worldEvents]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("ui-server-nodes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "server_nodes" },
        payload => {
          const row = payload.new as (ServerNodeRow & { status?: string }) | undefined;
          if (row && row.node_name) {
            const normalizedRow: ServerNodeRow = {
              ...row,
              status: normalizeNodeStatus(row.status),
            };
            setNodes(prev => {
              const idx = prev.findIndex(item => item.id === normalizedRow.id);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = normalizedRow;
                return next;
              }
              return [normalizedRow, ...prev];
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
    logger.debug("auth.guard.loading", { path: "/servers", has_session: Boolean(user) });
    return <div className="text-sm text-muted-foreground">Loading session...</div>;
  }

  if (!user) {
    logger.debug("auth.guard.no_user", { path: "/servers" });
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
          <Button variant="outline" onClick={handleExportDebugBundle}>Export Debug Bundle</Button>
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
          </div>
          {dbTest ? (
            <div>DB test: {dbTest.ok ? "ok" : "error"} {dbTest.status ? `(${dbTest.status})` : ""} {dbTest.message ?? ""}</div>
          ) : null}
          <div className="space-y-1 rounded-md border border-border p-2">
            <div className="font-semibold text-foreground">Subsystem health</div>
            {Object.keys(healthChecks).length === 0 ? (
              <div>No subsystem probes yet.</div>
            ) : (
              Object.values(healthChecks).map((snapshot) => (
                <div key={snapshot.subsystem}>
                  {snapshot.subsystem}: {snapshot.status}
                  {snapshot.last_latency_ms !== null ? ` · ${snapshot.last_latency_ms}ms` : ""}
                  {snapshot.last_success_at ? ` · last ok ${new Date(snapshot.last_success_at).toLocaleTimeString()}` : ""}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent World Events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          {worldEventsStatus === "loading" ? (
            <div>Loading events...</div>
          ) : null}
          {worldEventsError ? (
            <div className="text-destructive">{worldEventsError}</div>
          ) : null}
          {worldEventsStatus === "ok" && worldEvents.length === 0 ? (
            <div>No events available.</div>
          ) : null}
          {worldEvents.length > 0 ? (
            <div className="space-y-2">
              {worldEvents.map((event) => (
                <div key={event.id} className="rounded-md border border-border p-2">
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(event.created_at).toLocaleString()}
                  </div>
                  <div className="text-xs text-foreground">{event.action_text}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Campaign: {event.campaign_id} | User: {event.user_id}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

    </div>
  );
}
