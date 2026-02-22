import { useEffect, useMemo, useState } from "react";

import {
  XP_PRESET_ORDER,
  buildTunables,
  type XpPreset,
  xpToNext,
  xpToReachLevel,
  computeBuyPrice,
  expectedDamage,
  DEFAULT_RULE_TUNABLES,
  type RuleTunables,
} from "@/rules";
import {
  readLatestMythicDebugSnapshot,
  readMythicDebugHistory,
  subscribeMythicDebugSnapshots,
  type MythicDebugSnapshot,
} from "@/lib/mythicDebugStore";

function num(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringArray(value: unknown): string[] {
  return asArray(value)
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);
}

function maybeNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function worldSeedFromContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) return null;
  const direct = asRecord(context.world_seed ?? context.worldSeed);
  if (direct) return direct;
  const campaignContext = asRecord(context.campaign_context ?? context.campaignContext);
  return asRecord(campaignContext?.worldSeed ?? campaignContext?.world_seed);
}

function worldContextFromContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) return null;
  const direct = asRecord(context.world_context ?? context.worldContext);
  if (direct) return direct;
  const campaignContext = asRecord(context.campaign_context ?? context.campaignContext);
  return asRecord(campaignContext?.worldContext ?? campaignContext?.world_context);
}

function worldStateFromContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) return null;
  const direct = asRecord(context.world_state ?? context.worldState);
  if (direct) return direct;
  const worldContext = worldContextFromContext(context);
  return asRecord(worldContext?.worldState ?? worldContext?.world_state);
}

function dmProfileFromContext(context: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!context) return null;
  const dmContext = asRecord(context.dm_context ?? context.dmContext);
  return asRecord(dmContext?.profile ?? dmContext?.dmBehaviorProfile);
}

function toneVectorFromSeed(seed: Record<string, unknown> | null): Array<{ key: string; value: number }> {
  const rawTone = asRecord(seed?.tone_vector ?? seed?.toneVector);
  const keys = ["darkness", "whimsy", "brutality", "absurdity", "cosmic", "heroic", "tragic", "cozy"];
  return keys
    .map((key) => {
      const value = maybeNumber(rawTone?.[key]);
      return value == null ? null : { key, value };
    })
    .filter((entry): entry is { key: string; value: number } => Boolean(entry));
}

function resolveWorldName(worldContext: Record<string, unknown> | null): string {
  if (!worldContext) return "-";
  const summaryName = typeof worldContext.world_name === "string" ? worldContext.world_name : null;
  if (summaryName && summaryName.trim().length > 0) return summaryName;
  const worldBible = asRecord(worldContext.worldBible);
  const fullName = typeof worldBible?.worldName === "string" ? worldBible.worldName : null;
  return fullName && fullName.trim().length > 0 ? fullName : "-";
}

function resolveMoralClimate(worldContext: Record<string, unknown> | null): string {
  if (!worldContext) return "-";
  const summary = typeof worldContext.moral_climate === "string" ? worldContext.moral_climate : null;
  if (summary && summary.trim().length > 0) return summary;
  const worldBible = asRecord(worldContext.worldBible);
  const full = typeof worldBible?.moralClimate === "string" ? worldBible.moralClimate : null;
  return full && full.trim().length > 0 ? full : "-";
}

function extractPresetTrace(context: Record<string, unknown> | null): string[] {
  const campaignContext = asRecord(context?.campaign_context ?? context?.campaignContext);
  const worldSeed = asRecord(campaignContext?.worldSeed ?? campaignContext?.world_seed);
  return asStringArray(worldSeed?.presetTrace ?? worldSeed?.preset_trace);
}

function extractForgeInput(context: Record<string, unknown> | null): Record<string, unknown> {
  const campaignContext = asRecord(context?.campaign_context ?? context?.campaignContext);
  const worldSeed = asRecord(campaignContext?.worldSeed ?? campaignContext?.world_seed);
  return asRecord(worldSeed?.forgeInput ?? worldSeed?.forge_input) ?? {};
}

