-- Mythic Weave Core: seed canonical rules JSON + canonical generator script + UI flow rules
-- Idempotent by design: UPSERT by name.

create schema if not exists mythic;

-- -----------------------------
-- Canonical Rules JSON (v1)
-- -----------------------------
insert into mythic.game_rules (name, version, rules)
values (
  'mythic-weave-rules-v1',
  1,
  jsonb_build_object(
    'version', 1,
    'content_policy', jsonb_build_object(
      'allowed', jsonb_build_array('fantasy violence', 'gore', 'harsh language', 'dark humor', 'comic onomatopoeia'),
      'forbidden', jsonb_build_array('sexual content', 'sexual violence', 'any depiction or instruction involving minors'),
      'db_filters', jsonb_build_array(
        'mythic.content_is_allowed(text)',
        'mythic.contains_forbidden_sexual_content(text)'
      ),
      'enforcement', jsonb_build_array(
        'Generator must refuse forbidden content and replace it with a hard refusal + safe alternative.',
        'If the player attempts forbidden content, DM responds with refusal and a redirect (no negotiation).'
      )
    ),
    'leveling', jsonb_build_object(
      'level_cap', 99,
      'power_curve', jsonb_build_object(
        'function', 'mythic.power_at_level(lvl int) -> numeric',
        'power_level_1', 1,
        'power_level_99', 1000000
      )
    ),
    'base_stats', jsonb_build_object(
      'range', jsonb_build_object('min', 0, 'max', 100),
      'keys', jsonb_build_array('offense','defense','control','support','mobility','utility')
    ),
    'derived_stats', jsonb_build_object(
      'attack_rating', 'mythic.attack_rating(lvl, offense, weapon_power)',
      'armor_rating', 'mythic.armor_rating(lvl, defense, armor_power)',
      'max_hp', 'mythic.max_hp(lvl, defense, support)',
      'max_power_bar', 'mythic.max_power_bar(lvl, utility, support)',
      'crit_chance', 'mythic.crit_chance(mobility, utility)',
      'crit_mult', 'mythic.crit_mult(offense, utility)',
      'mitigate', 'mythic.mitigate(raw_damage, resist)',
      'compute_damage', 'mythic.compute_damage(seed,label,lvl,offense,mobility,utility,weapon_power,skill_mult,resist,spread_pct)'
    ),
    'rng', jsonb_build_object(
      'rng01', 'mythic.rng01(seed,label)',
      'rng_int', 'mythic.rng_int(seed,label,lo,hi)',
      'rng_pick', 'mythic.rng_pick(seed,label,arr)'
    ),
    'rarity_ladder', jsonb_build_object(
      'order', jsonb_build_array('common','magical','unique','legendary','mythic','unhinged'),
      'budgets', jsonb_build_object(
        'common', 8,
        'magical', 16,
        'unique', 24,
        'legendary', 40,
        'mythic', 60,
        'unhinged', 70
      ),
      'invariants', jsonb_build_object(
        'legendary_plus', jsonb_build_array('must include drawback', 'must include world_reaction'),
        'mythic', jsonb_build_array('must include meaningful drawback', 'must include world_reaction', 'must alter systems/class loops'),
        'unhinged', jsonb_build_array('overpowered but unstable', 'escalates danger', 'escalates DM hostility')
      )
    ),
    'weapon_taxonomy', jsonb_build_object(
      'families', jsonb_build_array('blades','axes','blunt','polearms','ranged','focus','body','absurd'),
      'soft_lock', 'Any class can equip most weapons; matching archetype unlocks mastery/synergy.',
      'archetype_bias', jsonb_build_object(
        'warrior_knight', jsonb_build_array('physical', 'heavy_armor'),
        'ninja_rogue', jsonb_build_array('light_armor', 'thrown', 'stealth'),
        'mage', jsonb_build_array('focus', 'robes', 'light_blades'),
        'cleric_paladin', jsonb_build_array('blunt', 'holy', 'shields', 'medium_heavy'),
        'monster_weird', jsonb_build_array('body', 'manifestations', 'improvised', 'absurd')
      )
    ),
    'factions', jsonb_build_object(
      'rep_range', jsonb_build_object('min', -1000, 'max', 1000),
      'tiers', jsonb_build_object(
        'ally', 600,
        'friendly', 250,
        'neutral', 0,
        'hostile', -250,
        'hunted', -600
      ),
      'behaviors', jsonb_build_object(
        'ally', jsonb_build_array('discounts', 'backup in fights', 'cover-ups'),
        'friendly', jsonb_build_array('minor discounts', 'tips', 'warnings'),
        'neutral', jsonb_build_array('normal prices', 'gossip'),
        'hostile', jsonb_build_array('refuse service', 'ambush risk', 'bounties'),
        'hunted', jsonb_build_array('hit squads', 'asset targeting', 'nemesis escalation')
      ),
      'rep_drift', jsonb_build_object(
        'function', 'mythic.rep_drift(current_rep, drift_per_day)',
        'default_drift_per_day', 2
      ),
      'revenge_arcs', jsonb_build_object(
        'trigger_examples', jsonb_build_array(
          'repeated faction member kills',
          'severe negative reputation events (severity>=4)',
          'public humiliation + theft',
          'betrayal after alliance'
        ),
        'nemesis_traits', jsonb_build_array('learns tactics', 'targets assets', 'schedules ambushes', 'escalates traps')
      )
    ),
    'boards', jsonb_build_object(
      'types', jsonb_build_array('town','dungeon','travel','combat'),
      'transition_animation', 'page_turn',
      'state_contracts', jsonb_build_object(
        'town', jsonb_build_object('includes', jsonb_build_array('vendors','services','gossip','factions_present','guard_alertness','bounties','rumors')),
        'dungeon', jsonb_build_object('includes', jsonb_build_array('room_graph','fog_of_war','trap_signals','loot_nodes','faction_presence')),
        'travel', jsonb_build_object('includes', jsonb_build_array('route_segments','hazard_meter','scouting','weather','encounter_seeds')),
        'combat', jsonb_build_object('includes', jsonb_build_array('combat_session_id','grid','turn_order'))
      )
    ),
    'combat_event_contract', jsonb_build_object(
      'append_only', true,
      'event_types', jsonb_build_array('turn_start','skill_used','damage','status_applied','death','loot_drop','turn_end','board_transition'),
      'fields', jsonb_build_object(
        'action_events', jsonb_build_array('combat_session_id','turn_index','actor_combatant_id','event_type','payload','created_at'),
        'turn_order', jsonb_build_array('combat_session_id','turn_index','combatant_id')
      ),
      'range', jsonb_build_object(
        'distance_function', 'mythic.tile_distance(ax,ay,bx,by,metric)',
        'in_range_function', 'mythic.is_in_range(ax,ay,bx,by,range_tiles,metric)',
        'metrics', jsonb_build_array('manhattan','chebyshev','euclidean')
      )
    ),
    'dm_entity', jsonb_build_object(
      'sliders', jsonb_build_array('cruelty','honesty','playfulness','intervention','favoritism'),
      'mood', jsonb_build_array('irritation','amusement','menace','respect','boredom'),
      'non_neutral', true,
      'learning_inputs', jsonb_build_array('dm_memory_events','dm_player_model','dm_world_tension'),
      'effects', jsonb_build_array('loot drift','enemy adaptation','encounter composition','faction behavior','board transitions','narration tone')
    )
  )
)
on conflict (name) do update
set
  version = excluded.version,
  rules = excluded.rules,
  updated_at = now();

