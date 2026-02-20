import { z } from "zod";
import { assertContentAllowed } from "./content_policy.js";

const MAX_NARRATION_LEN = 8_000;
const MAX_ACTION_LABEL_LEN = 80;
const GENERIC_ACTION_LABEL_RX = /^(action\s+\d+|narrative\s+update)$/i;

export const UiActionIntentSchema = z.enum([
  "town",
  "travel",
  "dungeon",
  "combat_start",
  "shop",
  "focus_target",
  "open_panel",
  "dm_prompt",
  "refresh",
]);

export type UiActionIntent = z.infer<typeof UiActionIntentSchema>;

function normalizeUiIntent(value: unknown): UiActionIntent | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase();
  if (!key) return null;

  if (key === "town" || key === "travel" || key === "dungeon" || key === "combat_start" || key === "shop" || key === "focus_target" || key === "open_panel" || key === "dm_prompt" || key === "refresh") {
    return key;
  }

  if (key === "combat" || key === "battle" || key === "fight" || key === "engage" || key === "combat_begin") {
    return "combat_start";
  }

  if (key === "board_transition" || key === "transition" || key === "board_transition_travel") {
    return "travel";
  }
  if (key === "board_transition_town" || key === "return_town") {
    return "town";
  }
  if (key === "board_transition_dungeon" || key === "enter_dungeon") {
    return "dungeon";
  }

  if (key === "panel" || key === "open_menu") {
    return "open_panel";
  }

  if (key === "prompt" || key === "narrate") {
    return "dm_prompt";
  }

  return null;
}

export const UiActionSchema = z
  .object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(MAX_ACTION_LABEL_LEN)
      .refine((value) => !GENERIC_ACTION_LABEL_RX.test(value), "generic_action_label"),
    intent: z.preprocess((value) => {
      const normalized = normalizeUiIntent(value);
      return normalized ?? value;
    }, UiActionIntentSchema),
    hint_key: z.string().trim().min(1).max(120).optional(),
    prompt: z.string().trim().min(1).max(800).optional(),
    payload: z.record(z.unknown()).optional(),
    boardTarget: z.enum(["town", "travel", "dungeon", "combat"]).optional(),
    board_target: z.enum(["town", "travel", "dungeon", "combat"]).optional(),
    panel: z.enum(["character", "gear", "skills", "loadouts", "progression", "quests", "commands", "settings"]).optional(),
  })
  .strict();

export type UiAction = z.infer<typeof UiActionSchema>;

export const CompanionCheckinSchema = z
  .object({
    companion_id: z.string().trim().min(1).max(80),
    line: z.string().trim().min(1).max(320),
    mood: z.string().trim().min(1).max(48),
    urgency: z.string().trim().min(1).max(24),
    hook_type: z.string().trim().min(1).max(64),
  })
  .strict();

export type CompanionCheckin = z.infer<typeof CompanionCheckinSchema>;

const BoardDeltaEntrySchema = z.union([
  z.string().trim().min(1).max(320),
  z.record(z.unknown()),
]);

export const BoardDeltaSchema = z
  .object({
    rumors: z.array(BoardDeltaEntrySchema).max(24).optional(),
    objectives: z.array(BoardDeltaEntrySchema).max(24).optional(),
    discovery_log: z.array(BoardDeltaEntrySchema).max(36).optional(),
    discovery_flags: z.record(z.unknown()).optional(),
    scene_cache: z.record(z.unknown()).optional(),
    companion_checkins: z.array(CompanionCheckinSchema).max(8).optional(),
    action_chips: z.array(UiActionSchema).max(8).optional(),
  })
  .strict();

export type BoardDelta = z.infer<typeof BoardDeltaSchema>;

export const RollLogEntrySchema = z
  .object({
    // Sequential index for deterministic replay.
    i: z.number().int().min(0).max(10_000),
    label: z.string().trim().min(1).max(80),
    value01: z.number().min(0).max(1),
    meta: z.record(z.unknown()).optional(),
  })
  .strict();

export type RollLogEntry = z.infer<typeof RollLogEntrySchema>;

export const PatchFactSchema = z
  .object({
    op: z.enum(["FACT_CREATE", "FACT_SUPERSEDE"]),
    fact_key: z.string().trim().min(1).max(160),
    data: z.record(z.unknown()),
  })
  .strict();

export const PatchEntityUpsertSchema = z
  .object({
    op: z.literal("ENTITY_UPSERT"),
    entity_key: z.string().trim().min(1).max(200),
    entity_type: z.string().trim().min(1).max(80).default("entity"),
    data: z.record(z.unknown()),
    tags: z.array(z.string().trim().min(1).max(48)).max(24).optional(),
  })
  .strict();

export const PatchRelationshipSchema = z
  .object({
    op: z.literal("REL_SET"),
    subject_key: z.string().trim().min(1).max(200),
    object_key: z.string().trim().min(1).max(200),
    rel_type: z.string().trim().min(1).max(80),
    data: z.record(z.unknown()).optional(),
  })
  .strict();

export const PatchQuestUpsertSchema = z
  .object({
    op: z.literal("QUEST_UPSERT"),
    quest_key: z.string().trim().min(1).max(200),
    data: z.record(z.unknown()),
  })
  .strict();

export const PatchLocationStateSchema = z
  .object({
    op: z.literal("LOCATION_STATE_UPDATE"),
    location_key: z.string().trim().min(1).max(200),
    data: z.record(z.unknown()),
  })
  .strict();

export const WorldPatchSchema = z.discriminatedUnion("op", [
  PatchFactSchema,
  PatchEntityUpsertSchema,
  PatchRelationshipSchema,
  PatchQuestUpsertSchema,
  PatchLocationStateSchema,
]);

export type WorldPatch = z.infer<typeof WorldPatchSchema>;

