import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { groqChatCompletions } from "../_shared/groq.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ContentEntry {
  content_type: string;
  content_id: string;
  content: Record<string, unknown>;
  generation_context?: Record<string, unknown>;
}

interface ActionPayload {
  text: string;
  locationId?: string | null;
  locationName?: string | null;
}

interface ActionContext {
  locations?: Array<{
    id: string;
    name: string;
    type?: string;
    connectedTo?: string[];
  }>;
  npcs?: Array<{ id: string; name: string; locationId?: string | null }>;
  quests?: Array<{ id: string; title: string; status?: string }>;
  storyFlags?: Array<{ id: string; value: string | number | boolean; source?: string }>;
}

interface ContentPayload {
  campaignId: string;
  content?: ContentEntry[];
  actionHash?: string;
  action?: ActionPayload;
  context?: ActionContext;
  dmResponse?: { narration?: string };
}

interface ActionDelta {
  summary?: string;
  locations?: Array<Record<string, unknown>>;
  npcs?: Array<Record<string, unknown>>;
  quests?: Array<Record<string, unknown>>;
  storyFlags?: Array<Record<string, unknown>>;
}

const SYSTEM_PROMPT = `You are a world-state mutation engine for a narrative RPG. 
Given the player's action and current world summary, produce a JSON delta that updates the world.

Rules:
- Respond with JSON only.
- Do not invent IDs without deriving from names (kebab-case).
- Only include data that should be persisted.
- Keep changes minimal and consistent with the action.

Output schema:
{
  "summary": "short summary of what changed",
  "locations": [
    { "id": "string", "name": "string", "description": "string", "type": "town|wilds|ruins|dungeon", "position": { "x": number, "y": number }, "connectedTo": ["location_id"] }
  ],
  "npcs": [
    { "id": "string", "name": "string", "title": "string", "factionId": "string", "personality": ["trait"], "goals": [{ "id": "string", "description": "string", "priority": 1 }], "dialogue": { "text": "string", "responses": [{ "text": "string" }] } }
  ],
  "quests": [
    { "id": "string", "title": "string", "description": "string", "briefDescription": "string", "objectives": [{ "type": "explore", "description": "string", "required": 1 }], "rewards": { "xp": 0, "gold": 0, "items": [], "storyFlags": [] } }
  ],
  "storyFlags": [
    { "id": "string", "value": true, "source": "string" }
  ]
}`;

const toKebab = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const createDeterministicPosition = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return {
    x: 50 + (hash % 400),
    y: 50 + ((hash >>> 16) % 400),
  };
};

