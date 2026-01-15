/**
 * Hook to manage server node heartbeats for the server dashboard.
 * Creates a node entry on mount and keeps it alive with periodic heartbeats.
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

export function useServerHeartbeat(options: UseServerHeartbeatOptions = {}) {
  const { user } = useAuth();
  const {
    campaignId,
    nodeName = `Client-${Math.random().toString(36).slice(2, 8)}`,
    heartbeatInterval = 30000,
  } = options;

  const [nodeId, setNodeId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [latency, setLatency] = useState(0);
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null);

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    if (!user || !nodeId) return;

    const startTime = Date.now();

    try {
      const { error } = await supabase
        .from("server_nodes")
        .update({
          status: "online",
          last_heartbeat: new Date().toISOString(),
          database_latency_ms: latency,
          memory_usage: Math.random() * 50 + 30,
          cpu_usage: Math.random() * 30 + 10,
        })
        .eq("id", nodeId);

      if (error) {
        console.error("Heartbeat error:", error);
        setIsConnected(false);
      } else {
        setLatency(Date.now() - startTime);
        setIsConnected(true);
      }
    } catch (err) {
      console.error("Heartbeat failed:", err);
      setIsConnected(false);
    }
  }, [user, nodeId, latency]);

  // Register node on mount
  useEffect(() => {
    if (!user) return;

    const registerNode = async () => {
      const startTime = Date.now();

      try {
        const { data, error } = await supabase
          .from("server_nodes")
          .insert({
            node_name: nodeName,
            user_id: user.id,
            campaign_id: campaignId ?? null,
            status: "online",
            active_players: 1,
            active_campaigns: campaignId ? 1 : 0,
            realtime_connections: 1,
            database_latency_ms: 0,
          })
          .select()
          .single();

        if (error) {
          console.error("Failed to register node:", error);
          return;
        }

        setNodeId(data.id);
        setLatency(Date.now() - startTime);
        setIsConnected(true);
      } catch (err) {
        console.error("Node registration failed:", err);
      }
    };

    registerNode();
  }, [user, campaignId, nodeName]);

  // Start heartbeat interval
  useEffect(() => {
    if (!nodeId) return;

    heartbeatRef.current = setInterval(sendHeartbeat, heartbeatInterval);

    return () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
    };
  }, [nodeId, heartbeatInterval, sendHeartbeat]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (nodeId && user) {
        // Mark node as offline when leaving
        supabase
          .from("server_nodes")
          .update({ status: "offline" })
          .eq("id", nodeId)
          .then(() => {
            // Optionally delete the node
            supabase.from("server_nodes").delete().eq("id", nodeId);
          });
      }
    };
  }, [nodeId, user]);

  // Force reconnect
  const reconnect = useCallback(async () => {
    if (nodeId) {
      await sendHeartbeat();
    }
  }, [nodeId, sendHeartbeat]);

  return {
    nodeId,
    isConnected,
    latency,
    reconnect,
  };
}