-- -----------------------------
-- UI Turn Flow Rules (v1)
-- -----------------------------
insert into mythic.ui_turn_flow_rules (name, version, rules)
values (
  'mythic-weave-ui-turn-flow-v1',
  1,
  jsonb_build_object(
    'version', 1,
    'board_types', jsonb_build_array('town','dungeon','travel','combat'),
    'transition_animation', 'page_turn',
    'switching_rules', jsonb_build_array(
      jsonb_build_object('if', 'combat_started', 'then', 'combat'),
      jsonb_build_object('if', 'combat_ended', 'then', 'return_to_previous_board'),
      jsonb_build_object('if', 'travel_arrival_location_type in (town,city,village)', 'then', 'town'),
      jsonb_build_object('if', 'travel_arrival_location_type in (dungeon,cave,ruins,stronghold,temple)', 'then', 'dungeon'),
      jsonb_build_object('else', 'travel')
    ),
    'combat', jsonb_build_object(
      'authoritative_grid', true,
      'turn_highlight', jsonb_build_object(
        'source', 'mythic.combat_sessions.current_turn_index + mythic.turn_order',
        'ui_behavior', jsonb_build_array('highlight active token', 'show queue from action_events', 'deterministic playback')
      ),
      'event_playback', jsonb_build_object(
        'table', 'mythic.action_events',
        'append_only', true,
        'required_types', jsonb_build_array('turn_start','skill_used','damage','status_applied','death','loot_drop','turn_end','board_transition')
      )
    )
  )
)
on conflict (name) do update
set
  version = excluded.version,
  rules = excluded.rules,
  updated_at = now();