function buildSnapshotDiffs(
  current: MythicDebugSnapshot | null,
  previous: MythicDebugSnapshot | null,
): string[] {
  if (!current || !previous) return [];

  const currentContext = asRecord(current.context);
  const previousContext = asRecord(previous.context);
  const currentSeed = worldSeedFromContext(currentContext);
  const previousSeed = worldSeedFromContext(previousContext);
  const currentState = worldStateFromContext(currentContext);
  const previousState = worldStateFromContext(previousContext);

  const diffs: string[] = [];

  const currentSeedString = String(currentSeed?.seed_string ?? currentSeed?.seedString ?? "").trim();
  const previousSeedString = String(previousSeed?.seed_string ?? previousSeed?.seedString ?? "").trim();
  if (currentSeedString && previousSeedString && currentSeedString !== previousSeedString) {
    diffs.push(`Seed string changed: ${previousSeedString} -> ${currentSeedString}`);
  }

  const currentTone = toneVectorFromSeed(currentSeed);
  const previousToneMap = new Map(
    toneVectorFromSeed(previousSeed).map((entry) => [entry.key, entry.value]),
  );
  for (const entry of currentTone) {
    const previousValue = previousToneMap.get(entry.key);
    if (previousValue == null) continue;
    const delta = Number((entry.value - previousValue).toFixed(3));
    if (Math.abs(delta) >= 0.02) {
      diffs.push(`Tone.${entry.key} shifted by ${delta > 0 ? "+" : ""}${delta.toFixed(3)}`);
    }
  }

  const currentTick = maybeNumber(currentState?.tick);
  const previousTick = maybeNumber(previousState?.tick);
  if (currentTick != null && previousTick != null && currentTick !== previousTick) {
    diffs.push(`World tick ${previousTick} -> ${currentTick}`);
  }

  const currentEscalation = maybeNumber(currentState?.villainEscalation ?? currentState?.villain_escalation);
  const previousEscalation = maybeNumber(previousState?.villainEscalation ?? previousState?.villain_escalation);
  if (currentEscalation != null && previousEscalation != null && currentEscalation !== previousEscalation) {
    diffs.push(`Villain escalation ${previousEscalation} -> ${currentEscalation}`);
  }

  const currentRumors = asStringArray(currentState?.activeRumors ?? currentState?.active_rumors);
  const previousRumors = asStringArray(previousState?.activeRumors ?? previousState?.active_rumors);
  if (currentRumors.length !== previousRumors.length) {
    diffs.push(`Active rumors ${previousRumors.length} -> ${currentRumors.length}`);
  }

  const currentCollapsed = asStringArray(currentState?.collapsedDungeons ?? currentState?.collapsed_dungeons);
  const previousCollapsed = asStringArray(previousState?.collapsedDungeons ?? previousState?.collapsed_dungeons);
  if (currentCollapsed.length !== previousCollapsed.length) {
    diffs.push(`Collapsed dungeons ${previousCollapsed.length} -> ${currentCollapsed.length}`);
  }

  return diffs.slice(0, 10);
}

function summarizeForgeContributions(forgeInput: Record<string, unknown>): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  const orderedKeys = [
    "tonePreset",
    "selectedPresets",
    "humorLevel",
    "lethality",
    "magicDensity",
    "techLevel",
    "creatureFocus",
    "factionComplexity",
    "worldSize",
    "startingRegionType",
    "villainArchetype",
    "corruptionLevel",
    "divineInterferenceLevel",
    "randomizationMode",
  ];

  for (const key of orderedKeys) {
    const value = forgeInput[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim().length === 0) continue;
    if (Array.isArray(value) && value.length === 0) continue;

    if (Array.isArray(value)) {
      entries.push({ key, value: value.map((entry) => String(entry)).join(", ") });
      continue;
    }

    if (typeof value === "object") {
      entries.push({ key, value: JSON.stringify(value) });
      continue;
    }

    entries.push({ key, value: String(value) });
  }

  return entries;
}

