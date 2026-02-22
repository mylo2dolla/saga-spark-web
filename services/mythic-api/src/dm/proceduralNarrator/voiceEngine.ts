import { compactSentence } from "./grammar.js";
import { createProceduralRng } from "./rng.js";
import type {
  DmLineHistoryBuffer,
  DmNarrationContext,
  DmVoiceProfile,
  ProceduralNarrationEvent,
  ProceduralVoiceMode,
} from "./types.js";

const TOKEN_RX = /[a-z0-9]+/gi;
const PROFILE_MIN = 0;
const PROFILE_MAX = 1;
const DEFAULT_HISTORY_SIZE = 20;
const DEFAULT_SIMILARITY = 0.76;
const FRAGMENT_WINDOW = 3;
const FRAGMENT_LIMIT = 64;

const TACTICAL_POOL = [
  "That window is closing.",
  "Move now or surrender tempo.",
  "You just made yourself a target.",
  "Their flank is open for one heartbeat.",
  "Commit or lose the lane.",
  "You have leverage. Spend it.",
  "One clean step wins this exchange.",
  "Hold center and deny the angle.",
  "You can still steal initiative.",
  "The line bends where you push.",
  "Do not let them reset formation.",
  "They gave you range. Punish it.",
  "You are one tile from control.",
  "A safer path exists, but not for long.",
  "The next trade decides momentum.",
  "Their guard is late on the follow-up.",
  "You can pin this route right now.",
  "You do not need fancy. You need timing.",
  "Trade distance for certainty.",
  "They are overextended. Make it expensive.",
] as const;

const BRUTAL_POOL = [
  "That one hurt.",
  "Bone gave before steel did.",
  "You felt that in your teeth.",
  "The impact carried through armor.",
  "That blow took years off somebody.",
  "The tile shudders under that hit.",
  "You hear something crack.",
  "They are leaking confidence and blood.",
  "That strike rang like a bell.",
  "The air snaps on contact.",
  "No clean blocks left in this lane.",
  "That cut opened a real problem.",
  "You can smell iron from here.",
  "The next hit could end it.",
  "That was not a warning shot.",
  "Somebody is rethinking their life choices.",
  "That impact turned posture into panic.",
  "This fight is chewing through nerves.",
  "They staggered hard on that connection.",
  "You can hear panic in the breathing.",
] as const;

const MISCHIEVOUS_POOL = [
  "Oh no. That was optimistic.",
  "I respect the confidence.",
  "Bold. Possibly stupid.",
  "That plan had charm, if not survival value.",
  "You almost made that look easy.",
  "Did you mean to do that? It worked anyway.",
  "Cute angle. Mean result.",
  "I adore this chaos.",
  "A reckless move, and somehow correct.",
  "That was either genius or luck in a wig.",
  "You keep improvising in dangerous ways.",
  "Somebody is going to write songs about that mistake.",
  "That was illegal in three kingdoms and still efficient.",
  "You just turned panic into leverage.",
  "Unhinged, but tactical enough.",
  "That was rude. I approve.",
  "A little chaos goes a long way.",
  "You made that look intentional.",
  "Messy execution. Great outcome.",
  "You keep feeding me dramatic material.",
] as const;

const DARK_POOL = [
  "The street remembers blood.",
  "Lanternlight lies.",
  "Something hungry is watching this lane.",
  "The shadows lean in when steel sings.",
  "Every victory here has a bill attached.",
  "The map keeps score in scars.",
  "Tonight favors predators.",
  "Mercy is expensive on this board.",
  "The ground drinks first, asks later.",
  "Even silence sounds armed.",
  "Fear travels faster than footsteps here.",
  "This district chews up hesitation.",
  "You can feel history pressing at your back.",
  "The walls remember louder names than yours.",
  "The night wants a debt paid.",
  "Every corner has teeth.",
  "Trust is rare; consequences are not.",
  "The dark loves overconfidence.",
  "The board has no sympathy for slow hands.",
  "Weak footing. Strong consequences.",
] as const;

