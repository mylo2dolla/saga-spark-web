import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Loader2, Lock, LockOpen, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useMythicCreator } from "@/hooks/useMythicCreator";
import type { MythicCreateCharacterResponse } from "@/types/mythic";
import { PromptAssistField } from "@/components/PromptAssistField";

type Step = "concept" | "review";
type ForgeLockKey = "origin" | "faction" | "background" | "traits" | "moral";

interface Props {
  campaignId: string;
  onComplete: (res: MythicCreateCharacterResponse) => void;
  onCancel?: () => void;
}

const stepVariants = {
  initial: { opacity: 0, x: 18 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -18 },
};

const ORIGIN_REGION_POOL = [
  "borderlands",
  "highlands",
  "storm coast",
  "rift basin",
  "lantern valley",
  "honey meadows",
  "moonlit ruins",
  "obsidian ridge",
];

const FACTION_POOL = [
  "Gilded Accord",
  "Nightwatch Compact",
  "Rift Sentinels",
  "Candle Covenant",
  "Laughing Spiral",
  "Iron Convoy",
  "Velvet Syndicate",
  "Storm Choir",
];

const BACKGROUND_POOL = [
  "frontier courier",
  "guild dropout",
  "chapel acolyte",
  "ex-mercenary quartermaster",
  "ruin cartographer",
  "dockside smuggler",
  "ward apprentice",
  "storm monastery runner",
  "arena understudy",
  "town watch deserter",
];

const PERSONALITY_TRAIT_POOL = [
  "reckless",
  "mercy-driven",
  "patient",
  "sarcastic",
  "ritualistic",
  "loyal",
  "vengeful",
  "tactical",
  "curious",
  "defiant",
  "paranoid",
  "showboat",
  "optimistic",
  "grim",
  "protective",
  "greedy",
];

