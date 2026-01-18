import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { withTimeout, isAbortError, formatError } from "@/ui/data/async";
import { useDiagnostics } from "@/ui/data/diagnostics";

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
  const { setLastError } = useDiagnostics();
  const [nodes, setNodes] = useState<ServerNodeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNodes = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    setLastError(null);

    try {
      const response = await withTimeout(
        supabase.from("server_nodes").select("*").eq("user_id", user.id).order("last_heartbeat", { ascending: false }),
        20000,
      );

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
      if (isAbortError(err)) {
        setError("Request canceled/timeout");
        setLastError("Request canceled/timeout");
        return;
      }
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
        <Button variant="outline" onClick={fetchNodes}>Reconnect</Button>
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
    </div>
  );
}
