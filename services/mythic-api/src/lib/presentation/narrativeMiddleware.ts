import { dedupeKeepOrder, hashLine, pickDeterministic } from "./deterministic.js";
import { personalityLine } from "./enemyPersonality.js";
import { buildSpellName } from "./spellNameBuilder.js";
import { buildSpectacleLine } from "./spectacleEngine.js";
import { NARRATION_VERBS } from "./wordBanks.js";
import type {
  CombatPresentationEvent,
  EnemyPersonalityTraits,
  NarrativeMiddlewareResult,
  SpellPresentationMeta,
  SpellStyleTags,
  ToneMode,
} from "./types.js";

type NormalizedEvent = {
  id: string;
  turnIndex: number;
  eventType: string;
  actorId: string | null;
  actorName: string;
  targetId: string | null;
  targetName: string;
  amount: number | null;
  statusId: string | null;
  createdAt: string;
  to: { x: number; y: number } | null;
  from: { x: number; y: number } | null;
  actorAlive: boolean;
  payload: Record<string, unknown>;
  styleTags: Partial<SpellStyleTags> | null;
  presentation: Partial<SpellPresentationMeta> | null;
  skillName: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function toInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed);
}

function asPoint(value: unknown): { x: number; y: number } | null {
  const row = asObject(value);
  const x = toInt(row.x);
  const y = toInt(row.y);
  if (x === null || y === null) return null;
  return { x, y };
}

function normalizeName(name: unknown, fallback: string): string {
  const value = typeof name === "string" ? name.trim() : "";
  return value.length > 0 ? value : fallback;
}

function normalizeEvent(event: CombatPresentationEvent, index: number): NormalizedEvent {
  const payload = asObject(event.payload);
  const actorId = typeof payload.source_combatant_id === "string"
    ? payload.source_combatant_id
    : typeof payload.actor_combatant_id === "string"
      ? payload.actor_combatant_id
      : typeof event.actor_combatant_id === "string"
        ? event.actor_combatant_id
        : null;
  const targetId = typeof payload.target_combatant_id === "string" ? payload.target_combatant_id : null;
  const actorName = normalizeName(payload.source_name ?? payload.actor_name, actorId ? `Unit ${actorId.slice(0, 4)}` : "Unknown");
  const targetName = normalizeName(payload.target_name, targetId ? `Unit ${targetId.slice(0, 4)}` : "target");
  const amount = toInt(payload.damage_to_hp ?? payload.amount ?? payload.final_damage ?? payload.tiles_used);
  const status = asObject(payload.status);
  const statusId = normalizeName(status.id ?? payload.status_id, "");
  const styleTags = asObject(payload.style_tags);
  const presentation = asObject(payload.presentation);
  const skillName = typeof payload.skill_name === "string" && payload.skill_name.trim().length > 0
    ? payload.skill_name.trim()
    : typeof payload.skill_id === "string" && payload.skill_id.trim().length > 0
      ? payload.skill_id.trim()
      : null;

  return {
    id: String(event.id ?? `${event.event_type}:${index}`),
    turnIndex: Number(event.turn_index ?? 0),
    eventType: String(event.event_type ?? "").trim().toLowerCase(),
    actorId,
    actorName,
    targetId,
    targetName,
    amount,
    statusId: statusId.length > 0 ? statusId : null,
    createdAt: typeof event.created_at === "string" ? event.created_at : "",
    to: asPoint(payload.to),
    from: asPoint(payload.from),
    actorAlive: payload.actor_alive !== false && payload.source_alive !== false,
    payload,
    styleTags: Object.keys(styleTags).length > 0 ? styleTags as Partial<SpellStyleTags> : null,
    presentation: Object.keys(presentation).length > 0 ? presentation as Partial<SpellPresentationMeta> : null,
    skillName,
  };
}

function eventSignature(event: NormalizedEvent): string {
  const to = event.to ? `${event.to.x},${event.to.y}` : "na";
  return [
    event.turnIndex,
    event.eventType,
    event.actorId ?? "na",
    event.targetId ?? "na",
    event.amount ?? "na",
    event.statusId ?? "na",
    to,
  ].join("|");
}

function chooseVerb(seedKey: string, usedKeys: Set<string>): string {
  const available = NARRATION_VERBS.filter((entry) => !usedKeys.has(entry));
  if (available.length === 0) {
    return pickDeterministic(NARRATION_VERBS, seedKey, "verb-fallback");
  }
  return pickDeterministic(available, seedKey, "verb");
}

function compactStatus(statusId: string): string {
  return statusId.replace(/_/g, " ").trim();
}

