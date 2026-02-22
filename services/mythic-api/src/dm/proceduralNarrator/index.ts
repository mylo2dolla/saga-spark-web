import { compactSentence } from "./grammar.js";
import { mapProceduralEvents } from "./eventMapper.js";
import { hasForbiddenNarrationContent } from "./guardrails.js";
import { buildNarrationSeed, createProceduralRng } from "./rng.js";
import {
  ASIDE_LINES,
  ATTACK_VERBS,
  FLAVOR_NOUNS,
  MOTION_VERBS,
  PROCEDURAL_TEMPLATES,
  conciseCountLabel,
  describeContextClue,
} from "./templates.js";
import type {
  ProceduralIntensity,
  ProceduralNarrationEvent,
  ProceduralNarratorDebug,
  ProceduralNarratorInput,
  ProceduralNarratorResult,
  ProceduralTemplate,
  ProceduralTone,
} from "./types.js";

function normalizeBiome(value: string | null): string {
  const key = (value ?? "").trim().toLowerCase();
  if (!key) return "default";
  if (key.includes("forest")) return "forest";
  if (key.includes("desert")) return "desert";
  if (key.includes("swamp")) return "swamp";
  if (key.includes("arctic") || key.includes("ice") || key.includes("snow")) return "arctic";
  if (key.includes("city") || key.includes("town") || key.includes("market")) return "city";
  if (key.includes("dungeon") || key.includes("crypt") || key.includes("cave")) return "dungeon";
  return "default";
}

function normalizeTone(value: string): ProceduralTone {
  const key = value.trim().toLowerCase();
  if (key === "dark" || key === "comic" || key === "heroic" || key === "grim" || key === "mischievous" || key === "tactical") {
    return key;
  }
  if (key.includes("whim")) return "comic";
  if (key.includes("brutal")) return "grim";
  if (key.includes("mythic")) return "heroic";
  if (key.includes("dark")) return "dark";
  return "tactical";
}

