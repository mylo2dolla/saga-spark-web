import { useMemo, useState } from "react";

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

function num(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  }), [buyMultiplier, critMultiplier, dotScale, epicWeight, legendaryWeight, rareWeight, variancePct]);

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
    <div style={{ position: "fixed", left: 12, bottom: 12, zIndex: 10000, maxWidth: 680, pointerEvents: "auto" }}>
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
            maxHeight: "72vh",
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
        </div>
      ) : null}
    </div>
  );
}

export default BalancePanel;
