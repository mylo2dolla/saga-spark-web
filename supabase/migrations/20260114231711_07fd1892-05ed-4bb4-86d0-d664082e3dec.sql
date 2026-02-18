-- First create the function for updating timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create table for persisting full game state
CREATE TABLE public.game_saves (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  save_name TEXT NOT NULL DEFAULT 'Autosave',
  
  -- Campaign seed data
  campaign_seed JSONB NOT NULL,
  
  -- Full world state
  world_state JSONB NOT NULL,
  
  -- Full game state (combat/physics)
  game_state JSONB NOT NULL,
  
  -- Quick access fields
  player_level INT NOT NULL DEFAULT 1,
  total_xp INT NOT NULL DEFAULT 0,
  playtime_seconds INT NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT valid_campaign_seed CHECK (jsonb_typeof(campaign_seed) = 'object'),
  CONSTRAINT valid_world_state CHECK (jsonb_typeof(world_state) = 'object'),
  CONSTRAINT valid_game_state CHECK (jsonb_typeof(game_state) = 'object')
);

-- Create indexes
CREATE INDEX idx_game_saves_campaign ON public.game_saves(campaign_id);
CREATE INDEX idx_game_saves_user ON public.game_saves(user_id);
CREATE INDEX idx_game_saves_updated ON public.game_saves(updated_at DESC);

-- Enable RLS
ALTER TABLE public.game_saves ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their own saves"
ON public.game_saves FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own saves"
ON public.game_saves FOR INSERT
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own saves" ON public.game_saves;
CREATE POLICY "Users can update their own saves"
ON public.game_saves FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own saves"
ON public.game_saves FOR DELETE
USING (auth.uid() = user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'game_saves_campaign_user_save_name_key'
  ) THEN
    ALTER TABLE public.game_saves
    ADD CONSTRAINT game_saves_campaign_user_save_name_key UNIQUE (campaign_id, user_id, save_name);
  END IF;
END $$;

-- Create table for generated AI content
CREATE TABLE public.ai_generated_content (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  content_id TEXT NOT NULL,
  content JSONB NOT NULL,
  generation_context JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_content_campaign ON public.ai_generated_content(campaign_id);
CREATE INDEX idx_ai_content_type ON public.ai_generated_content(content_type);

-- Enable RLS
ALTER TABLE public.ai_generated_content ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Campaign members can view AI content"
ON public.ai_generated_content FOR SELECT
USING (is_campaign_member(campaign_id, auth.uid()));

CREATE POLICY "Campaign members can create AI content"
ON public.ai_generated_content FOR INSERT
WITH CHECK (is_campaign_member(campaign_id, auth.uid()));

-- Create updated_at trigger
CREATE TRIGGER update_game_saves_updated_at
BEFORE UPDATE ON public.game_saves
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_saves;
