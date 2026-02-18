DROP POLICY IF EXISTS "Campaign members can insert combat state" ON public.combat_state;
CREATE POLICY "Campaign members can insert combat state"
ON public.combat_state FOR INSERT
WITH CHECK (public.is_campaign_member((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign members can send messages" ON public.chat_messages;
CREATE POLICY "Campaign members can send messages"
ON public.chat_messages FOR INSERT
WITH CHECK (public.is_campaign_member((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign members can update combat state" ON public.combat_state;
CREATE POLICY "Campaign members can update combat state"
ON public.combat_state FOR UPDATE
USING (public.is_campaign_member((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign members can update grid state" ON public.grid_state;
CREATE POLICY "Campaign members can update grid state"
ON public.grid_state FOR UPDATE
USING ((public.is_campaign_member((select auth.uid()), campaign_id) OR public.is_campaign_owner((select auth.uid()), campaign_id)));

DROP POLICY IF EXISTS "Campaign members can view characters" ON public.characters;
CREATE POLICY "Campaign members can view characters"
ON public.characters FOR SELECT
USING ((public.is_campaign_member((select auth.uid()), campaign_id) OR public.is_campaign_owner((select auth.uid()), campaign_id)));

DROP POLICY IF EXISTS "Campaign members can view combat state" ON public.combat_state;
CREATE POLICY "Campaign members can view combat state"
ON public.combat_state FOR SELECT
USING (public.is_campaign_member((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign members can view grid state" ON public.grid_state;
CREATE POLICY "Campaign members can view grid state"
ON public.grid_state FOR SELECT
USING ((public.is_campaign_member((select auth.uid()), campaign_id) OR public.is_campaign_owner((select auth.uid()), campaign_id)));

DROP POLICY IF EXISTS "Campaign members can view messages" ON public.chat_messages;
CREATE POLICY "Campaign members can view messages"
ON public.chat_messages FOR SELECT
USING (public.is_campaign_member((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign members can view their campaigns" ON public.campaigns;
CREATE POLICY "Campaign members can view their campaigns"
ON public.campaigns FOR SELECT
USING ((public.is_campaign_member((select auth.uid()), id) OR (owner_id = (select auth.uid()))));

DROP POLICY IF EXISTS "Campaign owners can delete grid state" ON public.grid_state;
CREATE POLICY "Campaign owners can delete grid state"
ON public.grid_state FOR DELETE
USING (public.is_campaign_owner((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign owners can insert grid state" ON public.grid_state;
CREATE POLICY "Campaign owners can insert grid state"
ON public.grid_state FOR INSERT
WITH CHECK (public.is_campaign_owner((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Campaign owners can manage combat state" ON public.combat_state;
CREATE POLICY "Campaign owners can manage combat state"
ON public.combat_state
USING (public.is_campaign_owner((select auth.uid()), campaign_id));

DROP POLICY IF EXISTS "Members can view campaign members" ON public.campaign_members;
CREATE POLICY "Members can view campaign members"
ON public.campaign_members FOR SELECT
USING ((public.is_campaign_member((select auth.uid()), campaign_id) OR public.is_campaign_owner((select auth.uid()), campaign_id)));

DROP POLICY IF EXISTS "Owners can delete their campaigns" ON public.campaigns;
CREATE POLICY "Owners can delete their campaigns"
ON public.campaigns FOR DELETE
USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Owners can update their campaigns" ON public.campaigns;
CREATE POLICY "Owners can update their campaigns"
ON public.campaigns FOR UPDATE
USING ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users can create abilities for their characters" ON public.abilities;
CREATE POLICY "Users can create abilities for their characters"
ON public.abilities FOR INSERT
WITH CHECK ((EXISTS (
  SELECT 1
  FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = (select auth.uid())))
)));

DROP POLICY IF EXISTS "Users can create campaigns" ON public.campaigns;
CREATE POLICY "Users can create campaigns"
ON public.campaigns FOR INSERT
WITH CHECK ((select auth.uid()) = owner_id);

DROP POLICY IF EXISTS "Users can create their own characters" ON public.characters;
CREATE POLICY "Users can create their own characters"
ON public.characters FOR INSERT
WITH CHECK (((select auth.uid()) = user_id) AND (public.is_campaign_member((select auth.uid()), campaign_id) OR public.is_campaign_owner((select auth.uid()), campaign_id)));

DROP POLICY IF EXISTS "Users can delete their own abilities" ON public.abilities;
CREATE POLICY "Users can delete their own abilities"
ON public.abilities FOR DELETE
USING ((EXISTS (
  SELECT 1
  FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = (select auth.uid())))
)));

DROP POLICY IF EXISTS "Users can delete their own characters" ON public.characters;
CREATE POLICY "Users can delete their own characters"
ON public.characters FOR DELETE
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile"
ON public.profiles FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can join campaigns" ON public.campaign_members;
CREATE POLICY "Users can join campaigns"
ON public.campaign_members FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can leave campaigns" ON public.campaign_members;
CREATE POLICY "Users can leave campaigns"
ON public.campaign_members FOR DELETE
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own abilities" ON public.abilities;
CREATE POLICY "Users can update their own abilities"
ON public.abilities FOR UPDATE
USING ((EXISTS (
  SELECT 1
  FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND (c.user_id = (select auth.uid())))
)));

DROP POLICY IF EXISTS "Users can update their own characters" ON public.characters;
CREATE POLICY "Users can update their own characters"
ON public.characters FOR UPDATE
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile"
ON public.profiles FOR UPDATE
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own abilities" ON public.abilities;
CREATE POLICY "Users can view their own abilities"
ON public.abilities FOR SELECT
USING ((EXISTS (
  SELECT 1
  FROM public.characters c
  WHERE ((c.id = abilities.character_id) AND ((c.user_id = (select auth.uid())) OR public.is_campaign_member((select auth.uid()), c.campaign_id)))
)));

DROP POLICY IF EXISTS "Users can view their own roles" ON public.user_roles;
CREATE POLICY "Users can view their own roles"
ON public.user_roles FOR SELECT
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can view their own saves" ON public.game_saves;
CREATE POLICY "Users can view their own saves"
ON public.game_saves FOR SELECT
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can create their own saves" ON public.game_saves;
CREATE POLICY "Users can create their own saves"
ON public.game_saves FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update their own saves" ON public.game_saves;
CREATE POLICY "Users can update their own saves"
ON public.game_saves FOR UPDATE
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete their own saves" ON public.game_saves;
CREATE POLICY "Users can delete their own saves"
ON public.game_saves FOR DELETE
USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Campaign members can view AI content" ON public.ai_generated_content;
CREATE POLICY "Campaign members can view AI content"
ON public.ai_generated_content FOR SELECT
USING (is_campaign_member(campaign_id, (select auth.uid())));

DROP POLICY IF EXISTS "Campaign members can create AI content" ON public.ai_generated_content;
CREATE POLICY "Campaign members can create AI content"
ON public.ai_generated_content FOR INSERT
WITH CHECK (is_campaign_member(campaign_id, (select auth.uid())));

DROP POLICY IF EXISTS "Authenticated users can view server nodes" ON public.server_nodes;
CREATE POLICY "Authenticated users can view server nodes"
ON public.server_nodes FOR SELECT
USING ((select auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "Users can create own node heartbeat" ON public.server_nodes;
CREATE POLICY "Users can create own node heartbeat"
ON public.server_nodes FOR INSERT
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can update own node heartbeat" ON public.server_nodes;
CREATE POLICY "Users can update own node heartbeat"
ON public.server_nodes FOR UPDATE
USING ((select auth.uid()) = user_id)
WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Users can delete own node heartbeat" ON public.server_nodes;
CREATE POLICY "Users can delete own node heartbeat"
ON public.server_nodes FOR DELETE
USING ((select auth.uid()) = user_id);