const WHIMSICAL_POOL = [
  "That escalated delightfully.",
  "Someone is about to regret a life choice.",
  "Chaos put on a party hat.",
  "The board is feeling theatrical tonight.",
  "A dramatic flourish, unexpectedly practical.",
  "The universe winked at that move.",
  "That looked ridiculous and deeply effective.",
  "Confetti would be appropriate if we had time.",
  "That was a very expensive magic trick.",
  "The crowd would cheer if they were not terrified.",
  "A little sparkle, a lot of damage.",
  "This is one bad decision away from legend.",
  "You turned panic into performance art.",
  "There is whimsy in that violence.",
  "The board approves your nonsense.",
  "That was cartoon logic and battlefield math.",
  "Absurd strategy. Solid payoff.",
  "A chaotic move with suspiciously clean timing.",
  "That had style points and real consequences.",
  "Delightful. Also horrifying.",
] as const;

const BLESSING_POOL = [
  "Luck leans your way for now.",
  "Fine. I will let you have that one.",
  "A small mercy lands on your side.",
  "The board gives you one clean breath.",
  "You earned a narrow blessing.",
  "The next step feels strangely favored.",
  "Fortune nods, once.",
  "A kinder angle opens unexpectedly.",
  "The timing finally respects you.",
  "A rare break appears. Take it.",
  "You catch a lucky seam in the chaos.",
  "The storm blinks and you slip through.",
  "Call it grace or call it timing.",
  "The worst outcome passes you by.",
  "A softer hand guides this exchange.",
  "The board pays back some of your risk.",
  "One clean reprieve is yours.",
  "For now, destiny is being helpful.",
  "The lane opens as if invited.",
  "You get one generous heartbeat.",
] as const;

const PUNISHMENT_POOL = [
  "You tempted fate. It noticed.",
  "Did you think I was not watching?",
  "The board punishes sloppy timing.",
  "That debt is due now.",
  "Bad footing meets bad luck.",
  "The lane answers with interest.",
  "You gave them permission to hurt you.",
  "That greed cost blood.",
  "A careless step, an expensive lesson.",
  "The map has teeth for that mistake.",
  "This is what overconfidence buys.",
  "You left the door open. They walked through.",
  "The board collects on hesitation.",
  "That mistake echoed too loudly.",
  "Now you pay for that angle.",
  "A punished gamble, exactly on schedule.",
  "You blinked first. They did not.",
  "That shortcut found a trap.",
  "The board is correcting your attitude.",
  "This is consequences, with receipts.",
] as const;

const MYTHIC_POOL = [
  "Old names stir when you move like that.",
  "The sky keeps a ledger of bold decisions.",
  "Something ancient just leaned closer.",
  "Your strike wakes sleeping thunder.",
  "Legends are forged in moments this sharp.",
  "The battlefield answers like an altar.",
  "The horizon bends toward your intent.",
  "Oaths and iron are speaking the same language.",
  "The board hums with mythic static.",
  "Even the wind sounds ceremonial.",
  "A larger story just took notice.",
  "The ground remembers this rhythm.",
] as const;

const MINIMALIST_POOL = [
  "Claws. Blood. Stone.",
  "Step. Strike. Breathe.",
  "Too close. Too late.",
  "You move. They break.",
  "No room for waste.",
  "One hit. One lesson.",
  "Cold steel. Hot consequence.",
  "Short move. Big damage.",
  "Fast hands. Hard truth.",
  "Hold line. Hit first.",
  "Bad angle. Worse ending.",
  "No speeches. Just outcomes.",
] as const;

const MODE_POOL: Record<ProceduralVoiceMode, readonly string[]> = {
  tactical: TACTICAL_POOL,
  brutal: BRUTAL_POOL,
  mischievous: MISCHIEVOUS_POOL,
  dark: DARK_POOL,
  whimsical: WHIMSICAL_POOL,
  blessing: BLESSING_POOL,
  punishment: PUNISHMENT_POOL,
  mythic: MYTHIC_POOL,
  minimalist: MINIMALIST_POOL,
};

const AGGRESSIVE_PERSONA = ["It commits. Too close. Claws everywhere.", "No hesitation. It is all forward momentum.", "It lunges again before breathing."];
const CUNNING_PERSONA = ["It waits, then feints left.", "It reads your weight shift before striking.", "That one hunts mistakes, not openings."];
const CHAOTIC_PERSONA = ["It thrashes wildly and overextends.", "The pattern is chaos, which is still dangerous.", "It wobbles into violence and somehow connects."];
const BRUTAL_PERSONA = ["It hits hard and keeps hitting.", "It is here to break armor, then nerve.", "Bone-first tactics. No subtlety."];
const WHIMSICAL_PERSONA = ["It bonks, wobbles, and still causes problems.", "The creature looks silly right up to impact.", "Comedic posture, lethal follow-through."];

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(PROFILE_MAX, Math.max(PROFILE_MIN, value));
}

