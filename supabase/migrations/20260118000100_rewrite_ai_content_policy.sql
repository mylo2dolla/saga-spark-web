DROP POLICY IF EXISTS "Campaign members can create AI content" ON public.ai_generated_content;
CREATE POLICY "Campaign members can create AI content"
ON public.ai_generated_content FOR INSERT
WITH CHECK (is_campaign_member(campaign_id, (select auth.uid())));