function hash32(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pickBySeed(pool: readonly string[], seed: string): string {
  return pool[hash32(seed) % pool.length] ?? pool[0] ?? "";
}

function unique(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function parseTraits(input: string): string[] {
  return unique(
    input
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .slice(0, 6)
      .map((entry) => entry.slice(0, 80)),
  );
}

function clampMoral(value: number): number {
  return Math.max(-1, Math.min(1, Number(value.toFixed(2))));
}

export function MythicCharacterCreator({ campaignId, onComplete, onCancel }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("concept");
  const [characterName, setCharacterName] = useState("");
  const [classDescription, setClassDescription] = useState("");
  const [originRegionId, setOriginRegionId] = useState("");
  const [factionAlignmentId, setFactionAlignmentId] = useState("");
  const [background, setBackground] = useState("");
  const [personalityTraitsInput, setPersonalityTraitsInput] = useState("");
  const [moralLeaning, setMoralLeaning] = useState(0);
  const [lockMap, setLockMap] = useState<Record<ForgeLockKey, boolean>>({
    origin: false,
    faction: false,
    background: false,
    traits: false,
    moral: false,
  });
  const [randomizeCount, setRandomizeCount] = useState(0);
  const [result, setResult] = useState<MythicCreateCharacterResponse | null>(null);
  const forgeAbortRef = useRef<AbortController | null>(null);

  const { isBootstrapping, isCreating, lastError, bootstrapCampaign, createCharacter, clearError } = useMythicCreator();

  const personalityTraits = useMemo(() => parseTraits(personalityTraitsInput), [personalityTraitsInput]);

  const canGenerate = useMemo(() => {
    return characterName.trim().length >= 2 && classDescription.trim().length >= 5;
  }, [characterName, classDescription]);

  const toggleLock = (key: ForgeLockKey) => {
    setLockMap((current) => ({
      ...current,
      [key]: !current[key],
    }));
  };

  const randomizeForgeFields = () => {
    const seedBase = `${campaignId}:${characterName}:${classDescription}:${randomizeCount}`;
    const traits = unique([
      pickBySeed(PERSONALITY_TRAIT_POOL, `${seedBase}:trait:0`),
      pickBySeed(PERSONALITY_TRAIT_POOL, `${seedBase}:trait:1`),
      pickBySeed(PERSONALITY_TRAIT_POOL, `${seedBase}:trait:2`),
      pickBySeed(PERSONALITY_TRAIT_POOL, `${seedBase}:trait:3`),
    ]).slice(0, 4);
    const moralRaw = (hash32(`${seedBase}:moral`) % 201) - 100;
    const moralNext = clampMoral(moralRaw / 100);

    if (!lockMap.origin) {
      setOriginRegionId(pickBySeed(ORIGIN_REGION_POOL, `${seedBase}:origin`));
    }
    if (!lockMap.faction) {
      setFactionAlignmentId(pickBySeed(FACTION_POOL, `${seedBase}:faction`));
    }
    if (!lockMap.background) {
      setBackground(pickBySeed(BACKGROUND_POOL, `${seedBase}:background`));
    }
    if (!lockMap.traits) {
      setPersonalityTraitsInput(traits.join(", "));
    }
    if (!lockMap.moral) {
      setMoralLeaning(moralNext);
    }

    setRandomizeCount((value) => value + 1);
  };

  const handleGenerate = async () => {
    clearError();
    forgeAbortRef.current?.abort();
    const controller = new AbortController();
    forgeAbortRef.current = controller;
    try {
      const bootstrap = await bootstrapCampaign(campaignId, { signal: controller.signal });
      if (!bootstrap || controller.signal.aborted) return;
      const created = await createCharacter({
        campaignId,
        characterName: characterName.trim(),
        classDescription: classDescription.trim(),
        originRegionId: originRegionId.trim() || undefined,
        factionAlignmentId: factionAlignmentId.trim() || undefined,
        background: background.trim().slice(0, 160) || undefined,
        personalityTraits: personalityTraits.length > 0 ? personalityTraits : undefined,
        moralLeaning: clampMoral(moralLeaning),
      }, { signal: controller.signal });
      if (!created || controller.signal.aborted) return;
      setResult(created);
      setStep("review");
    } finally {
      if (forgeAbortRef.current === controller) {
        forgeAbortRef.current = null;
      }
    }
  };

  const handleCancelForge = () => {
    forgeAbortRef.current?.abort();
  };

  const handleConfirm = () => {
    if (!result) return;
    onComplete(result);
  };

  const isBusy = isBootstrapping || isCreating;

  const lockButton = (key: ForgeLockKey, label: string) => {
    const isLocked = lockMap[key];
    return (
      <button
        type="button"
        onClick={() => toggleLock(key)}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground"
        disabled={isBusy}
      >
        {isLocked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        {isLocked ? `Unlock ${label}` : `Lock ${label}`}
      </button>
    );
  };

  return (
    <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card/40 p-6">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="font-display text-2xl">Mythic Class Forge</div>
          <div className="text-sm text-muted-foreground">Describe your class and world-facing profile. The system forges a deterministic starter state in mythic schema.</div>
        </div>
        <div className="flex items-center gap-2">
          {isBusy ? (
            <Button variant="outline" onClick={handleCancelForge}>
              Cancel Forge
            </Button>
          ) : null}
          {onCancel ? (
            <Button variant="outline" onClick={onCancel} disabled={isBusy}>
              Close
            </Button>
          ) : null}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {step === "concept" ? (
          <motion.div key="concept" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2 }}>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Character Name</Label>
                <PromptAssistField
                  inputId="name"
                  value={characterName}
                  onChange={setCharacterName}
                  fieldType="character_name"
                  campaignId={campaignId}
                  placeholder="e.g. Nyx"
                  disabled={isBusy}
                  maxLength={60}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="concept">Class Concept</Label>
                <PromptAssistField
                  inputId="concept"
                  value={classDescription}
                  onChange={setClassDescription}
                  fieldType="class_concept"
                  campaignId={campaignId}
                  placeholder='e.g. "werewolf ninja pyromancer" or "goblin priest of broken vending machines"'
                  multiline
                  minRows={6}
                  disabled={isBusy}
                  maxLength={2000}
                />
                <div className="text-xs text-muted-foreground">
                  Violence/gore allowed. Sexual content forbidden.
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/30 p-3">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-semibold">Character Forge Context</div>
                  <Button type="button" variant="outline" size="sm" onClick={randomizeForgeFields} disabled={isBusy}>
                    <Shuffle className="mr-1 h-3.5 w-3.5" />
                    Randomize Unlocked
                  </Button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="origin">Origin Region</Label>
                      {lockButton("origin", "Origin")}
                    </div>
                    <Input
                      id="origin"
                      value={originRegionId}
                      onChange={(event) => setOriginRegionId(event.target.value)}
                      placeholder="e.g. borderlands"
                      disabled={isBusy || lockMap.origin}
                      maxLength={80}
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="faction">Faction Alignment</Label>
                      {lockButton("faction", "Faction")}
                    </div>
                    <Input
                      id="faction"
                      value={factionAlignmentId}
                      onChange={(event) => setFactionAlignmentId(event.target.value)}
                      placeholder="e.g. Gilded Accord"
                      disabled={isBusy || lockMap.faction}
                      maxLength={80}
                    />
                  </div>

                  <div className="grid gap-1.5 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="background">Background</Label>
                      {lockButton("background", "Background")}
                    </div>
                    <Input
                      id="background"
                      value={background}
                      onChange={(event) => setBackground(event.target.value)}
                      placeholder="e.g. guild dropout"
                      disabled={isBusy || lockMap.background}
                      maxLength={160}
                    />
                  </div>

                  <div className="grid gap-1.5 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="traits">Personality Traits (comma separated)</Label>
                      {lockButton("traits", "Traits")}
                    </div>
                    <Textarea
                      id="traits"
                      value={personalityTraitsInput}
                      onChange={(event) => setPersonalityTraitsInput(event.target.value)}
                      placeholder="e.g. tactical, sarcastic, protective"
                      disabled={isBusy || lockMap.traits}
                      rows={2}
                      maxLength={300}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Parsed traits ({personalityTraits.length}/6): {personalityTraits.join(", ") || "-"}
                    </div>
                  </div>

                  <div className="grid gap-1.5 md:col-span-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="moral">Moral Leaning ({moralLeaning.toFixed(2)})</Label>
                      {lockButton("moral", "Moral")}
                    </div>
                    <Slider
                      id="moral"
                      value={[moralLeaning]}
                      min={-1}
                      max={1}
                      step={0.01}
                      onValueChange={(value) => setMoralLeaning(clampMoral(value[0] ?? moralLeaning))}
                      disabled={isBusy || lockMap.moral}
                    />
                    <div className="flex justify-between text-[11px] text-muted-foreground">
                      <span>Ruthless (-1)</span>
                      <span>Pragmatic (0)</span>
                      <span>Idealistic (+1)</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                <Button onClick={handleGenerate} disabled={!canGenerate || isBusy}>
                  {isBusy ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Forging...
                    </span>
                  ) : (
                    "Generate Kit"
                  )}
                </Button>
              </div>

              {lastError ? (
                <div className="space-y-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                  <div>{lastError.message}</div>
                  <div className="flex flex-wrap gap-2">
                    {lastError.code === "auth_required" || lastError.code === "auth_invalid" ? (
                      <Button size="sm" variant="outline" onClick={() => navigate("/login")} disabled={isBusy}>
                        Sign in again
                      </Button>
                    ) : null}
                    {lastError.code === "rate_limited" ? (
                      <Button size="sm" variant="outline" onClick={handleGenerate} disabled={isBusy}>
                        Retry
                      </Button>
                    ) : null}
                    {lastError.code === "timeout" ? (
                      <Button size="sm" variant="outline" onClick={handleGenerate} disabled={isBusy}>
                        Retry once
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </motion.div>
        ) : null}

        {step === "review" && result ? (
          <motion.div key="review" variants={stepVariants} initial="initial" animate="animate" exit="exit" transition={{ duration: 0.2 }}>
            <div className="grid gap-4">
              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="font-display text-xl">{result.class.class_name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{result.class.class_description}</div>
                {result.refinement_mode === "deterministic_fallback" ? (
                  <div className="mt-3 rounded-md border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                    Quality-safe deterministic refinement was used for this forge. Mechanics remain authoritative.
                    {result.refinement_reason && result.refinement_reason !== "deterministic_fallback" ? ` Reason: ${result.refinement_reason}.` : ""}
                  </div>
                ) : null}
                {result.timings_ms ? (
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Forge timings: total {Math.max(0, Math.floor(result.timings_ms.total))}ms ·
                    refinement {Math.max(0, Math.floor(result.timings_ms.refinement))}ms ·
                    db write {Math.max(0, Math.floor(result.timings_ms.db_write))}ms
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-2">
                  <div>
                    <div className="text-xs text-muted-foreground">Role</div>
                    <div className="font-medium">{result.class.role}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Weapon Family</div>
                    <div className="font-medium">{result.class.weapon_identity.family}</div>
                  </div>
                </div>

                {result.character_forge ? (
                  <div className="mt-4 rounded-md border border-border bg-card/30 p-3">
                    <div className="mb-2 text-xs text-muted-foreground">Character Forge Outcome</div>
                    <div className="grid gap-2 text-sm md:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground">Origin</div>
                        <div>{result.character_forge.originRegionName}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Faction</div>
                        <div>{result.character_forge.factionAlignmentName}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Background</div>
                        <div>{result.character_forge.background}</div>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground">Moral Leaning</div>
                        <div>{result.character_forge.moralLeaning.toFixed(2)}</div>
                      </div>
                      <div className="md:col-span-2">
                        <div className="text-xs text-muted-foreground">Traits</div>
                        <div>{result.character_forge.personalityTraits.join(", ") || "-"}</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4">
                  <div className="text-xs text-muted-foreground">Base Stats</div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
                    {Object.entries(result.class.base_stats).map(([k, v]) => (
                      <div key={k} className="rounded-md border border-border bg-card/50 p-2 text-center">
                        <div className="font-display text-sm">{v}</div>
                        <div className="text-muted-foreground">{k}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 rounded-md border border-border bg-card/30 p-3">
                  <div className="text-xs text-muted-foreground">Weakness (by design)</div>
                  <div className="mt-1 text-sm">{result.class.weakness.description}</div>
                  <div className="mt-2 text-xs text-muted-foreground">Counterplay</div>
                  <div className="text-sm">{result.class.weakness.counterplay}</div>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/40 p-4">
                <div className="mb-2 text-sm font-semibold">Abilities</div>
                <ScrollArea className="h-[320px] pr-3">
                  <div className="grid gap-2">
                    {result.skills.map((s, idx) => (
                      <div key={idx} className="rounded-md border border-border bg-card/30 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium">{s.name}</div>
                            <div className="text-xs text-muted-foreground">{s.kind} · {s.targeting} · range {s.range_tiles} · cd {s.cooldown_turns}</div>
                          </div>
                        </div>
                        <div className="mt-2 text-sm text-muted-foreground">{s.description}</div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>

              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setStep("concept")} disabled={isBusy}>
                  Regenerate
                </Button>
                <Button onClick={handleConfirm}>
                  Confirm Character
                </Button>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