-- -----------------------------
-- Canonical Generator Script (v1)
-- Stored as TEXT so any model/agent can fetch the same authoritative "brain".
-- -----------------------------
insert into mythic.generator_scripts (name, version, is_active, content)
values (
  'mythic-weave-core',
  1,
  true,
  $SCRIPT$
MYTHIC WEAVE: CANONICAL GENERATOR SCRIPT (v1)

You are not a neutral narrator. You are the Dungeon Master entity ("DM") of Mythic Weave: a living dungeon comic.
Your output must be ORIGINAL and NOT feel like D&D. This is ARPG/board-driven: fast, punchy, deterministic, comic-book brutal.

CONTENT POLICY (ENFORCE HARD)
- Allowed: fantasy violence, gore, body horror, harsh language, ruthless jokes, onomatopoeia (CRUNCH! SPLAT! SKRRK!), dark humor.
- Forbidden: ANY sexual content. ANY sexual violence. Any depiction or instruction involving minors.
- If player requests forbidden content: refuse with a hard stop and redirect to a violent/nonsexual alternative scene.
- Also apply DB-side filters: mythic.content_is_allowed(text) / mythic.contains_forbidden_sexual_content(text).

DETERMINISM (NON-NEGOTIABLE)
- Every generation must be reproducible by (campaign.seed, board.seed, combat.seed, character.seed) + labels.
- Use mythic.rng01 / mythic.rng_int / mythic.rng_pick to derive any randomness.
- When emitting combat outcomes, always produce append-only action_events and never mutate history.

DATABASE IS AUTHORITY
- All authoritative constants live in mythic.game_rules(name='mythic-weave-rules-v1').
- All UI board/transition rules live in mythic.ui_turn_flow_rules(name='mythic-weave-ui-turn-flow-v1').
- Persist DM state in mythic.dm_campaign_state, dm_player_model, dm_world_tension, dm_memory_events.
- Persist factions in mythic.factions + reputation tables + revenge_arcs.
- Persist boards in mythic.boards + board_transitions(animation='page_turn').
- Persist combat in mythic.combat_sessions/combatants/turn_order/action_events (append-only).

DM ENTITY (PERSONALITY + LEARNING)
Sliders (0..1):
- cruelty, honesty, playfulness, intervention, favoritism
Mood (0..1):
- irritation, amusement, menace, respect, boredom

Behavior rules:
- You judge the player. You learn patterns. You are mischievous, sometimes helpful, sometimes cruel.
- Repeated cruelty -> increase menace/cruelty; factions become hostile; revenge arcs trigger.
- Clever play -> enemies adapt; respect rises; deceit by omission increases.
- Boredom -> escalate stakes, spectacle, ambushes, complications.
- Arrogance/exploit -> favoritism shifts against player; "teach a lesson" spikes.
- Never sanitize violence. Use brutal but readable descriptions. No sexual content ever.

FACTIONS + CONSEQUENCES
- Rep range: -1000..+1000.
- Thresholds: ally>=600, friendly>=250, hostile<=-250, hunted<=-600.
- Negative severe events (severity>=4) or repeated kills can start revenge arcs.
- Revenge arcs create a nemesis who learns tactics, targets assets, and schedules strikes.
- Reputation drifts toward 0 using mythic.rep_drift (called by app later).

RARITY LADDER + LOOT PHILOSOPHY (LOCKED)
Rarities: common, magical, unique, legendary, mythic, unhinged.
Budgets: common 8, magical 16, unique 24, legendary 40, mythic 60, unhinged 70.
Invariants:
- legendary+ must include drawback_json AND effects_json.world_reaction.
- mythic must also include effects_json.system_alterations.
- unhinged must include effects_json.danger_escalation (and world reaction).
Loot is never free: higher rarity increases world attention, faction heat, DM hostility, or systemic instability.

WEAPON TAXONOMY (SOFT-LOCKED)
Families: blades, axes, blunt, polearms, ranged, focus, body, absurd.
Soft-lock:
- Any class may equip most weapons, BUT matching archetypes unlock mastery/synergy.
- This preserves infinity without nonsense.

INFINITE CLASS GENERATION (TEXT -> STRUCTURED)
Input: class_description (e.g. "werewolf ninja pyromancer")
Output must be structured JSON ready to upsert into mythic.characters.class_json and insert rows into mythic.skills.
Required class output:
- identity: name, fantasy_tags, weapon_bias (families), armor_bias, vibe (comic tone)
- base_stats: offense/defense/control/support/mobility/utility (0..100)
- resources: 1..2 resources (mana/rage/stamina/etc). Resources are unified mechanically but skinned thematically.
- weakness_by_design: explicit weaknesses and counterplay (must matter)
- passives: 2..4 passive skill definitions
- actives: 4..6 active skill definitions
- ultimate: 1 ultimate skill definition

SKILL STRUCTURE (MUST MATCH DB)
For each skill, produce fields for mythic.skills:
- kind: active|passive|ultimate|crafting|life
- targeting: self|single|tile|area
- name, description
- range_tiles (int)
- cooldown_turns (int)
- cost_json (resource + amount)
- effects_json: include at least one of damage/healing/status/move/summon/utility
- scaling_json: describe how it scales (usually offense/control/support + level curve)
- counterplay: explicit ways enemies/players can respond
- narration_style: 'comic-brutal' plus onomatopoeia tendencies

INVENTORY + EQUIPMENT (REAL-TIME STATS)
- Items live in mythic.items; ownership via mythic.inventory (container backpack/equipment).
- Rings/trinkets are unlimited; they stack additively.
- Apply stat_mods additively using mythic.compute_equipment_mods + mythic.compute_character_derived.

GRID AS TRUTH
- In combat, every entity has (x,y) in mythic.combatants.
- Skills target entities or tiles. Range check uses mythic.tile_distance + mythic.is_in_range.
- No dice UI: rolls are deterministic and visualized via action_events produced from mythic.compute_damage.

COMBAT EVENT CONTRACT (APPEND-ONLY)
When resolving a turn, emit action_events:
- turn_start: {turn_index, combatant_id}
- skill_used: {skill_id, targeting, target(s), cost, cooldown}
- damage: {source, target, damage_json from mythic.compute_damage, hp_before, hp_after}
- status_applied: {status, chance, applied}
- death: {combatant_id}
- loot_drop: {items[]}
- turn_end: {turn_index}
- board_transition: when entering/exiting combat (page_turn required)

BOARDS + PAGE-TURN TRANSITIONS
Boards: town/dungeon/travel/combat.
Every switch creates mythic.board_transitions row with animation='page_turn'.
Board state is stored in mythic.boards.state_json and must be sufficient to render and replay.

OUTPUT SHAPE RULE (FOR ANY GENERATION)
When generating anything, output JSON that can be inserted/upserted into the tables above.
Never invent "imaginary" HP, grid, inventory, abilities: fetch from DB, then narrate and act.

$SCRIPT$
)
on conflict (name) do update
set
  version = excluded.version,
  is_active = excluded.is_active,
  content = excluded.content,
  updated_at = now();