const SAMPLE_ATTACKER = {
  id: "sample-attacker",
  level: 15,
  statsBase: { str: 24, dex: 18, int: 16, vit: 14, wis: 12 },
  statsDerived: {
    hp: 420,
    mp: 160,
    atk: 84,
    def: 52,
    matk: 60,
    mdef: 40,
    acc: 94,
    eva: 28,
    crit: 0.21,
    critRes: 0.08,
    res: 0.15,
    speed: 18,
    healBonus: 0.08,
    barrier: 0,
  },
  resistances: {
    physical: 0.1,
    fire: 0.1,
    ice: 0.1,
    lightning: 0.1,
    poison: 0.1,
    bleed: 0.1,
    stun: 0.1,
    holy: 0.1,
    shadow: 0.1,
    arcane: 0.1,
    wind: 0.1,
    earth: 0.1,
    water: 0.1,
  },
};

const SAMPLE_DEFENDER = {
  id: "sample-defender",
  level: 15,
  statsBase: { str: 18, dex: 14, int: 14, vit: 22, wis: 16 },
  statsDerived: {
    hp: 460,
    mp: 140,
    atk: 66,
    def: 72,
    matk: 54,
    mdef: 60,
    acc: 88,
    eva: 24,
    crit: 0.12,
    critRes: 0.12,
    res: 0.18,
    speed: 15,
    healBonus: 0.06,
    barrier: 20,
  },
  resistances: {
    physical: 0.15,
    fire: 0.2,
    ice: 0.15,
    lightning: 0.1,
    poison: 0.2,
    bleed: 0.1,
    stun: 0.12,
    holy: 0.08,
    shadow: 0.08,
    arcane: 0.1,
    wind: 0.1,
    earth: 0.1,
    water: 0.1,
  },
};