function compactSentence(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function tonePrefix(tone: ToneMode): string {
  if (tone === "minimalist") return "";
  if (tone === "brutal") return "Hard.";
  if (tone === "whimsical") return "Wildly,";
  if (tone === "mythic") return "Mythic pulse:";
  return "Tactical read:";
}

export function buildNarrativeLinesFromEvents(args: {
  seedKey: string;
  tone: ToneMode;
  events: CombatPresentationEvent[];
  recentLineHashes?: string[];
  recentVerbKeys?: string[];
  enemyTraitsByCombatantId?: Record<string, Partial<EnemyPersonalityTraits>>;
  maxLines?: number;
}): NarrativeMiddlewareResult {
  const maxLines = Math.max(1, Math.min(8, Math.floor(args.maxLines ?? 4)));
  const normalized = args.events.map(normalizeEvent);
  const dedupedBySignature = new Map<string, NormalizedEvent>();
  for (const entry of normalized) {
    if (!entry.eventType) continue;
    const signature = eventSignature(entry);
    if (dedupedBySignature.has(signature)) continue;
    dedupedBySignature.set(signature, entry);
  }

  const deduped = [...dedupedBySignature.values()]
    .sort((left, right) => {
      if (left.turnIndex !== right.turnIndex) return left.turnIndex - right.turnIndex;
      return left.createdAt.localeCompare(right.createdAt);
    });

  const deadActors = new Set<string>();
  const lines: string[] = [];
  const lineTemplateByText = new Map<string, string>();
  const usedVerbs = new Set<string>((args.recentVerbKeys ?? []).map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const pushLine = (text: string, templateId: string) => {
    const clean = compactSentence(text);
    if (!clean) return;
    lines.push(clean);
    if (!lineTemplateByText.has(clean)) {
      lineTemplateByText.set(clean, templateId);
    }
  };

  const groupedDamage = new Map<string, { event: NormalizedEvent; hits: number; total: number }>();
  const groupedStatuses = new Map<string, { event: NormalizedEvent; statuses: Set<string> }>();
  const passthrough: NormalizedEvent[] = [];

  for (const event of deduped) {
    if (event.eventType !== "death" && !event.actorAlive) continue;
    if (event.actorId && deadActors.has(event.actorId) && event.eventType !== "death") continue;

    if (event.eventType === "death" && event.targetId) {
      deadActors.add(event.targetId);
      passthrough.push(event);
      continue;
    }

    if (event.eventType === "damage") {
      const key = `${event.turnIndex}|${event.actorId ?? "na"}|${event.targetId ?? "na"}`;
      const existing = groupedDamage.get(key);
      if (!existing) {
        groupedDamage.set(key, { event, hits: 1, total: Math.max(0, event.amount ?? 0) });
      } else {
        existing.hits += 1;
        existing.total += Math.max(0, event.amount ?? 0);
      }
      continue;
    }

    if (event.eventType === "status_applied") {
      const key = `${event.turnIndex}|${event.actorId ?? "na"}|${event.targetId ?? "na"}`;
      const existing = groupedStatuses.get(key);
      if (!existing) {
        groupedStatuses.set(key, { event, statuses: new Set(event.statusId ? [event.statusId] : []) });
      } else if (event.statusId) {
        existing.statuses.add(event.statusId);
      }
      continue;
    }

    passthrough.push(event);
  }

  groupedDamage.forEach((row) => {
    const event = row.event;
    const verb = chooseVerb(`${args.seedKey}:${event.id}:damage`, usedVerbs);
    usedVerbs.add(verb);
    const toneLead = tonePrefix(args.tone);
    const text = row.hits > 1
      ? `${toneLead ? `${toneLead} ` : ""}${event.actorName} ${verb}s ${event.targetName} ${row.hits} times — ${row.total} total damage.`
      : `${toneLead ? `${toneLead} ` : ""}${event.actorName} ${verb}s ${event.targetName} for ${row.total}.`;
    pushLine(text, row.hits > 1 ? "damage_grouped_multi" : "damage_grouped_single");
  });

  groupedStatuses.forEach((row) => {
    const event = row.event;
    const statusList = [...row.statuses]
      .map((entry) => compactStatus(entry))
      .filter((entry) => entry.length > 0)
      .slice(0, 3);
    if (statusList.length === 0) return;
    pushLine(`${event.actorName} braces — ${statusList.join(", ")} locked on ${event.targetName}.`, "status_merge");
  });

  for (const event of passthrough) {
    if (event.eventType === "moved" && event.to) {
      pushLine(`${event.actorName} shifts to (${event.to.x}, ${event.to.y}).`, "moved");
      continue;
    }
    if (event.eventType === "miss") {
      const roll = toInt(event.payload.roll_d20);
      const required = toInt(event.payload.required_roll);
      if (roll !== null && required !== null) {
        pushLine(`${event.actorName} misses ${event.targetName} (${roll} vs ${required}).`, "miss_roll");
      } else {
        pushLine(`${event.actorName} misses ${event.targetName}.`, "miss");
      }
      continue;
    }
    if (event.eventType === "healed") {
      const amount = Math.max(0, event.amount ?? 0);
      pushLine(`${event.actorName} restores ${amount} to ${event.targetName}.`, "healed");
      continue;
    }
    if (event.eventType === "power_gain") {
      const amount = Math.max(0, event.amount ?? 0);
      pushLine(`${event.actorName} recovers ${amount} MP.`, "power_gain");
      continue;
    }
    if (event.eventType === "power_drain") {
      const amount = Math.max(0, event.amount ?? 0);
      pushLine(`${event.actorName} drains ${amount} MP from ${event.targetName}.`, "power_drain");
      continue;
    }
    if (event.eventType === "status_tick") {
      const amount = Math.max(0, event.amount ?? 0);
      const statusName = event.statusId ? compactStatus(event.statusId) : "status";
      pushLine(`${event.targetName} takes ${amount} from ${statusName}.`, "status_tick");
      continue;
    }
    if (event.eventType === "status_expired") {
      const statusName = event.statusId ? compactStatus(event.statusId) : "effect";
      pushLine(`${event.targetName}'s ${statusName} fades.`, "status_expired");
      continue;
    }
    if (event.eventType === "armor_shred") {
      const amount = Math.max(0, event.amount ?? 0);
      pushLine(`${event.actorName} shreds ${amount} armor from ${event.targetName}.`, "armor_shred");
      continue;
    }
    if (event.eventType === "death") {
      pushLine(`${event.targetName} drops and is out.`, "death");
      continue;
    }
    if (event.eventType === "skill_used" && event.skillName) {
      const rank = Math.max(1, Number(event.presentation?.rank ?? 1));
      const rarity = String(event.presentation?.rarity ?? "magical") as SpellPresentationMeta["rarity"];
      const escalation = Math.max(0, Number(event.presentation?.escalation_level ?? rank));
      const spellBase = String(event.presentation?.spell_base ?? event.skillName);
      const evolved = buildSpellName(spellBase, rank, rarity, escalation, `${args.seedKey}:${event.id}:spell`);
      const spectacle = buildSpectacleLine({
        seedKey: `${args.seedKey}:${event.id}:spectacle`,
        spellName: evolved,
        escalationLevel: escalation,
        styleTags: event.styleTags,
        targetName: event.targetName,
      });
      pushLine(spectacle, "skill_spectacle");
      continue;
    }
  }

  const personalitySeed = passthrough.find((entry) => entry.actorId && args.enemyTraitsByCombatantId?.[entry.actorId]);
  if (personalitySeed?.actorId) {
    const personality = personalityLine({
      seedKey: `${args.seedKey}:${personalitySeed.actorId}:persona`,
      tone: args.tone,
      traits: args.enemyTraitsByCombatantId?.[personalitySeed.actorId],
    });
    pushLine(personality, "enemy_personality");
  }

  const dedupedLines = dedupeKeepOrder(lines).slice(0, maxLines * 2);
  const recentHashes = new Set((args.recentLineHashes ?? []).map((entry) => entry.trim()).filter(Boolean));

  const filteredLines: string[] = [];
  const nextHashes: string[] = [];
  const templateIds: string[] = [];
  for (const line of dedupedLines) {
    const hash = hashLine(line);
    if (recentHashes.has(hash)) continue;
    filteredLines.push(line);
    nextHashes.push(hash);
    const templateId = lineTemplateByText.get(line) ?? "generic_line";
    templateIds.push(templateId);
    if (filteredLines.length >= maxLines) break;
  }

  const resultLines = filteredLines.length > 0
    ? filteredLines
    : ["Steel and spellfire trade space. Pick the next decisive move."];

  const resultHashes = resultLines.map((line) => hashLine(line));
  const resultTemplateIds = (filteredLines.length > 0 ? templateIds : ["fallback_combat_line"]).slice(-8);
  const lastEvent = deduped[deduped.length - 1] ?? null;
  const lastEventCursor = lastEvent
    ? `${lastEvent.turnIndex}:${lastEvent.id}:${lastEvent.createdAt || "na"}`
    : null;
  const verbKeys = [...usedVerbs].slice(-8);
  return {
    lines: resultLines,
    lineHashes: resultHashes,
    verbKeys,
    templateIds: resultTemplateIds,
    lastEventCursor,
  };
}
