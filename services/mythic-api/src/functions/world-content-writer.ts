import { aiChatCompletions, resolveModel } from "../shared/ai_provider.js";
import { createServiceClient } from "../shared/supabase.js";
import { AuthError, requireUser } from "../shared/auth.js";
import { AuthzError, assertCampaignAccess } from "../shared/authz.js";
import { redactValue } from "../shared/redact.js";
import type { FunctionContext, FunctionHandler } from "./types.js";

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

function respondJson(payload: unknown, requestId: string, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": requestId },
  });
}

export const worldContentWriter: FunctionHandler = {
  name: "world-content-writer",
  auth: "required",
  async handle(req: Request, ctx: FunctionContext): Promise<Response> {
    const requestId = ctx.requestId;

    const errorResponse = (status: number, code: string, message: string, details?: unknown) =>
      respondJson({ ok: false, code, message, details, requestId }, requestId, status);

    try {
      const user = await requireUser(req.headers);

      let body: ContentPayload;
      try {
        body = (await req.json()) as ContentPayload;
      } catch (error) {
        ctx.log.error("world_content_writer.invalid_json", { request_id: requestId });
        return errorResponse(400, "invalid_json", "Request body must be valid JSON");
      }
      if (!body?.campaignId || typeof body.campaignId !== "string") {
        return errorResponse(400, "missing_campaign", "campaignId is required");
      }

      if (Array.isArray(body.content)) {
        const invalidContent = body.content.find(
          (entry) =>
            !entry ||
            typeof entry.content_type !== "string" ||
            typeof entry.content_id !== "string" ||
            entry.content === null ||
            entry.content === undefined,
        );
        if (invalidContent) {
          return errorResponse(400, "invalid_content", "Each content entry must include content_type, content_id, and content");
        }
      }

      const svc = createServiceClient();

      try {
        await assertCampaignAccess(svc, body.campaignId, user.userId);
      } catch {
        return errorResponse(403, "campaign_denied", "Campaign not found or access denied");
      }

      let insertedCount = 0;

      if (Array.isArray(body.content) && body.content.length > 0) {
        const payload = body.content.map((entry) => ({
          campaign_id: body.campaignId,
          content_type: entry.content_type,
          content_id: entry.content_id,
          content: entry.content,
          generation_context: entry.generation_context ?? null,
        }));

        const { error: insertError } = await svc
          .from("ai_generated_content")
          .insert(payload);

        if (insertError) {
          return errorResponse(500, "insert_failed", "Failed to persist content", insertError.message);
        }
        insertedCount += payload.length;
      }

      if (body.action) {
        if (!body.actionHash || typeof body.actionHash !== "string") {
          return errorResponse(400, "missing_action_hash", "actionHash is required for action mutations");
        }
        if (!body.action.text || typeof body.action.text !== "string") {
          return errorResponse(400, "invalid_action", "action.text is required for action mutations");
        }

        const existingEvent = await svc
          .from("world_events")
          .select("id, action_text, response_text, delta, created_at, location_id, location_name")
          .eq("campaign_id", body.campaignId)
          .eq("user_id", user.userId)
          .contains("delta", { action_hash: body.actionHash })
          .maybeSingle();

        if (existingEvent.error) {
          return errorResponse(500, "event_lookup_failed", "Failed to check existing action", existingEvent.error.message);
        }
        if (existingEvent.data) {
          return respondJson(
            {
              ok: true,
              deduped: true,
              delta: (existingEvent.data as any).delta ?? null,
              event: existingEvent.data,
              requestId,
            },
            requestId,
            200,
          );
        }

        const model = resolveModel({ openai: "gpt-4o-mini", groq: "llama-3.3-70b-versatile" });

        const promptPayload = {
          action: body.action,
          context: body.context ?? {},
        };

        const prompt = `${SYSTEM_PROMPT}\n\nPlayer action:\n${body.action.text}\n\nCurrent context:\n${JSON.stringify(promptPayload, null, 2)}`;

        let data: any;
        try {
          data = await aiChatCompletions({
            model,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: prompt },
            ],
            temperature: 0.2,
            max_tokens: 1200,
          });
        } catch (error) {
          return errorResponse(500, "llm_error", "AI generation failed", redactValue({ message: error instanceof Error ? error.message : String(error) }));
        }

        const content = data?.choices?.[0]?.message?.content ?? "";
        if (!content) {
          return errorResponse(500, "empty_ai_response", "AI returned empty response");
        }

        let parsed: ActionDelta & { action_hash?: string };
        try {
          const jsonMatch = content.match(/```(?:json)?\\s*([\\s\\S]*?)```/) || [null, content];
          parsed = JSON.parse(String(jsonMatch[1]).trim());
        } catch (parseError) {
          return errorResponse(500, "invalid_ai_json", "Invalid JSON response from AI", content.slice(0, 500));
        }
        parsed.action_hash = body.actionHash;

        const currentLocationId = body.action.locationId ?? null;
        const contextLocations = body.context?.locations ?? [];

        const normalizedLocations = (Array.isArray(parsed.locations) ? parsed.locations : [])
          .map((raw) => {
            const name = typeof (raw as any).name === "string" ? String((raw as any).name) : "";
            if (!name.trim()) return null;
            const baseId = typeof (raw as any).id === "string" && String((raw as any).id).trim().length > 0
              ? String((raw as any).id)
              : toKebab(name);
            if (!baseId) return null;
            const connectedTo = Array.isArray((raw as any).connectedTo)
              ? (raw as any).connectedTo.filter((id: unknown) => typeof id === "string")
              : [];
            const withCurrent = currentLocationId && !connectedTo.includes(currentLocationId)
              ? [currentLocationId, ...connectedTo]
              : connectedTo;
            const position = typeof (raw as any).position === "object" && (raw as any).position
              ? ((raw as any).position as { x?: number; y?: number })
              : {};
            const resolvedPosition = typeof position.x === "number" && typeof position.y === "number"
              ? { x: position.x, y: position.y }
              : createDeterministicPosition(baseId);
            return {
              ...(raw as any),
              id: baseId,
              name,
              connectedTo: withCurrent,
              position: resolvedPosition,
            } as Record<string, unknown>;
          })
          .filter((loc): loc is Record<string, unknown> => Boolean(loc));

        const newLocationIds = normalizedLocations.map((loc) => String(loc.id));
        const updatedLocationEntries: ContentEntry[] = normalizedLocations.map((loc) => ({
          content_type: "location",
          content_id: String(loc.id),
          content: loc as Record<string, unknown>,
          generation_context: { action: body.action, requestId },
        }));

        if (currentLocationId && newLocationIds.length > 0) {
          const currentLocation = contextLocations.find((loc) => loc.id === currentLocationId);
          if (currentLocation) {
            const existingConnections = Array.isArray(currentLocation.connectedTo) ? currentLocation.connectedTo : [];
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
            const name = typeof (raw as any).name === "string" ? String((raw as any).name) : "";
            if (!name.trim()) return null;
            const id = typeof (raw as any).id === "string" && String((raw as any).id).trim().length > 0
              ? String((raw as any).id)
              : toKebab(name);
            if (!id) return null;
            return { ...(raw as any), id, name } as Record<string, unknown>;
          })
          .filter((npc): npc is Record<string, unknown> => Boolean(npc));

        const normalizedQuests = (Array.isArray(parsed.quests) ? parsed.quests : [])
          .map((raw) => {
            const title = typeof (raw as any).title === "string" ? String((raw as any).title) : "";
            if (!title.trim()) return null;
            const id = typeof (raw as any).id === "string" && String((raw as any).id).trim().length > 0
              ? String((raw as any).id)
              : toKebab(title);
            if (!id) return null;
            return { ...(raw as any), id, title } as Record<string, unknown>;
          })
          .filter((quest): quest is Record<string, unknown> => Boolean(quest));

        const normalizedFlags = (Array.isArray(parsed.storyFlags) ? parsed.storyFlags : [])
          .map((raw) => {
            const id = typeof (raw as any).id === "string" && String((raw as any).id).trim().length > 0
              ? String((raw as any).id)
              : "";
            if (!id) return null;
            const value = (raw as any).value as string | number | boolean;
            if (value === undefined) return null;
            return {
              id,
              value,
              setAt: Date.now(),
              source: typeof (raw as any).source === "string" ? String((raw as any).source) : "action",
            } as Record<string, unknown>;
          })
          .filter((flag): flag is Record<string, unknown> => Boolean(flag));

        const payload: ContentEntry[] = [
          ...updatedLocationEntries,
          ...normalizedNpcs.map((npc) => ({
            content_type: "npc",
            content_id: String(npc.id),
            content: npc as Record<string, unknown>,
            generation_context: { action: body.action, requestId },
          })),
          ...normalizedQuests.map((quest) => ({
            content_type: "quest",
            content_id: String(quest.id),
            content: quest as Record<string, unknown>,
            generation_context: { action: body.action, requestId },
          })),
          ...normalizedFlags.map((flag) => ({
            content_type: "story_flag",
            content_id: String(flag.id),
            content: flag as Record<string, unknown>,
            generation_context: { action: body.action, requestId },
          })),
        ];

        if (payload.length > 0) {
          const { error: insertError } = await svc
            .from("ai_generated_content")
            .insert(payload);
          if (insertError) {
            return errorResponse(500, "content_insert_failed", "Failed to persist action content", insertError.message);
          }
        }

        const { data: eventRow, error: eventError } = await svc
          .from("world_events")
          .insert({
            campaign_id: body.campaignId,
            user_id: user.userId,
            action_text: body.action.text,
            response_text: body.dmResponse?.narration ?? (parsed as any).summary ?? null,
            delta: parsed ?? null,
            location_id: body.action.locationId ?? null,
            location_name: body.action.locationName ?? null,
          })
          .select("id, action_text, response_text, delta, created_at, location_id, location_name")
          .single();

        if (eventError) {
          return errorResponse(500, "event_insert_failed", "Failed to persist action event", eventError.message);
        }

        return respondJson({
          ok: true,
          deduped: false,
          inserted: payload.length,
          delta: parsed,
          event: eventRow,
          requestId,
        }, requestId, 200);
      }

      return respondJson({ ok: true, success: true, inserted: insertedCount, requestId }, requestId, 200);
    } catch (error) {
      if (error instanceof AuthError) {
        return errorResponse(401, error.code, error.code === "auth_required" ? "Authentication required" : "Invalid authentication token");
      }
      if (error instanceof AuthzError) {
        return errorResponse(403, "campaign_denied", "Campaign not found or access denied");
      }
      ctx.log.error("world_content_writer.failed", { request_id: requestId, error: error instanceof Error ? error.message : String(error) });
      return respondJson(
        {
          ok: false,
          code: "unexpected_error",
          message: error instanceof Error ? error.message : "Unknown error",
          requestId,
        },
        requestId,
        500,
      );
    }
  },
};

