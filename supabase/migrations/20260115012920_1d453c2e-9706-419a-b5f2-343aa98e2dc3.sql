-- Add unique constraint for UPSERT on server_nodes (if not exists)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'server_nodes_user_id_node_name_key'
  ) THEN
    ALTER TABLE public.server_nodes 
    ADD CONSTRAINT server_nodes_user_id_node_name_key UNIQUE (user_id, node_name);
  END IF;
END $$;

-- Create updated_at trigger for server_nodes (drop if exists first, then recreate)
DROP TRIGGER IF EXISTS update_server_nodes_updated_at ON public.server_nodes;
CREATE TRIGGER update_server_nodes_updated_at
BEFORE UPDATE ON public.server_nodes
FOR EACH ROW
EXECUTE FUNCTION public.handle_updated_at();