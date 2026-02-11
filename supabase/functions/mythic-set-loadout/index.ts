import { serve } from "https://deno.land/std/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RequestSchema = z.object({
  campaignId: z.string().uuid(),
  characterId: z.string().uuid().optional(),
  name: z.string().min(1).max(60).default("Default"),
  skillIds: z.array(z.string().uuid()).max(20),
  activate: z.boolean().default(true),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      throw new Error("Supabase env is not configured (SUPABASE_URL/ANON_KEY/SERVICE_ROLE_KEY)");
    }

    const parsed = RequestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: "Invalid request", details: parsed.error.flatten() }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authToken = authHeader.replace("Bearer ", "");
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: userError } = await authClient.auth.getUser(authToken);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Invalid or expired authentication token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { campaignId, characterId, name, activate } = parsed.data;
    const uniqueSkillIds = Array.from(new Set(parsed.data.skillIds));

    const svc = createClient(supabaseUrl, serviceRoleKey);

    const { data: member } = await svc
      .from("campaign_members")
      .select("id")
      .eq("campaign_id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!member) {
      return new Response(JSON.stringify({ error: "Not authorized for this campaign" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const charQuery = svc
      .schema("mythic")
      .from("characters")
      .select("id,campaign_id,player_id,level")
      .eq("campaign_id", campaignId)
      .eq(characterId ? "id" : "player_id", characterId ?? user.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: character, error: charError } = await charQuery;
    if (charError) throw charError;
    if (!character) {
      return new Response(JSON.stringify({ error: "Character not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: slotsAllowed, error: slotsErr } = await svc
      .schema("mythic")
      .rpc("loadout_slots_for_level", { lvl: character.level });
    if (slotsErr) throw slotsErr;

    const slotCap = Math.max(1, Number(slotsAllowed ?? 2));
    const selected = uniqueSkillIds.slice(0, slotCap);

    if (selected.length > 0) {
      const { data: validSkills, error: skillErr } = await svc
        .schema("mythic")
        .from("skills")
        .select("id,kind")
        .eq("character_id", character.id)
        .in("id", selected)
        .in("kind", ["active", "ultimate"]);
      if (skillErr) throw skillErr;

      const validSet = new Set((validSkills ?? []).map((s) => s.id));
      const invalid = selected.filter((id) => !validSet.has(id));
      if (invalid.length > 0) {
        return new Response(JSON.stringify({ error: "Invalid skills for this character", invalid }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const now = new Date().toISOString();

    const { data: existing } = await svc
      .schema("mythic")
      .from("character_loadouts")
      .select("id")
      .eq("character_id", character.id)
      .eq("name", name)
      .maybeSingle();

    let loadoutId: string;
    if (existing?.id) {
      const { error: updErr } = await svc
        .schema("mythic")
        .from("character_loadouts")
        .update({ slots_json: selected, is_active: activate, updated_at: now })
        .eq("id", existing.id)
        .eq("character_id", character.id);
      if (updErr) throw updErr;
      loadoutId = existing.id;
    } else {
      const { data: ins, error: insErr } = await svc
        .schema("mythic")
        .from("character_loadouts")
        .insert({
          character_id: character.id,
          campaign_id: campaignId,
          name,
          is_active: activate,
          slots_json: selected,
        })
        .select("id")
        .single();
      if (insErr) throw insErr;
      loadoutId = ins.id;
    }

    if (activate) {
      await svc
        .schema("mythic")
        .from("character_loadouts")
        .update({ is_active: false, updated_at: now })
        .eq("character_id", character.id)
        .neq("id", loadoutId);
      await svc
        .schema("mythic")
        .from("character_loadouts")
        .update({ is_active: true, updated_at: now })
        .eq("id", loadoutId);
    }

    await svc
      .schema("mythic")
      .from("progression_events")
      .insert({
        campaign_id: campaignId,
        character_id: character.id,
        event_type: "loadout_changed",
        payload: {
          loadout_id: loadoutId,
          name,
          activated: activate,
          slots: selected,
          slot_cap: slotCap,
        },
      });

    return new Response(JSON.stringify({
      ok: true,
      loadout_id: loadoutId,
      slots: selected,
      slot_cap: slotCap,
      truncated: uniqueSkillIds.length > selected.length,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("mythic-set-loadout error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Failed to set loadout" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