function normalizeIntensity(value: string): ProceduralIntensity {
  const key = value.trim().toLowerCase();
  if (key === "low" || key === "med" || key === "high") return key;
  return "med";
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function asNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventActorName(event: ProceduralNarrationEvent): string {
  return asText(event.context.actor, "You");
}

function eventTargetName(event: ProceduralNarrationEvent): string {
  return asText(event.context.target, "the line");
}

function eventAmount(event: ProceduralNarrationEvent): number | null {
  return asNumber(event.context.amount);
}

function eventStatus(event: ProceduralNarrationEvent): string | null {
  const value = event.context.status;
  return typeof value === "string" && value.trim().length > 0 ? value.trim().replace(/_/g, " ") : null;
}

function candidateTemplateScore(args: {
  template: ProceduralTemplate;
  tone: ProceduralTone;
  biome: string;
  intensity: ProceduralIntensity;
}): number {
  let score = Math.max(1, args.template.weight);
  if (args.template.tags.includes(args.tone)) score += 1.1;
  if (args.template.tags.includes(args.biome)) score += 0.8;
  if (args.template.tags.includes(args.intensity)) score += 0.7;
  return score;
}

function chooseTemplate(args: {
  event: ProceduralNarrationEvent;
  tone: ProceduralTone;
  biome: string;
  intensity: ProceduralIntensity;
  rng: ReturnType<typeof createProceduralRng>;
  excludedTemplateIds: Set<string>;
}): ProceduralTemplate {
  const base = PROCEDURAL_TEMPLATES.filter((entry) =>
    entry.eventType === args.event.type && !args.excludedTemplateIds.has(entry.id)
  );
  const pool = base.length > 0
    ? base
    : PROCEDURAL_TEMPLATES.filter((entry) => !args.excludedTemplateIds.has(entry.id));
  const weightedPool = pool.map((entry) => ({
    ...entry,
    weight: candidateTemplateScore({
      template: entry,
      tone: args.tone,
      biome: args.biome,
      intensity: args.intensity,
    }),
  }));
  return args.rng.weightedPick(weightedPool);
}

function cleanupNarration(text: string): string {
  return compactSentence(text)
    .replace(/\s+/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim();
}

export function generateProceduralNarration(input: ProceduralNarratorInput): ProceduralNarratorResult {
  const seed = buildNarrationSeed({
    campaignSeed: input.campaignSeed,
    sessionId: input.sessionId,
    eventId: input.eventId,
  });
  const rng = createProceduralRng(seed);
  const rngPicks: number[] = [];
  const next01 = () => {
    const value = rng.next01();
    rngPicks.push(Number(value.toFixed(6)));
    return value;
  };

  const tone = normalizeTone(input.tone);
  const intensity = normalizeIntensity(input.intensity);
  const biome = normalizeBiome(input.biome);
  const mappedEvents = mapProceduralEvents({
    seed: input.campaignSeed,
    boardType: input.boardType,
    events: input.events,
    stateChanges: input.stateChanges,
    fallbackEventId: input.eventId,
  });
  const primaryEvent = mappedEvents[mappedEvents.length - 1]!;
  const secondaryEvent = mappedEvents.length > 1 ? mappedEvents[mappedEvents.length - 2]! : null;

  const excludedTemplateIds = new Set<string>();
  let selectedTemplate = chooseTemplate({
    event: primaryEvent,
    tone,
    biome,
    intensity,
    rng,
    excludedTemplateIds,
  });

  const attackVerb = rng.pick(ATTACK_VERBS);
  const motionVerb = rng.pick(MOTION_VERBS);
  const flavorNoun = `${describeContextClue(biome, Math.floor(next01() * 1000))} ${rng.pick(FLAVOR_NOUNS)}`;

  const baseContext = {
    event: primaryEvent,
    actor: eventActorName(primaryEvent),
    target: eventTargetName(primaryEvent),
    amount: eventAmount(primaryEvent),
    status: eventStatus(primaryEvent),
    actionSummary: input.actionSummary,
    boardAnchor: input.boardAnchor,
    objective: input.summaryObjective,
    rumor: input.summaryRumor,
    recoveryBeat: input.recoveryBeat,
    boardNarration: input.boardNarration,
    attackVerb,
    motionVerb,
    flavorNoun,
  };

  const secondaryLine = secondaryEvent
    ? `${conciseCountLabel("event", mappedEvents.length)} in motion. ${asText(secondaryEvent.context.actor, "The board")} keeps pressure on ${asText(secondaryEvent.context.target, "the seam")}.`
    : `${input.boardNarration} ${input.summaryObjective ?? input.summaryRumor ?? input.recoveryBeat}`;
  const introLine = input.introOpening
    ? `Opening pressure locks in around ${input.boardAnchor}.`
    : "";
  const errorLine = input.suppressNarrationOnError && input.executionError
    ? `Action blocked: ${input.executionError}.`
    : "";

  let asideUsed = false;
  const asideLine = next01() <= 0.1
    ? (() => {
        asideUsed = true;
        return rng.pick(ASIDE_LINES);
      })()
    : "";

  let rendered = cleanupNarration(
    [
      errorLine,
      introLine,
      selectedTemplate.render(baseContext),
      next01() <= 0.55 ? secondaryLine : input.recoveryBeat,
      asideLine,
    ]
      .filter((entry) => entry.trim().length > 0)
      .slice(0, 3)
      .join(" "),
  );

  let attempts = 0;
  while (hasForbiddenNarrationContent(rendered) && attempts < 4) {
    excludedTemplateIds.add(selectedTemplate.id);
    selectedTemplate = chooseTemplate({
      event: primaryEvent,
      tone,
      biome,
      intensity,
      rng,
      excludedTemplateIds,
    });
    rendered = cleanupNarration(
      [
        errorLine,
        selectedTemplate.render(baseContext),
        input.recoveryBeat,
      ].filter((entry) => entry.trim().length > 0).join(" "),
    );
    attempts += 1;
  }

  if (!rendered || hasForbiddenNarrationContent(rendered)) {
    rendered = cleanupNarration(`Pressure climbs around ${input.boardAnchor}. ${input.recoveryBeat}`);
  }

  const debug: ProceduralNarratorDebug = {
    seed,
    rng_picks: rngPicks,
    template_id: selectedTemplate.id,
    template_tags: selectedTemplate.tags,
    tone,
    biome,
    intensity,
    aside_used: asideUsed,
    event_count: mappedEvents.length,
    event_ids: mappedEvents.map((entry) => entry.id),
    event_types: mappedEvents.map((entry) => entry.type),
    mapped_events: mappedEvents,
  };

  return {
    text: rendered,
    templateId: selectedTemplate.id,
    templateIds: [selectedTemplate.id],
    debug,
  };
}

export type {
  ProceduralIntensity,
  ProceduralNarrationEvent,
  ProceduralNarratorDebug,
  ProceduralNarratorInput,
  ProceduralNarratorResult,
  ProceduralTone,
} from "./types.js";