function compact(value: string): string {
  return compactSentence(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function tokenize(value: string): string[] {
  const matches = normalizeText(value).match(TOKEN_RX);
  return matches ? matches.filter(Boolean) : [];
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildFragments(line: string): string[] {
  const tokens = tokenize(line);
  if (tokens.length < FRAGMENT_WINDOW) return tokens.length > 0 ? [tokens.join(" ")] : [];
  const fragments: string[] = [];
  for (let index = 0; index <= tokens.length - FRAGMENT_WINDOW; index += 1) {
    fragments.push(tokens.slice(index, index + FRAGMENT_WINDOW).join(" "));
  }
  return unique(fragments);
}

function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) intersection += 1;
  }
  const union = leftSet.size + rightSet.size - intersection;
  if (union <= 0) return 0;
  return intersection / union;
}

function bigramDice(left: string, right: string): number {
  const leftNorm = normalizeText(left);
  const rightNorm = normalizeText(right);
  if (!leftNorm || !rightNorm) return 0;
  const leftBigrams: string[] = [];
  const rightBigrams: string[] = [];
  for (let i = 0; i < leftNorm.length - 1; i += 1) leftBigrams.push(leftNorm.slice(i, i + 2));
  for (let i = 0; i < rightNorm.length - 1; i += 1) rightBigrams.push(rightNorm.slice(i, i + 2));
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const pair of leftBigrams) counts.set(pair, (counts.get(pair) ?? 0) + 1);
  let overlap = 0;
  for (const pair of rightBigrams) {
    const remaining = counts.get(pair) ?? 0;
    if (remaining <= 0) continue;
    counts.set(pair, remaining - 1);
    overlap += 1;
  }
  return (2 * overlap) / (leftBigrams.length + rightBigrams.length);
}

