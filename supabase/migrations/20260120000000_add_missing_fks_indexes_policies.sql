-- Add missing foreign keys
ALTER TABLE public.game_saves
  ADD CONSTRAINT game_saves_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public.server_nodes
  ADD CONSTRAINT server_nodes_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Add indexes for common foreign keys
CREATE INDEX IF NOT EXISTS idx_abilities_character_id ON public.abilities(character_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_campaign_id ON public.campaign_members(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_members_user_id ON public.campaign_members(user_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON public.campaigns(owner_id);
CREATE INDEX IF NOT EXISTS idx_characters_campaign_id ON public.characters(campaign_id);
CREATE INDEX IF NOT EXISTS idx_characters_user_id ON public.characters(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_campaign_id ON public.chat_messages(campaign_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON public.chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_combat_state_campaign_id ON public.combat_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_grid_state_campaign_id ON public.grid_state(campaign_id);
CREATE INDEX IF NOT EXISTS idx_server_nodes_campaign_id ON public.server_nodes(campaign_id);
CREATE INDEX IF NOT EXISTS idx_server_nodes_user_id ON public.server_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_game_saves_user_id ON public.game_saves(user_id);

-- Add chat message ownership policies
CREATE POLICY "Users can update their own chat messages"
  ON public.chat_messages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chat messages"
  ON public.chat_messages FOR DELETE
  USING (auth.uid() = user_id);
