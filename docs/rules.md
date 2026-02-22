# RPG Rules + Progression System

RuleVersion: `rpg-rules.v1.0.0`

This document describes the canonical modular rules implemented in:
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/schema.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/constants.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/leveling.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/stats.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/combatMath.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/skills.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/status.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/loot.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/equipment.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/economy.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/src/rules/qol.ts`

## 1) Canonical Schema

Core entities:
- Actor/Character: level, XP, base stats (`STR/DEX/INT/VIT/WIS`), derived stats (`HP/MP/ATK/DEF/MATK/MDEF/ACC/EVA/CRIT/CRIT_RES/RES/SPEED`), points, equipment, resistances, statuses, coins.
- Skill: rank, max rank, MP cost fields, power fields, hit/crit bonuses, tags, targeting, optional status payload.
- Status effect: category, stacking mode (`none|refresh|stack|intensity`), duration, tick config, stat modifiers, immunity and dispel metadata.
- Item: slot, rarity, level requirement, flat/percent stats, affixes, class/set metadata, buy/sell values.

Validation is centralized with Zod schemas in `schema.ts`.

## 2) Leveling + XP Curves

Configured in `leveling.ts` with presets:
- `FAST`
- `STANDARD`
- `GRINDY`

Core formulas:
- `xpToNext(L) = floor((base * L^exponent + linear * L) * multiplier)`
- `xpToReachLevel(L) = Σ xpToNext(i)` for `i = 1..L-1`

Defaults:
- Level cap: 60
- Stat points per level: 3
- Skill points per level: 1
- Milestone bonuses at levels 5/10/20/30/40/50

## 3) Base + Derived Stats

Implemented in `stats.ts`.

Base growth:
- `base(level) = base(level1) + growthPerLevel * (level - 1)`

Default derived formulas:
- `HP = VIT*12 + level*8 + gearHP`
- `MP = INT*8 + level*4 + gearMP`
- `ATK = STR*2 + weaponATK + level`
- `MATK = INT*2 + staffMATK + level`
- `DEF = VIT*1.5 + armorDEF`
- `MDEF = WIS*1.5 + armorMDEF`
- `ACC = 75 + DEX*1.2 + gearACC`
- `EVA = 5 + DEX*0.8 + gearEVA`
- `CRIT% = clamp(DEX*0.15 + gearCRIT, 0, 60)`
- `SPEED = 10 + DEX*0.2 + gearSPD`

Defense/MDEF/RES use soft-cap diminishing returns to avoid runaway scaling.

## 4) Hit/Crit/Damage

Implemented in `combatMath.ts`.

Hit chance:
- `hitChance = clamp((ACC_attacker - EVA_target + hitBonus) / 100, minHit, maxHit)`
- Defaults: `minHit=0.05`, `maxHit=0.95`

Crit chance:
- `critChance = clamp(CRIT_attacker + critBonus - CritRes_target, 0, 0.60)`
- Crit multiplier default: `1.5`

Damage core:
- Physical raw: `(ATK + skillPower) * (1 + STR*physicalStrScale)`
- Magical raw: `(MATK + skillPower) * (1 + INT*magicalIntScale)`
- Mitigation: `raw * 100/(100 + DEF or MDEF)`
- Variance: uniform in `[-variancePct, +variancePct]` (default `±10%`), deterministic by seed
- Element/resistance: `final = mitigated * (1 - targetRes[element])`

Barrier handling:
- Barrier absorbs first.
- Remaining spillover can hit HP (configurable).
- Barrier break flag emitted for VFX/event routing.

## 5) Skills

Implemented in `skills.ts`.

MP cost:
- `mpCost = ceil(mpCostBase + rank*mpCostScale + level*mpLevelScale)`
- Clamped to tunable max (default 99)

Power scaling:
- `skillPower = basePower + rank*powerScale + floor(level*levelScale)`

Supports tags:
- `projectile`, `melee`, `aoe`, `dot`, `heal`, `shield`, `summon`

Custom formula overrides:
- Registerable by `formulaOverrideId` with deterministic execution path.

## 6) Status Engine

Implemented in `status.ts`.

Stacking modes:
- `none`: ignore reapply
- `refresh`: refresh timer and payload
- `stack`: increase stack count to cap
- `intensity`: increase potency/intensity to cap

Tick formulas:
- DOT: `ceil((source.MATK*dotScale + baseTick + rank*rankTick) * (1 - targetRes[element]))`
- HOT: `ceil((source.WIS*hotScale + baseTick) * (1 + healBonus))`

Also includes:
- Deterministic apply/unapply ordering
- Immunity checks from active status metadata
- Cleanse/dispel helpers with category/id/tag filters

## 7) Loot Generation

Implemented in `loot.ts`.

Features:
- Rarity roll with tunable weights (`common -> mythic`)
- Level + rarity scaling budgets
- Prefix/suffix affix pool, including:
  - `of Power`, `of Fortitude`, `of Focus`, `of Swiftness`, `of Precision`, `of Evasion`, elemental guards
- Smart drop bias:
  - preferred usable slots
  - under-geared slot weighting
  - duplicate avoidance in same chest
- Deterministic seeded naming with whimsical tone

Example outputs:
- `Oak Wand of Sparkles`
- `Glimmering Steel Sword of Bonking`

Gold drops are generated from level + rarity outcome and deterministic variance.

## 8) Equipment + Comparison

Implemented in `equipment.ts`.

Capabilities:
- Slot restrictions
- Level/class equip validation
- Equipment stat aggregation
- Optional 2-piece/3-piece set bonus hooks
- `compareItem(current, candidate)` returns weighted diff summary and upgrade score

## 9) Economy

Implemented in `economy.ts`.

Pricing:
- `buy = base * rarityMult * levelMult * inflation`
- `sell = floor(buy * sellRate)` (default `0.25`)

Shop generation:
- Biome-based slot bias
- Faction rarity bias
- Deterministic inventory build
- Optional inflation by act/chapter

## 10) Character Sheet Contract + QoL

Implemented in `qol.ts`.

`buildCharacterSheetView(actor)` returns:
- Identity
- Level/xp progress
- Base + derived stats
- Resistances
- Equipped items + icons
- Skill list with rank/MP/power summary
- Active statuses
- Tooltip dictionary

Additional QoL helpers:
- Inventory filtering (`slot`, `rarity`, `stat`, favorites/locks)
- Auto-sort
- Favorite/lock toggles
- Auto-equip suggestions
- Quick compare on hover
- Loot pickup summary blocks
- Combat log condensation for repeated ticks

## 11) Integration Notes

Wired integration points:
- Character sheet adapter now builds canonical sheet data from rules and surfaces `ruleVersion`.
- Dev-only balance panel is mounted at:
  - `/Users/dev/dev-setup/repos/saga-spark-web/src/debug/BalancePanel.tsx`
- Combat + DM context now include `rule_version` metadata for tracing.
- Frontend diagnostics surface rule-version values from client/combat/DM context.

## 12) Simulation Tests

Simulation tests live at:
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/sim/balance.sim.test.ts`
- `/Users/dev/dev-setup/repos/saga-spark-web/tests/sim/simulateFight.ts`

Covered sanity checks:
- Hit chance clamp range
- Equal-level TTK target band
- Low-rank DOT vs direct damage sanity
- Healing pace vs incoming damage
- Loot distribution vs configured rarity weights
- Item stat budget growth vs level

