import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ContentPayload {
  campaignId: string;
  content: Array<{
    content_type: string;
    content_id: string;
    content: Record<string, unknown>;
    generation_context?: Record<string, unknown>;
  }>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase env vars are not configured");
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authentication token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = (await req.json()) as ContentPayload;
    if (!body?.campaignId || !Array.isArray(body.content)) {
      return new Response(
        JSON.stringify({ error: "campaignId and content array are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: campaign, error: campaignError } = await authClient
      .from("campaigns")
      .select("id, owner_id")
      .eq("id", body.campaignId)
      .maybeSingle();

    const { data: member, error: memberError } = await authClient
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", body.campaignId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (campaignError || memberError || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found or access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const isOwner = campaign.owner_id === user.id;
    const isMember = Boolean(member);
    if (!isOwner && !isMember) {
      return new Response(
        JSON.stringify({ error: "Access denied" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const payload = body.content.map((entry) => ({
      campaign_id: body.campaignId,
      content_type: entry.content_type,
      content_id: entry.content_id,
      content: entry.content,
      generation_context: entry.generation_context ?? null,
    }));

    const { error: insertError } = await serviceClient
      .from("ai_generated_content")
      .insert(payload);

    if (insertError) {
      throw insertError;
    }

    return new Response(
      JSON.stringify({ success: true, inserted: payload.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("World content writer error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