export const DmPlannerOutputSchema = z
  .object({
    schema_version: z.string().trim().min(1).max(64).optional(),
    plan: z.string().trim().min(1).max(10_000),
    notes: z.string().trim().min(1).max(5_000).optional(),
    patches: z.array(z.unknown()).optional(),
    roll_log: z.array(RollLogEntrySchema).max(256).optional(),
  })
  .passthrough();

export const DmNarratorOutputSchema = z
  .object({
    schema_version: z.string().trim().min(1).max(64).optional(),
    narration: z.string().trim().min(1).max(MAX_NARRATION_LEN),
    scene: z.record(z.unknown()).optional(),
    effects: z.record(z.unknown()).optional(),
    ui_actions: z.array(UiActionSchema).max(8).optional(),
    board_delta: BoardDeltaSchema.optional(),
    patches: z.array(z.unknown()).optional(),
    roll_log: z.array(RollLogEntrySchema).max(256).optional(),
  })
  .passthrough();

export type DmNarratorOutput = z.infer<typeof DmNarratorOutputSchema>;

function extractJsonObject(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return trimmed.slice(start, end + 1).trim();
}

export function parseDmNarratorOutput(rawText: string):
  | { ok: true; value: DmNarratorOutput }
  | { ok: false; errors: string[] } {
  const jsonText = extractJsonObject(rawText);
  if (!jsonText) return { ok: false, errors: ["invalid_json:missing_object"] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    return { ok: false, errors: [`invalid_json:${error instanceof Error ? error.message : String(error)}`] };
  }

  const result = DmNarratorOutputSchema.safeParse(parsed);
  if (!result.success) {
    const flat = result.error.flatten();
    const errors = Object.entries(flat.fieldErrors)
      .flatMap(([key, list]) => (list ?? []).map((msg) => `field:${key}:${msg}`));
    const root = flat.formErrors.map((msg) => `form:${msg}`);
    return { ok: false, errors: [...errors, ...root].slice(0, 24) };
  }

  // Content policy validation on text fields.
  try {
    const checkins = result.data.board_delta?.companion_checkins ?? [];
    assertContentAllowed([
      { path: "narration", value: result.data.narration },
      { path: "scene.environment", value: typeof result.data.scene?.environment === "string" ? result.data.scene.environment : null },
      { path: "scene.mood", value: typeof result.data.scene?.mood === "string" ? result.data.scene.mood : null },
      { path: "scene.focus", value: typeof result.data.scene?.focus === "string" ? result.data.scene.focus : null },
      ...checkins.map((entry, index) => ({ path: `board_delta.companion_checkins[${index}].line`, value: entry.line })),
    ]);
  } catch (error) {
    return { ok: false, errors: [`content_policy:${error instanceof Error ? error.message : String(error)}`] };
  }

  return { ok: true, value: result.data };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeWorldPatches(raw: unknown): { patches: WorldPatch[]; dropped: number } {
  const arr = Array.isArray(raw) ? raw : [];
  const patches: WorldPatch[] = [];
  let dropped = 0;

  for (const entry of arr) {
    const rec = asRecord(entry);
    if (!rec) {
      dropped += 1;
      continue;
    }

    const op = typeof rec.op === "string" && rec.op.trim().length > 0
      ? rec.op.trim()
      : typeof rec.type === "string" && rec.type.trim().length > 0
        ? rec.type.trim()
        : "";
    if (!op) {
      dropped += 1;
      continue;
    }

    const normalized: Record<string, unknown> = { op };
    if (op === "FACT_CREATE" || op === "FACT_SUPERSEDE") {
      normalized.fact_key = typeof rec.fact_key === "string"
        ? rec.fact_key
        : typeof rec.key === "string"
          ? rec.key
          : "";
      normalized.data = asRecord(rec.data) ?? asRecord(rec.fact_json) ?? {};
    } else if (op === "ENTITY_UPSERT") {
      normalized.entity_key = typeof rec.entity_key === "string"
        ? rec.entity_key
        : typeof rec.id === "string"
          ? rec.id
          : "";
      normalized.entity_type = typeof rec.entity_type === "string"
        ? rec.entity_type
        : typeof rec.kind === "string"
          ? rec.kind
          : "entity";
      normalized.data = asRecord(rec.data) ?? asRecord(rec.entity_json) ?? {};
      normalized.tags = Array.isArray(rec.tags) ? rec.tags : [];
    } else if (op === "REL_SET") {
      normalized.subject_key = typeof rec.subject_key === "string"
        ? rec.subject_key
        : typeof rec.subject === "string"
          ? rec.subject
          : "";
      normalized.object_key = typeof rec.object_key === "string"
        ? rec.object_key
        : typeof rec.object === "string"
          ? rec.object
          : "";
      normalized.rel_type = typeof rec.rel_type === "string"
        ? rec.rel_type
        : typeof rec.type_name === "string"
          ? rec.type_name
          : "";
      normalized.data = asRecord(rec.data) ?? asRecord(rec.rel_json) ?? {};
    } else if (op === "QUEST_UPSERT") {
      normalized.quest_key = typeof rec.quest_key === "string"
        ? rec.quest_key
        : typeof rec.id === "string"
          ? rec.id
          : "";
      normalized.data = asRecord(rec.data) ?? {};
    } else if (op === "LOCATION_STATE_UPDATE") {
      normalized.location_key = typeof rec.location_key === "string"
        ? rec.location_key
        : typeof rec.id === "string"
          ? rec.id
          : "";
      normalized.data = asRecord(rec.data) ?? {};
    }

    const parsed = WorldPatchSchema.safeParse(normalized);
    if (parsed.success) {
      patches.push(parsed.data);
    } else {
      dropped += 1;
    }
  }

  return { patches, dropped };
}