serve(async (req) => {
  const { pathname } = new URL(req.url);
  console.log("world-content-writer request", { method: req.method, pathname });
  const hasAuthHeader = Boolean(req.headers.get("Authorization"));
  console.log("world-content-writer auth header present", { present: hasAuthHeader });

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const requestId = crypto.randomUUID();
  const errorResponse = (
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) =>
    new Response(
      JSON.stringify({ ok: false, code, message, details, requestId }),
      { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(401, "auth_required", "Authentication required");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      return errorResponse(500, "missing_env", "Supabase env vars are not configured");
    }

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return errorResponse(401, "invalid_token", "Invalid authentication token", userError?.message);
    }

    const body = (await req.json()) as ContentPayload;
    if (!body?.campaignId) {
      return errorResponse(400, "missing_campaign", "campaignId is required");
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
      return errorResponse(403, "campaign_denied", "Campaign not found or access denied");
    }

    const isOwner = campaign.owner_id === user.id;
    const isMember = Boolean(member);
    if (!isOwner && !isMember) {
      return errorResponse(403, "access_denied", "Access denied");
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let insertedCount = 0;

    if (Array.isArray(body.content) && body.content.length > 0) {
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
        return errorResponse(500, "insert_failed", "Failed to persist content", insertError.message);
      }
      insertedCount += payload.length;
    }

    if (body.action) {
      if (!body.actionHash) {
        return errorResponse(400, "missing_action_hash", "actionHash is required for action mutations");
      }
      const existingEvent = await serviceClient
        .from("world_events")
        .select("id, action_text, response_text, delta, created_at, location_id, location_name")
        .eq("campaign_id", body.campaignId)
        .eq("user_id", user.id)
        .contains("delta", { action_hash: body.actionHash })
        .maybeSingle();
      if (existingEvent.error) {
        return errorResponse(500, "event_lookup_failed", "Failed to check existing action", existingEvent.error.message);
      }
      if (existingEvent.data) {
        return new Response(
          JSON.stringify({
            ok: true,
            deduped: true,
            delta: existingEvent.data.delta ?? null,
            event: existingEvent.data,
            requestId,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const GROQ_MODEL = Deno.env.get("GROQ_MODEL") ?? "llama-3.3-70b-versatile";
      console.log("Groq model:", GROQ_MODEL);

      const promptPayload = {
        action: body.action,
        context: body.context ?? {},
      };

      const prompt = `${SYSTEM_PROMPT}\n\nPlayer action:\n${body.action.text}\n\nCurrent context:\n${JSON.stringify(promptPayload, null, 2)}`;

      const data = await groqChatCompletions({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        max_tokens: 1200,
      });

      const content = data.choices?.[0]?.message?.content ?? "";
      if (!content) {
        return errorResponse(500, "empty_ai_response", "AI returned empty response");
      }

      let parsed: ActionDelta & { action_hash?: string };
      try {
        const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) || [null, content];
        parsed = JSON.parse(jsonMatch[1].trim());
      } catch (parseError) {
        return errorResponse(500, "invalid_ai_json", "Invalid JSON response from AI", content.slice(0, 500));
      }
      parsed.action_hash = body.actionHash;

      const currentLocationId = body.action.locationId ?? null;
      const contextLocations = body.context?.locations ?? [];

      const normalizedLocations = (Array.isArray(parsed.locations) ? parsed.locations : [])
        .map((raw, index) => {
          const name = typeof raw.name === "string" ? raw.name : "";
          if (!name.trim()) return null;
          const baseId = typeof raw.id === "string" && raw.id.trim().length > 0
            ? raw.id
            : toKebab(name);
          if (!baseId) return null;
        const connectedTo = Array.isArray(raw.connectedTo) ? raw.connectedTo.filter((id) => typeof id === "string") : [];
        const withCurrent = currentLocationId && !connectedTo.includes(currentLocationId)
          ? [currentLocationId, ...connectedTo]
          : connectedTo;
        const position = typeof raw.position === "object" && raw.position
          ? raw.position as { x?: number; y?: number }
          : {};
        const resolvedPosition = typeof position.x === "number" && typeof position.y === "number"
          ? { x: position.x, y: position.y }
          : createDeterministicPosition(baseId);
        return {
          ...raw,
          id: baseId,
          name,
          connectedTo: withCurrent,
          position: resolvedPosition,
        };
      })
      .filter((loc): loc is Record<string, unknown> => Boolean(loc));

      const newLocationIds = normalizedLocations.map((loc) => loc.id);
      const updatedLocationEntries: ContentEntry[] = normalizedLocations.map((loc) => ({
        content_type: "location",
        content_id: loc.id,
        content: loc as Record<string, unknown>,
        generation_context: { action: body.action, requestId },
      }));

      if (currentLocationId && newLocationIds.length > 0) {
        const currentLocation = contextLocations.find((loc) => loc.id === currentLocationId);
        if (currentLocation) {
          const existingConnections = Array.isArray(currentLocation.connectedTo)
            ? currentLocation.connectedTo
            : [];
          const nextConnections = Array.from(new Set([...existingConnections, ...newLocationIds]));
          updatedLocationEntries.push({
            content_type: "location",
            content_id: currentLocationId,
            content: {
              ...currentLocation,
              connectedTo: nextConnections,
            },
            generation_context: { action: body.action, requestId },
          });
        }
      }

      const normalizedNpcs = (Array.isArray(parsed.npcs) ? parsed.npcs : [])
        .map((raw) => {
          const name = typeof raw.name === "string" ? raw.name : "";
          if (!name.trim()) return null;
          const id = typeof raw.id === "string" && raw.id.trim().length > 0
            ? raw.id
            : toKebab(name);
          if (!id) return null;
          return { ...raw, id, name };
        })
        .filter((npc): npc is Record<string, unknown> => Boolean(npc));

      const normalizedQuests = (Array.isArray(parsed.quests) ? parsed.quests : [])
        .map((raw) => {
          const title = typeof raw.title === "string" ? raw.title : "";
          if (!title.trim()) return null;
          const id = typeof raw.id === "string" && raw.id.trim().length > 0
            ? raw.id
            : toKebab(title);
          if (!id) return null;
          return { ...raw, id, title };
        })
        .filter((quest): quest is Record<string, unknown> => Boolean(quest));

      const normalizedFlags = (Array.isArray(parsed.storyFlags) ? parsed.storyFlags : [])
        .map((raw) => {
          const id = typeof raw.id === "string" && raw.id.trim().length > 0
            ? raw.id
            : "";
          if (!id) return null;
          const value = raw.value as string | number | boolean;
          if (value === undefined) return null;
          return {
            id,
            value,
            setAt: Date.now(),
            source: typeof raw.source === "string" ? raw.source : "action",
          };
        })
        .filter((flag): flag is Record<string, unknown> => Boolean(flag));

      const payload: ContentEntry[] = [
        ...updatedLocationEntries,
        ...normalizedNpcs.map((npc) => ({
          content_type: "npc",
          content_id: npc.id as string,
          content: npc as Record<string, unknown>,
          generation_context: { action: body.action, requestId },
        })),
        ...normalizedQuests.map((quest) => ({
          content_type: "quest",
          content_id: quest.id as string,
          content: quest as Record<string, unknown>,
          generation_context: { action: body.action, requestId },
        })),
        ...normalizedFlags.map((flag) => ({
          content_type: "story_flag",
          content_id: flag.id,
          content: flag as Record<string, unknown>,
          generation_context: { action: body.action, requestId },
        })),
      ];

      if (payload.length > 0) {
        const { error: insertError } = await serviceClient
          .from("ai_generated_content")
          .insert(payload);
        if (insertError) {
          return errorResponse(500, "content_insert_failed", "Failed to persist action content", insertError.message);
        }
      }

      const { data: eventRow, error: eventError } = await serviceClient
        .from("world_events")
        .insert({
          campaign_id: body.campaignId,
          user_id: user.id,
          action_text: body.action.text,
          response_text: body.dmResponse?.narration ?? parsed.summary ?? null,
          delta: parsed ?? null,
          location_id: body.action.locationId ?? null,
          location_name: body.action.locationName ?? null,
        })
        .select("id, action_text, response_text, delta, created_at, location_id, location_name")
        .single();

      if (eventError) {
        return errorResponse(500, "event_insert_failed", "Failed to persist action event", eventError.message);
      }

      return new Response(
        JSON.stringify({
          ok: true,
          deduped: false,
          inserted: payload.length,
          delta: parsed,
          event: eventRow,
          requestId,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ ok: true, success: true, inserted: insertedCount, requestId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("World content writer error:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        code: "unexpected_error",
        message: error instanceof Error ? error.message : "Unknown error",
        requestId,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
