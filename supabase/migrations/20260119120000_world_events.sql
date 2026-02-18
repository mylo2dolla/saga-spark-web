CREATE TABLE IF NOT EXISTS public.world_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  action_text TEXT NOT NULL,
  response_text TEXT,
  delta JSONB,
  location_id TEXT,
  location_name TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_world_events_campaign ON public.world_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_world_events_created ON public.world_events(created_at DESC);

ALTER TABLE public.world_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Campaign members can view world events" ON public.world_events;
CREATE POLICY "Campaign members can view world events"
ON public.world_events FOR SELECT
USING (is_campaign_member(campaign_id, (select auth.uid())));

DROP POLICY IF EXISTS "Campaign members can create world events" ON public.world_events;
CREATE POLICY "Campaign members can create world events"
ON public.world_events FOR INSERT
WITH CHECK (is_campaign_member(campaign_id, (select auth.uid())));