function lineSimilarity(left: string, right: string): number {
  const tokenSimilarity = jaccardSimilarity(tokenize(left), tokenize(right));
  const bigramSimilarity = bigramDice(left, right);
  return Math.max(tokenSimilarity, bigramSimilarity);
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

function toneValue(vector: Record<string, number>, keys: string[]): number {
  for (const key of keys) {
    const value = vector[key.trim().toLowerCase()];
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function contextualAnchor(context: DmNarrationContext, seedKey: string): string {
  const rng = createProceduralRng(`${seedKey}:anchor`);
  const anchors: string[] = [];
  if (context.activeHooks.length > 0) {
    const hook = context.activeHooks[Math.floor(rng.next01() * context.activeHooks.length)] ?? context.activeHooks[0]!;
    anchors.push(`Hook: ${hook}.`);
  }
  anchors.push(`Board: ${context.boardType} in ${context.biome}.`);
  if (context.factionTension.trim().length > 0) anchors.push(`Faction friction: ${context.factionTension}.`);
  anchors.push(`HP ${Math.round(context.playerHpPct * 100)}%, threat ${Math.round(context.enemyThreatLevel * 100)}%.`);
  if (context.playerReputationTags.length > 0) {
    const tag = context.playerReputationTags[Math.floor(rng.next01() * context.playerReputationTags.length)] ?? context.playerReputationTags[0]!;
    anchors.push(`Reputation echo: ${tag}.`);
  }
  const event = context.recentEvents[context.recentEvents.length - 1];
  if (event) {
    const actor = typeof event.context.actor === "string" ? event.context.actor.trim() : "";
    const target = typeof event.context.target === "string" ? event.context.target.trim() : "";
    if (actor && target) {
      anchors.push(`Latest exchange: ${actor} pressured ${target}.`);
    }
  }
  return compact(anchors[Math.floor(rng.next01() * anchors.length)] ?? "The board stays live.");
}

export function createDmLineHistoryBuffer(args: {
  lines?: string[];
  fragments?: string[];
  maxLines?: number;
  similarityThreshold?: number;
}): DmLineHistoryBuffer {
  const maxLines = Math.max(8, Math.min(64, Math.floor(args.maxLines ?? DEFAULT_HISTORY_SIZE)));
  const similarityThreshold = Math.max(0.55, Math.min(0.94, Number(args.similarityThreshold ?? DEFAULT_SIMILARITY)));
  const lines = Array.isArray(args.lines)
    ? args.lines.map((entry) => compact(String(entry))).filter((entry) => entry.length > 0).slice(-maxLines)
    : [];
  const fragments = Array.isArray(args.fragments)
    ? args.fragments.map((entry) => compact(String(entry).toLowerCase())).filter((entry) => entry.length > 0).slice(-FRAGMENT_LIMIT)
    : unique(lines.flatMap((entry) => buildFragments(entry))).slice(-FRAGMENT_LIMIT);
  return {
    maxLines,
    similarityThreshold,
    lines,
    fragments,
  };
}

export function shouldRejectLine(buffer: DmLineHistoryBuffer, candidate: string): boolean {
  const clean = compact(candidate);
  if (!clean) return true;
  const cleanNorm = normalizeText(clean);
  const candidateFragments = buildFragments(clean).map((entry) => entry.toLowerCase());
  if (buffer.lines.some((entry) => normalizeText(entry) === cleanNorm)) return true;
  if (buffer.lines.some((entry) => lineSimilarity(entry, clean) >= buffer.similarityThreshold)) return true;
  const fragmentSet = new Set(buffer.fragments.map((entry) => entry.toLowerCase()));
  let overlap = 0;
  for (const fragment of candidateFragments) {
    if (!fragmentSet.has(fragment)) continue;
    overlap += 1;
    if (overlap >= 3) return true;
  }
  return false;
}

export function pushDmLineHistory(buffer: DmLineHistoryBuffer, line: string): void {
  const clean = compact(line);
  if (!clean) return;
  buffer.lines = [...buffer.lines, clean].slice(-buffer.maxLines);
  const fragments = unique([...buffer.fragments, ...buildFragments(clean).map((entry) => entry.toLowerCase())]);
  buffer.fragments = fragments.slice(-FRAGMENT_LIMIT);
}

export function buildDmVoiceProfile(args: {
  seedKey: string;
  worldToneVector?: Record<string, number> | null;
}): DmVoiceProfile {
  const rng = createProceduralRng(`${args.seedKey}:profile`);
  const toneVector = toToneVector(args.worldToneVector);
  const darkBias = toneValue(toneVector, ["dark", "grim", "danger"]);
  const whimsyBias = toneValue(toneVector, ["whimsical", "comic", "bright"]);
  const mythicBias = toneValue(toneVector, ["mythic", "epic", "legendary"]);
  const tacticalBias = toneValue(toneVector, ["tactical", "strategy", "discipline"]);

  return {
    sarcasmLevel: clamp01(0.28 + rng.next01() * 0.52 + whimsyBias * 0.07),
    crueltyLevel: clamp01(0.2 + rng.next01() * 0.58 + darkBias * 0.08),
    humorLevel: clamp01(0.18 + rng.next01() * 0.6 + whimsyBias * 0.09),
    verbosityLevel: clamp01(0.26 + rng.next01() * 0.5 + tacticalBias * 0.05),
    mythicIntensity: clamp01(0.24 + rng.next01() * 0.58 + mythicBias * 0.1),
    absurdityLevel: clamp01(0.12 + rng.next01() * 0.62 + whimsyBias * 0.08),
    favoritismBias: clamp01(0.1 + rng.next01() * 0.55),
    memoryRecallBias: clamp01(0.2 + rng.next01() * 0.62 + tacticalBias * 0.05),
  };
}

export function selectVoiceMode(args: {
  seedKey: string;
  context: DmNarrationContext;
  lastVoiceMode?: string | null;
}): ProceduralVoiceMode {
  const rng = createProceduralRng(`${args.seedKey}:voice-mode`);
  const profile = args.context.dmVoiceProfile;
  const weights: Record<ProceduralVoiceMode, number> = {
    tactical: 1.4,
    brutal: 0.8,
    mischievous: 0.7,
    dark: 0.7,
    whimsical: 0.5,
    blessing: 0.4,
    punishment: 0.6,
    mythic: 0.8,
    minimalist: 0.4,
  };

  if (args.context.boardType === "combat") {
    weights.tactical += 0.9;
    weights.brutal += 0.7;
    weights.punishment += 0.4;
  } else {
    weights.whimsical += 0.4;
    weights.mischievous += 0.4;
    weights.mythic += 0.3;
  }
  if (args.context.playerHpPct <= 0.35) {
    weights.brutal += 0.8;
    weights.punishment += 0.7;
    weights.minimalist += 0.4;
  } else if (args.context.playerHpPct >= 0.82) {
    weights.blessing += 0.2;
    weights.mischievous += 0.2;
  }
  if (args.context.enemyThreatLevel >= 0.7) {
    weights.tactical += 0.6;
    weights.brutal += 0.5;
    weights.dark += 0.4;
  }

  weights.mischievous += profile.sarcasmLevel * 0.65;
  weights.whimsical += profile.humorLevel * 0.8 + profile.absurdityLevel * 0.7;
  weights.dark += profile.crueltyLevel * 0.7;
  weights.punishment += profile.crueltyLevel * 0.75;
  weights.blessing += profile.favoritismBias * 0.8;
  weights.mythic += profile.mythicIntensity * 0.95;
  weights.minimalist += Math.max(0, 0.65 - profile.verbosityLevel) * 0.7;
  weights.tactical += profile.verbosityLevel * 0.35;

  if (/\bhigh|critical|war|feud|fracture\b/i.test(args.context.factionTension)) {
    weights.tactical += 0.35;
    weights.dark += 0.35;
  }

  const entries = (Object.entries(weights) as Array<[ProceduralVoiceMode, number]>)
    .map(([mode, weight]) => ({
      mode,
      weight: Math.max(0.05, args.lastVoiceMode === mode ? weight * 0.08 : weight + (rng.next01() * 0.06)),
    }));
  return rng.weightedPick(entries).mode;
}

export function buildEnemyPersonalityLine(args: {
  seedKey: string;
  recentEvents: ProceduralNarrationEvent[];
  history: DmLineHistoryBuffer;
}): string | null {
  const event = [...args.recentEvents].reverse().find((entry) => {
    const traits = entry.context.enemy_traits ?? entry.context.actor_traits;
    return Boolean(traits && typeof traits === "object");
  });
  if (!event) return null;
  const traits = (event.context.enemy_traits ?? event.context.actor_traits) as Record<string, unknown>;
  const aggression = Number(traits.aggression);
  const intelligence = Number(traits.intelligence);
  const instinctType = typeof traits.instinct_type === "string" ? traits.instinct_type.trim().toLowerCase() : "";
  const seedRng = createProceduralRng(`${args.seedKey}:enemy-persona`);

  let pool = AGGRESSIVE_PERSONA;
  if (intelligence >= 0.66 || instinctType === "ambush" || instinctType === "duelist") {
    pool = CUNNING_PERSONA;
  } else if (instinctType === "chaotic") {
    pool = CHAOTIC_PERSONA;
  } else if (aggression >= 0.72 || instinctType === "predator") {
    pool = BRUTAL_PERSONA;
  }
  if (instinctType === "pack" && seedRng.next01() > 0.4) {
    pool = CUNNING_PERSONA;
  }
  if (seedRng.next01() <= 0.12) {
    pool = WHIMSICAL_PERSONA;
  }
  const actor = typeof event.context.actor === "string" ? event.context.actor.trim() : "The enemy";
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const line = compact(`${actor}: ${pool[(attempt + Math.floor(seedRng.next01() * pool.length)) % pool.length]!}`);
    if (shouldRejectLine(args.history, line)) continue;
    pushDmLineHistory(args.history, line);
    return line;
  }
  return null;
}

function phrasePoolForMode(mode: ProceduralVoiceMode): readonly string[] {
  return MODE_POOL[mode] ?? MODE_POOL.tactical;
}

export function buildVoiceLine(args: {
  seedKey: string;
  context: DmNarrationContext;
  mode: ProceduralVoiceMode;
  history: DmLineHistoryBuffer;
}): string {
  const rng = createProceduralRng(`${args.seedKey}:voice-line:${args.mode}`);
  const pool = phrasePoolForMode(args.mode);
  const anchor = contextualAnchor(args.context, `${args.seedKey}:${args.mode}`);
  for (let attempt = 0; attempt < pool.length; attempt += 1) {
    const index = (attempt + Math.floor(rng.next01() * pool.length)) % pool.length;
    const phrase = pool[index]!;
    const line = compact(`${phrase} ${anchor}`);
    if (shouldRejectLine(args.history, line)) continue;
    pushDmLineHistory(args.history, line);
    return line;
  }
  const fallback = compact(`${pool[0] ?? "Keep moving."} ${anchor}`);
  pushDmLineHistory(args.history, fallback);
  return fallback;
}

export function buildVoiceNarrationBundle(args: {
  seedKey: string;
  context: DmNarrationContext;
  history: DmLineHistoryBuffer;
  lastVoiceMode?: string | null;
}): { mode: ProceduralVoiceMode; lines: string[] } {
  const mode = selectVoiceMode({
    seedKey: args.seedKey,
    context: args.context,
    lastVoiceMode: args.lastVoiceMode ?? null,
  });
  const lines: string[] = [];
  lines.push(buildVoiceLine({
    seedKey: `${args.seedKey}:primary`,
    context: args.context,
    mode,
    history: args.history,
  }));

  const profile = args.context.dmVoiceProfile;
  const secondaryMode: ProceduralVoiceMode = (() => {
    if (args.context.playerHpPct <= 0.28 && profile.favoritismBias >= 0.45) return "blessing";
    if (args.context.playerHpPct <= 0.45 && profile.crueltyLevel >= 0.5) return "punishment";
    if (args.context.enemyThreatLevel >= 0.72) return "tactical";
    if (profile.humorLevel >= 0.62) return "mischievous";
    if (profile.mythicIntensity >= 0.68) return "mythic";
    return mode === "tactical" ? "dark" : "tactical";
  })();

  if (secondaryMode !== mode) {
    lines.push(buildVoiceLine({
      seedKey: `${args.seedKey}:secondary`,
      context: args.context,
      mode: secondaryMode,
      history: args.history,
    }));
  }

  const personaLine = buildEnemyPersonalityLine({
    seedKey: `${args.seedKey}:persona`,
    recentEvents: args.context.recentEvents,
    history: args.history,
  });
  if (personaLine) {
    lines.push(personaLine);
  }

  return {
    mode,
    lines: lines.filter((entry) => entry.trim().length > 0).slice(0, 3),
  };
}

export function buildAiVoicePromptTemplate(args: {
  context: DmNarrationContext;
  recentLines: string[];
  recentFragments: string[];
}): string {
  const profile = args.context.dmVoiceProfile;
  const profileBlock = {
    sarcasmLevel: Number(profile.sarcasmLevel.toFixed(3)),
    crueltyLevel: Number(profile.crueltyLevel.toFixed(3)),
    humorLevel: Number(profile.humorLevel.toFixed(3)),
    verbosityLevel: Number(profile.verbosityLevel.toFixed(3)),
    mythicIntensity: Number(profile.mythicIntensity.toFixed(3)),
    absurdityLevel: Number(profile.absurdityLevel.toFixed(3)),
    favoritismBias: Number(profile.favoritismBias.toFixed(3)),
    memoryRecallBias: Number(profile.memoryRecallBias.toFixed(3)),
  };
  const compactContext = {
    boardType: args.context.boardType,
    biome: args.context.biome,
    activeHooks: args.context.activeHooks.slice(0, 4),
    factionTension: args.context.factionTension,
    playerHpPct: Number(args.context.playerHpPct.toFixed(3)),
    enemyThreatLevel: Number(args.context.enemyThreatLevel.toFixed(3)),
    playerReputationTags: args.context.playerReputationTags.slice(0, 6),
    worldToneVector: args.context.worldToneVector,
  };
  return [
    "DM VOICE TEMPLATE (STRICT):",
    "- You are the Mischievous Mythic Dungeon Master.",
    "- Ground every sentence in provided narration context. No floating filler.",
    "- Rotate tone and sentence structure. Never reuse exact or near-duplicate lines from history.",
    "- Keep lines sharp, high-signal, and board-aware. Avoid telemetry/corporate phrasing.",
    `- Voice profile: ${JSON.stringify(profileBlock)}`,
    `- Narration context: ${JSON.stringify(compactContext)}`,
    `- Recent line history (avoid repeats): ${JSON.stringify(args.recentLines.slice(-20))}`,
    `- Recent phrase fragments (avoid reuse): ${JSON.stringify(args.recentFragments.slice(-32))}`,
  ].join("\n");
}
