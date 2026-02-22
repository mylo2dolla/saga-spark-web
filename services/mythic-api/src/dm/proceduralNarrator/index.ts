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
import {
  buildDmVoiceProfile,
  buildVoiceNarrationBundle,
  createDmLineHistoryBuffer,
  pushDmLineHistory,
  shouldRejectLine,
} from "./voiceEngine.js";
import type {
  DmNarrationContext,
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

function clamp01(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function toToneVector(value: Record<string, number> | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value) return out;
  for (const [key, raw] of Object.entries(value)) {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    out[key.trim().toLowerCase()] = parsed;
  }
  return out;
}

function inferEnemyThreat(events: ProceduralNarrationEvent[]): number {
  if (events.length === 0) return 0.45;
  let threatScore = 0;
  for (const event of events) {
    if (event.type === "COMBAT_ATTACK_RESOLVED") threatScore += 0.12;
    if (event.type === "STATUS_TICK") threatScore += 0.08;
    if (event.type === "BOARD_TRANSITION") threatScore += 0.04;
    const amount = Number(event.context.amount);
    if (Number.isFinite(amount) && amount > 0) {
      threatScore += Math.min(0.18, amount / 200);
    }
  }
  return clamp01(0.3 + threatScore, 0.52);
}

function buildNarrationContext(args: {
  input: ProceduralNarratorInput;
  mappedEvents: ProceduralNarrationEvent[];
  biome: string;
  voiceProfile: DmNarrationContext["dmVoiceProfile"];
}): DmNarrationContext {
  const hooks = [
    ...(Array.isArray(args.input.activeHooks) ? args.input.activeHooks : []),
    args.input.summaryObjective,
    args.input.summaryRumor,
    args.input.actionSummary,
    args.input.boardAnchor,
  ]
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0)
    .slice(0, 5);
  const reputation = [
    ...(Array.isArray(args.input.playerReputationTags) ? args.input.playerReputationTags : []),
  ]
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0)
    .slice(0, 8);
  const hpPct = clamp01(Number(args.input.playerHpPct), 0.65);
  const threatLevel = clamp01(Number(args.input.enemyThreatLevel), inferEnemyThreat(args.mappedEvents));
  return {
    boardType: asText(args.input.boardType, "combat"),
    biome: asText(args.input.biome, args.biome),
    activeHooks: hooks,
    factionTension: asText(args.input.factionTension, "moderate"),
    playerHpPct: hpPct,
    enemyThreatLevel: threatLevel,
    recentEvents: args.mappedEvents.slice(-12),
    playerReputationTags: reputation,
    worldToneVector: toToneVector(args.input.worldToneVector),
    dmVoiceProfile: args.voiceProfile,
  };
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
  const voiceProfile = buildDmVoiceProfile({
    seedKey: `${seed}:voice-profile`,
    worldToneVector: input.worldToneVector ?? null,
  });
  const narrationContext = buildNarrationContext({
    input,
    mappedEvents,
    biome,
    voiceProfile,
  });
  const historyBuffer = createDmLineHistoryBuffer({
    lines: input.lineHistory,
    fragments: input.fragmentHistory,
    maxLines: input.lineHistorySize,
    similarityThreshold: input.similarityThreshold,
  });
  const lineHistoryBefore = [...historyBuffer.lines];

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
    ? `${conciseCountLabel("event", mappedEvents.length)} unfolding. ${asText(secondaryEvent.context.actor, "The board")} pressures ${asText(secondaryEvent.context.target, "the seam")}.`
    : `${input.boardNarration} ${input.summaryObjective ?? input.summaryRumor ?? input.recoveryBeat}`;
  const introLine = input.introOpening
    ? `Opening move locks around ${input.boardAnchor}.`
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
  const voiceBundle = buildVoiceNarrationBundle({
    seedKey: `${seed}:voice-bundle`,
    context: narrationContext,
    history: historyBuffer,
    lastVoiceMode: input.lastVoiceMode ?? null,
  });

  const composedLines: string[] = [];
  const candidateLineCount = voiceProfile.verbosityLevel >= 0.68 ? 3 : voiceProfile.verbosityLevel >= 0.35 ? 2 : 1;
  const pushCandidate = (value: string) => {
    const clean = cleanupNarration(value);
    if (!clean) return;
    if (shouldRejectLine(historyBuffer, clean)) return;
    composedLines.push(clean);
    pushDmLineHistory(historyBuffer, clean);
  };
  if (errorLine) pushCandidate(errorLine);
  if (introLine) pushCandidate(introLine);
  pushCandidate(selectedTemplate.render(baseContext));
  for (const line of voiceBundle.lines) {
    const clean = cleanupNarration(line);
    if (clean.length > 0 && !composedLines.includes(clean)) {
      composedLines.push(clean);
    }
    if (composedLines.length >= candidateLineCount + (errorLine ? 1 : 0)) break;
  }
  if (next01() <= 0.58) pushCandidate(secondaryLine);
  if (next01() <= 0.12) pushCandidate(asideLine);

  let rendered = cleanupNarration(
    composedLines
      .filter((entry) => entry.trim().length > 0)
      .slice(0, Math.max(1, candidateLineCount + (errorLine ? 1 : 0)))
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
    const retryLines: string[] = [];
    const pushRetry = (value: string) => {
      const clean = cleanupNarration(value);
      if (!clean) return;
      if (shouldRejectLine(historyBuffer, clean)) return;
      retryLines.push(clean);
      pushDmLineHistory(historyBuffer, clean);
    };
    if (errorLine) pushRetry(errorLine);
    pushRetry(selectedTemplate.render(baseContext));
    const retryBundle = buildVoiceNarrationBundle({
      seedKey: `${seed}:voice-retry:${attempts}`,
      context: narrationContext,
      history: historyBuffer,
      lastVoiceMode: voiceBundle.mode,
    });
    for (const line of retryBundle.lines) {
      const clean = cleanupNarration(line);
      if (clean.length > 0 && !retryLines.includes(clean)) {
        retryLines.push(clean);
      }
    }
    pushRetry(input.recoveryBeat);
    rendered = cleanupNarration(
      retryLines
        .filter((entry) => entry.trim().length > 0)
        .slice(0, Math.max(1, candidateLineCount + (errorLine ? 1 : 0)))
        .join(" "),
    );
    attempts += 1;
  }

  if (!rendered || hasForbiddenNarrationContent(rendered)) {
    rendered = cleanupNarration(`${voiceBundle.lines[0] ?? `Hold ${input.boardAnchor}.`} ${input.recoveryBeat}`);
    if (shouldRejectLine(historyBuffer, rendered)) {
      rendered = cleanupNarration(`Board state shifts around ${input.boardAnchor}. ${input.recoveryBeat}`);
    }
    pushDmLineHistory(historyBuffer, rendered);
  }

  const debug: ProceduralNarratorDebug = {
    seed,
    rng_picks: rngPicks,
    template_id: selectedTemplate.id,
    template_tags: selectedTemplate.tags,
    tone,
    voice_mode: voiceBundle.mode,
    voice_profile: voiceProfile,
    biome,
    intensity,
    aside_used: asideUsed,
    event_count: mappedEvents.length,
    event_ids: mappedEvents.map((entry) => entry.id),
    event_types: mappedEvents.map((entry) => entry.type),
    mapped_events: mappedEvents,
    line_history_before: lineHistoryBefore,
    line_history_after: [...historyBuffer.lines],
    fragment_history_after: [...historyBuffer.fragments],
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
