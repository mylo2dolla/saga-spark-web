-- ================================================
-- Server Nodes table for /servers dashboard heartbeats
-- ================================================
CREATE TABLE public.server_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  node_name TEXT NOT NULL,
  user_id UUID NOT NULL,
  campaign_id UUID REFERENCES public.campaigns(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'offline', 'degraded')),
  last_heartbeat TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  active_players INTEGER NOT NULL DEFAULT 1,
  active_campaigns INTEGER NOT NULL DEFAULT 0,
  realtime_connections INTEGER NOT NULL DEFAULT 0,
  database_latency_ms INTEGER NOT NULL DEFAULT 0,
  memory_usage NUMERIC(5,2) NOT NULL DEFAULT 0,
  cpu_usage NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.server_nodes ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can view server nodes
CREATE POLICY "Authenticated users can view server nodes"
  ON public.server_nodes FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Users can insert their own heartbeat
CREATE POLICY "Users can create own node heartbeat"
  ON public.server_nodes FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own heartbeat
DROP POLICY IF EXISTS "Users can update own node heartbeat" ON public.server_nodes;
CREATE POLICY "Users can update own node heartbeat"
  ON public.server_nodes FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own heartbeat
CREATE POLICY "Users can delete own node heartbeat"
  ON public.server_nodes FOR DELETE
  USING (auth.uid() = user_id);

-- Trigger to update updated_at
CREATE TRIGGER update_server_nodes_updated_at
  BEFORE UPDATE ON public.server_nodes
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Enable realtime for server_nodes
ALTER PUBLICATION supabase_realtime ADD TABLE public.server_nodes;
