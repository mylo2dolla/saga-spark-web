-- Allow all campaign members to update combat state (for turn tracking, HP updates, etc.)
DROP POLICY IF EXISTS "DMs can update combat state" ON public.combat_state;

CREATE POLICY "Campaign members can update combat state" 
ON public.combat_state 
FOR UPDATE 
USING (is_campaign_member(auth.uid(), campaign_id));

-- Also allow campaign members to insert combat state if it doesn't exist
CREATE POLICY "Campaign members can insert combat state" 
ON public.combat_state 
FOR INSERT 
WITH CHECK (is_campaign_member(auth.uid(), campaign_id));