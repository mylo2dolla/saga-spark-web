/**
 * Hook to manage server node heartbeats for the server dashboard.
 * Creates/updates a node entry using UPSERT by (user_id, node_name).
 * Status is computed from last_heartbeat staleness, not stored manually.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface ServerNodeData {
  id: string;
  node_name: string;
  user_id: string;
  campaign_id: string | null;
  status: "online" | "offline" | "degraded";
  last_heartbeat: string;
  active_players: number;
  active_campaigns: number;
  realtime_connections: number;
  database_latency_ms: number;
  memory_usage: number;
  cpu_usage: number;
  created_at: string;
  updated_at: string;
}

interface UseServerHeartbeatOptions {
  campaignId?: string;
  nodeName?: string;
  heartbeatInterval?: number;
}

// Generate a stable client node name based on session
function generateNodeName(): string {
  const storage = typeof window !== "undefined" ? window.sessionStorage : null;
  const stored = storage?.getItem("server_node_name");
  if (stored) return stored;

  const name = `Client-${Math.random().toString(36).slice(2, 8)}`;
  storage?.setItem("server_node_name", name);
  return name;
}

export function useServerHeartbeat(options: UseServerHeartbeatOptions = {}) {
  const { user } = useAuth();
  const {
    campaignId,
    nodeName = generateNodeName(),
    heartbeatInterval = 10000,
  } = options;

  const [nodeId, setNodeId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);
  const nodeNameRef = useRef(nodeName);
  const isMountedRef = useRef(true);

  // Send heartbeat using UPSERT with unique constraint (user_id, node_name)
  const sendHeartbeat = useCallback(async () => {
    if (!user) return;

    try {
      const t0 = performance.now();
      await supabase
        .from("server_nodes")
        .select("id")
        .eq("user_id", user.id)
        .eq("node_name", nodeNameRef.current)
        .limit(1);
      const currentLatency = Math.round(performance.now() - t0);

      const { data, error } = await supabase
        .from("server_nodes")
        .upsert({
          node_name: nodeNameRef.current,
          user_id: user.id,
          campaign_id: campaignId ?? null,
          status: "online",
          last_heartbeat: new Date().toISOString(),
          active_players: campaignId ? 1 : 0,
          active_campaigns: campaignId ? 1 : 0,
          realtime_connections: 0,
          database_latency_ms: currentLatency,
          memory_usage: 0,
          cpu_usage: 0,
        }, {
          onConflict: "user_id,node_name",
        })
        .select("id")
        .maybeSingle();

      if (error) {
        console.error("Heartbeat insert failed:", error);
        if (isMountedRef.current) {
          setIsConnected(false);
        }
      } else if (data) {
        if (isMountedRef.current) {
          setNodeId(data.id);
          setLatency(currentLatency);
          setIsConnected(true);
        }
      } else if (isMountedRef.current) {
        setIsConnected(false);
      }
    } catch (err) {
      console.error("Heartbeat failed:", err);
      if (isMountedRef.current) {
        setIsConnected(false);
      }
    }
  }, [user, campaignId]);

  // Register/update node on mount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!user) return;

    // Initial heartbeat
    sendHeartbeat();
  }, [user, sendHeartbeat]);

  // Start heartbeat interval
  useEffect(() => {
    if (!user) return;

    heartbeatRef.current = setInterval(sendHeartbeat, heartbeatInterval);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [user, heartbeatInterval, sendHeartbeat]);

  // Cleanup on unmount - mark offline
  useEffect(() => {
    return () => {
      if (nodeId && user) {
        // Mark node as offline when leaving (fire and forget)
        supabase
          .from("server_nodes")
          .update({ status: "offline" })
          .eq("id", nodeId)
          .then(() => {
            // Node will be cleaned up by staleness check in dashboard
          });
      }
    };
  }, [nodeId, user]);

  // Force reconnect
  const reconnect = useCallback(async () => {
    await sendHeartbeat();
  }, [sendHeartbeat]);

  return {
    nodeId,
    isConnected,
    latency,
    reconnect,
  };
}