export function BalancePanel() {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<XpPreset>("STANDARD");
  const [variancePct, setVariancePct] = useState(DEFAULT_RULE_TUNABLES.combat.variancePct);
  const [critMultiplier, setCritMultiplier] = useState(DEFAULT_RULE_TUNABLES.combat.critMultiplier);
  const [dotScale, setDotScale] = useState(DEFAULT_RULE_TUNABLES.statuses.defaultDotScale);
  const [hotScale, setHotScale] = useState(DEFAULT_RULE_TUNABLES.statuses.defaultHotScale);
  const [buyMultiplier, setBuyMultiplier] = useState(DEFAULT_RULE_TUNABLES.economy.buyBaseMultiplier);
  const [rareWeight, setRareWeight] = useState(DEFAULT_RULE_TUNABLES.loot.rarityWeights.rare);
  const [epicWeight, setEpicWeight] = useState(DEFAULT_RULE_TUNABLES.loot.rarityWeights.epic);
  const [legendaryWeight, setLegendaryWeight] = useState(DEFAULT_RULE_TUNABLES.loot.rarityWeights.legendary);

  const [latestSnapshot, setLatestSnapshot] = useState<MythicDebugSnapshot | null>(() => readLatestMythicDebugSnapshot());
  const [snapshotHistory, setSnapshotHistory] = useState<MythicDebugSnapshot[]>(() => readMythicDebugHistory());

  useEffect(() => {
    if (!import.meta.env.DEV) return () => undefined;
    setLatestSnapshot(readLatestMythicDebugSnapshot());
    setSnapshotHistory(readMythicDebugHistory());
    return subscribeMythicDebugSnapshots((snapshot) => {
      setLatestSnapshot(snapshot);
      setSnapshotHistory(readMythicDebugHistory());
    });
  }, []);

  const previousSnapshot = useMemo(() => {
    if (!latestSnapshot) return null;
    const sameCampaign = snapshotHistory
      .filter((entry) => entry.campaignId === latestSnapshot.campaignId && entry.capturedAt !== latestSnapshot.capturedAt)
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
    return sameCampaign.at(-1) ?? null;
  }, [latestSnapshot, snapshotHistory]);

  const snapshotContext = useMemo(
    () => asRecord(latestSnapshot?.context),
    [latestSnapshot],
  );

  const worldSeed = useMemo(() => worldSeedFromContext(snapshotContext), [snapshotContext]);
  const worldContext = useMemo(() => worldContextFromContext(snapshotContext), [snapshotContext]);
  const worldState = useMemo(() => worldStateFromContext(snapshotContext), [snapshotContext]);
  const dmProfile = useMemo(() => dmProfileFromContext(snapshotContext), [snapshotContext]);

  const presetTrace = useMemo(() => extractPresetTrace(snapshotContext), [snapshotContext]);
  const forgeInput = useMemo(() => extractForgeInput(snapshotContext), [snapshotContext]);
  const forgeContributions = useMemo(() => summarizeForgeContributions(forgeInput), [forgeInput]);
  const toneRows = useMemo(() => toneVectorFromSeed(worldSeed), [worldSeed]);
  const diffRows = useMemo(() => buildSnapshotDiffs(latestSnapshot, previousSnapshot), [latestSnapshot, previousSnapshot]);

  const timelineRows = useMemo(() => {
    const rows = asArray(worldState?.history)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        tick: maybeNumber(entry.tick) ?? 0,
        type: typeof entry.type === "string" ? entry.type : "event",
        summary: typeof entry.summary === "string" ? entry.summary : "-",
        impacts: asRecord(entry.impacts),
      }))
      .slice(-12)
      .reverse();
    return rows;
  }, [worldState]);

  const factionRows = useMemo(() => {
    const rows = asArray(worldState?.factionStates ?? worldState?.faction_states)
      .map((entry) => asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => ({
        factionId: String(entry.factionId ?? entry.faction_id ?? "-") || "-",
        powerLevel: maybeNumber(entry.powerLevel ?? entry.power_level) ?? 0,
        trustDelta: maybeNumber(entry.trustDelta ?? entry.trust_delta) ?? 0,
        lastActionTick: maybeNumber(entry.lastActionTick ?? entry.last_action_tick) ?? 0,
      }))
      .sort((left, right) => right.powerLevel - left.powerLevel)
      .slice(0, 12);
    return rows;
  }, [worldState]);

  const activeRumors = useMemo(
    () => asStringArray(worldState?.activeRumors ?? worldState?.active_rumors).slice(-8).reverse(),
    [worldState],
  );
  const collapsedDungeons = useMemo(
    () => asStringArray(worldState?.collapsedDungeons ?? worldState?.collapsed_dungeons).slice(-8).reverse(),
    [worldState],
  );

  const tunables = useMemo<RuleTunables>(() => buildTunables({
    combat: {
      ...DEFAULT_RULE_TUNABLES.combat,
      variancePct,
      critMultiplier,
    },
    statuses: {
      ...DEFAULT_RULE_TUNABLES.statuses,
      defaultDotScale: dotScale,
      defaultHotScale: hotScale,
    },
    economy: {
      ...DEFAULT_RULE_TUNABLES.economy,
      buyBaseMultiplier: buyMultiplier,
    },
    loot: {
      ...DEFAULT_RULE_TUNABLES.loot,
      rarityWeights: {
        ...DEFAULT_RULE_TUNABLES.loot.rarityWeights,
        rare: Math.max(0, Math.floor(rareWeight)),
        epic: Math.max(0, Math.floor(epicWeight)),
        legendary: Math.max(0, Math.floor(legendaryWeight)),
      },
    },
  }), [buyMultiplier, critMultiplier, dotScale, epicWeight, legendaryWeight, rareWeight, variancePct, hotScale]);

  const xpRows = useMemo(() => {
    const rows: Array<{ level: number; next: number; cumulative: number }> = [];
    for (let level = 1; level <= 12; level += 1) {
      rows.push({
        level,
        next: xpToNext(level, preset, tunables),
        cumulative: xpToReachLevel(level + 1, preset, tunables),
      });
    }
    return rows;
  }, [preset, tunables]);

  const rarityRows = useMemo(() => {
    const entries = Object.entries(tunables.loot.rarityWeights);
    const total = entries.reduce((sum, [, value]) => sum + Math.max(0, Number(value)), 0) || 1;
    return entries.map(([rarity, weight]) => ({
      rarity,
      weight: Number(weight),
      pct: ((Number(weight) / total) * 100),
    }));
  }, [tunables]);

  const priceRows = useMemo(() => {
    const context = {
      actorLevel: 20,
      act: 2,
      chapter: 1,
      biome: "town",
      faction: "artisans",
    };
    return (["common", "uncommon", "rare", "epic", "legendary", "mythic"] as const).map((rarity) => {
      const buy = computeBuyPrice({
        item: { rarity, levelReq: 20, valueBuy: 100 },
        context,
        tunables,
      });
      return {
        rarity,
        buy,
        sell: Math.floor(buy * tunables.economy.sellRate),
      };
    });
  }, [tunables]);

  const expectedDamagePhysical = useMemo(() => expectedDamage({
    attacker: SAMPLE_ATTACKER,
    target: SAMPLE_DEFENDER,
    skill: {
      id: "sample-strike",
      name: "Sample Strike",
      element: "physical",
      hitBonus: 5,
      critBonus: 0.05,
    },
    skillPower: 24,
    damageKind: "physical",
    tunables,
  }), [tunables]);

  const expectedDamageMagical = useMemo(() => expectedDamage({
    attacker: SAMPLE_ATTACKER,
    target: SAMPLE_DEFENDER,
    skill: {
      id: "sample-burst",
      name: "Sample Burst",
      element: "fire",
      hitBonus: 0,
      critBonus: 0.02,
    },
    skillPower: 30,
    damageKind: "magical",
    tunables,
  }), [tunables]);

  if (!import.meta.env.DEV) return null;

  return (
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 10000, maxWidth: 840, pointerEvents: "auto" }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{
          border: "1px solid rgba(242, 201, 76, 0.6)",
          borderRadius: 8,
          padding: "6px 10px",
          background: "rgba(28, 24, 18, 0.95)",
          color: "#f6e6a2",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        {open ? "Hide" : "Show"} Balance Panel ({tunables.ruleVersion})
      </button>

      {open ? (
        <div
          style={{
            marginTop: 8,
            border: "1px solid rgba(242, 201, 76, 0.45)",
            borderRadius: 10,
            background: "rgba(14, 14, 20, 0.96)",
            color: "#f7f1d3",
            padding: 12,
            maxHeight: "78vh",
            overflow: "auto",
            fontSize: 12,
          }}
        >
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label>
              XP preset
              <select
                value={preset}
                onChange={(event) => setPreset(event.target.value as XpPreset)}
                style={{ display: "block", width: "100%", marginTop: 4 }}
              >
                {XP_PRESET_ORDER.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </label>

            <label>
              Variance ({(variancePct * 100).toFixed(1)}%)
              <input type="range" min={0} max={0.25} step={0.01} value={variancePct} onChange={(event) => setVariancePct(clamp(num(event.target.value, variancePct), 0, 0.25))} />
            </label>

            <label>
              Crit multiplier ({critMultiplier.toFixed(2)}x)
              <input type="range" min={1.2} max={2.5} step={0.05} value={critMultiplier} onChange={(event) => setCritMultiplier(clamp(num(event.target.value, critMultiplier), 1.2, 2.5))} />
            </label>

            <label>
              DOT scale ({dotScale.toFixed(2)})
              <input type="range" min={0.05} max={1.2} step={0.01} value={dotScale} onChange={(event) => setDotScale(clamp(num(event.target.value, dotScale), 0.05, 1.2))} />
            </label>

            <label>
              HOT scale ({hotScale.toFixed(2)})
              <input type="range" min={0.05} max={1.2} step={0.01} value={hotScale} onChange={(event) => setHotScale(clamp(num(event.target.value, hotScale), 0.05, 1.2))} />
            </label>

            <label>
              Shop price base ({buyMultiplier.toFixed(2)}x)
              <input type="range" min={0.4} max={2.4} step={0.05} value={buyMultiplier} onChange={(event) => setBuyMultiplier(clamp(num(event.target.value, buyMultiplier), 0.4, 2.4))} />
            </label>

            <label>
              Rare weight ({rareWeight})
              <input type="range" min={1} max={30} step={1} value={rareWeight} onChange={(event) => setRareWeight(Math.floor(clamp(num(event.target.value, rareWeight), 1, 30)))} />
            </label>

            <label>
              Epic weight ({epicWeight})
              <input type="range" min={1} max={20} step={1} value={epicWeight} onChange={(event) => setEpicWeight(Math.floor(clamp(num(event.target.value, epicWeight), 1, 20)))} />
            </label>

            <label>
              Legendary weight ({legendaryWeight})
              <input type="range" min={0} max={12} step={1} value={legendaryWeight} onChange={(event) => setLegendaryWeight(Math.floor(clamp(num(event.target.value, legendaryWeight), 0, 12)))} />
            </label>
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>XP Table (Lv 1-12)</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Lv</th>
                    <th align="right">XP to next</th>
                    <th align="right">XP total</th>
                  </tr>
                </thead>
                <tbody>
                  {xpRows.map((row) => (
                    <tr key={`xp-${row.level}`}>
                      <td>{row.level}</td>
                      <td align="right">{row.next}</td>
                      <td align="right">{row.cumulative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Rarity Weights</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Rarity</th>
                    <th align="right">Weight</th>
                    <th align="right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {rarityRows.map((row) => (
                    <tr key={row.rarity}>
                      <td>{row.rarity}</td>
                      <td align="right">{row.weight}</td>
                      <td align="right">{row.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Shop Price Samples</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th align="left">Rarity</th>
                    <th align="right">Buy</th>
                    <th align="right">Sell</th>
                  </tr>
                </thead>
                <tbody>
                  {priceRows.map((row) => (
                    <tr key={`price-${row.rarity}`}>
                      <td>{row.rarity}</td>
                      <td align="right">{row.buy}</td>
                      <td align="right">{row.sell}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Expected Damage Preview</div>
              <div>Physical skill expected: {expectedDamagePhysical.toFixed(1)}</div>
              <div>Magical skill expected: {expectedDamageMagical.toFixed(1)}</div>
              <div style={{ marginTop: 6, opacity: 0.8 }}>
                Uses current variance/crit settings and sample Lv15 attacker vs defender.
              </div>
            </div>
          </div>

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(242, 201, 76, 0.2)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Forge Inspector</div>
            {latestSnapshot ? (
              <>
                <div style={{ marginBottom: 6, opacity: 0.9 }}>
                  Captured: {latestSnapshot.capturedAt} | Campaign: {latestSnapshot.campaignId}
                </div>
                <div style={{ marginBottom: 6, opacity: 0.9 }}>
                  World: {resolveWorldName(worldContext)} | Moral climate: {resolveMoralClimate(worldContext)}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8 }}>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Seed string</td>
                      <td>{String(worldSeed?.seed_string ?? worldSeed?.seedString ?? "-")}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Seed number</td>
                      <td>{String(worldSeed?.seed_number ?? worldSeed?.seedNumber ?? worldSeed?.seed ?? "-")}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Theme tags</td>
                      <td>{asStringArray(worldSeed?.theme_tags ?? worldSeed?.themeTags).join(", ") || "-"}</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Preset trace</td>
                      <td>{presetTrace.join(" -> ") || "-"}</td>
                    </tr>
                  </tbody>
                </table>

                {toneRows.length > 0 ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>Tone vector</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th align="left">Axis</th>
                          <th align="right">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {toneRows.map((row) => (
                          <tr key={row.key}>
                            <td>{row.key}</td>
                            <td align="right">{row.value.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {forgeContributions.length > 0 ? (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, marginBottom: 3 }}>Forge contributions</div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th align="left">Field</th>
                          <th align="left">Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forgeContributions.map((entry) => (
                          <tr key={entry.key}>
                            <td style={{ verticalAlign: "top" }}>{entry.key}</td>
                            <td>{entry.value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                <div>
                  <div style={{ fontWeight: 600, marginBottom: 3 }}>Diff vs previous snapshot</div>
                  {previousSnapshot ? (
                    diffRows.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {diffRows.map((entry) => (
                          <li key={entry}>{entry}</li>
                        ))}
                      </ul>
                    ) : (
                      <div>No material world-state diff detected.</div>
                    )
                  ) : (
                    <div>No previous snapshot for this campaign yet.</div>
                  )}
                </div>
              </>
            ) : (
              <div>No DM debug snapshot yet. Trigger a DM context fetch to populate inspector data.</div>
            )}
          </div>

          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid rgba(242, 201, 76, 0.2)" }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>World-State Timeline</div>

            {worldState ? (
              <>
                <div style={{ marginBottom: 8 }}>
                  Tick: {String(worldState.tick ?? "-")} | Villain escalation: {String(worldState.villainEscalation ?? worldState.villain_escalation ?? "-")}
                </div>

                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>History (latest 12)</div>
                    {timelineRows.length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th align="right">Tick</th>
                            <th align="left">Type</th>
                            <th align="left">Summary</th>
                          </tr>
                        </thead>
                        <tbody>
                          {timelineRows.map((row, index) => (
                            <tr key={`${row.tick}-${index}-${row.type}`}>
                              <td align="right">{row.tick}</td>
                              <td>{row.type}</td>
                              <td>
                                {row.summary}
                                {row.impacts ? (
                                  <div style={{ opacity: 0.8 }}>
                                    {Object.entries(row.impacts)
                                      .map(([key, value]) => `${key}:${String(value)}`)
                                      .join(" | ")}
                                  </div>
                                ) : null}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div>No timeline history found.</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Faction power/trust</div>
                    {factionRows.length > 0 ? (
                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                          <tr>
                            <th align="left">Faction</th>
                            <th align="right">Power</th>
                            <th align="right">Trust</th>
                            <th align="right">Last tick</th>
                          </tr>
                        </thead>
                        <tbody>
                          {factionRows.map((row) => (
                            <tr key={row.factionId}>
                              <td>{row.factionId}</td>
                              <td align="right">{Math.floor(row.powerLevel)}</td>
                              <td align="right">{Math.floor(row.trustDelta)}</td>
                              <td align="right">{Math.floor(row.lastActionTick)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div>No faction state data.</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Active rumors</div>
                    {activeRumors.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {activeRumors.map((entry) => <li key={entry}>{entry}</li>)}
                      </ul>
                    ) : (
                      <div>No active rumors.</div>
                    )}
                  </div>

                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>Collapsed dungeons</div>
                    {collapsedDungeons.length > 0 ? (
                      <ul style={{ margin: 0, paddingLeft: 16 }}>
                        {collapsedDungeons.map((entry) => <li key={entry}>{entry}</li>)}
                      </ul>
                    ) : (
                      <div>No collapsed dungeons recorded.</div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div>No world state payload in latest snapshot.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default BalancePanel;
