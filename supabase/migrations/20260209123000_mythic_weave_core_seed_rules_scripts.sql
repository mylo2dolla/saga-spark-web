-- Mythic Weave Core (sync): seed canonical rules + UI turn flow + generator script
-- Reconciles local migration history with remote.
-- Idempotent by UPSERT on (name).

create schema if not exists mythic;

-- Canonical Rules JSON (v1 name, latest content)
-- Note: version is monotonic; do not decrease it.
insert into mythic.game_rules (name, version, rules)
values (
  'mythic-weave-rules-v1',
  2,
  '{
    "version": 2,
    "content_policy": {
      "allowed": ["fantasy violence", "gore", "harsh language", "dark humor", "comic onomatopoeia"],
      "forbidden": ["sexual content", "sexual violence", "any depiction or instruction involving minors"],
      "hard_refusal_style": "short, final, mocking-but-not-sexual, immediate redirect to a violent/nonsexual alternative",
      "db_filters": ["mythic.content_is_allowed(text)", "mythic.contains_forbidden_sexual_content(text)"]
    },
    "leveling": {
      "level_cap": 99,
      "power_curve": {"function": "mythic.power_at_level(lvl int)", "power_level_1": 1, "power_level_99": 1000000}
    },
    "base_stats": {
      "keys": ["offense","defense","control","support","mobility","utility"],
      "range": {"min": 0, "max": 100}
    },
    "roles": {
      "definitions": {
        "tank": {"primary": ["defense","support"], "secondary": ["control"], "fails_if": ["no survivability loop"]},
        "dps": {"primary": ["offense","mobility"], "secondary": ["utility"], "fails_if": ["no counterplay/weakness"]},
        "support": {"primary": ["support","utility"], "secondary": ["control"], "fails_if": ["no team-facing impact"]},
        "controller": {"primary": ["control","utility"], "secondary": ["support"], "fails_if": ["no resist/counterplay hooks"]},
        "skirmisher": {"primary": ["mobility","offense"], "secondary": ["utility"], "fails_if": ["no positional rule"]},
        "hybrid": {"primary": ["mixed"], "secondary": ["mixed"], "fails_if": ["kit lacks identity"]}
      }
    },
    "derived_stats": {
      "attack_rating": "mythic.attack_rating(lvl, offense, weapon_power)",
      "armor_rating": "mythic.armor_rating(lvl, defense, armor_power)",
      "max_hp": "mythic.max_hp(lvl, defense, support)",
      "max_power_bar": "mythic.max_power_bar(lvl, utility, support)",
      "crit_chance": "mythic.crit_chance(mobility, utility)",
      "crit_mult": "mythic.crit_mult(offense, utility)",
      "mitigate": "mythic.mitigate(raw_damage, resist)",
      "compute_damage": "mythic.compute_damage(seed,label,lvl,offense,mobility,utility,weapon_power,skill_mult,resist,spread_pct)"
    },
    "rng": {
      "rng01": "mythic.rng01(seed,label)",
      "rng_int": "mythic.rng_int(seed,label,lo,hi)",
      "rng_pick": "mythic.rng_pick(seed,label,arr)",
      "label_conventions": {
        "global": ["component:purpose", "component:purpose:subpurpose"],
        "combat": ["turn:{turn_index}", "actor:{combatant_id}", "skill:{skill_id}", "target:{combatant_id_or_tile}"],
        "loot": ["loot:{rarity}:{slot}:{weapon_family}", "affix:{i}", "drawback:{i}"],
        "world": ["board:{board_type}", "scene:{scene_id}", "faction:{faction_id}"]
      }
    },
    "rarity_ladder": {
      "order": ["common","magical","unique","legendary","mythic","unhinged"],
      "budgets": {"common":8,"magical":16,"unique":24,"legendary":40,"mythic":60,"unhinged":70},
      "invariants": {
        "legendary_plus": ["must include drawback_json", "must include effects_json.world_reaction"],
        "mythic": ["must include meaningful drawback_json", "must include effects_json.world_reaction", "must include effects_json.system_alterations"],
        "unhinged": ["must include effects_json.world_reaction", "must include effects_json.danger_escalation", "must escalate DM hostility"]
      },
      "loot_drift": {
        "principle": "better loot increases world attention and encounter pressure",
        "inputs": ["dm_world_tension.tension", "dm_campaign_state.menace", "player cruelty/greed patterns"],
        "outputs": ["rarity weights", "drawback severity", "faction response intensity"]
      }
    },
    "weapon_taxonomy": {
      "families": ["blades","axes","blunt","polearms","ranged","focus","body","absurd"],
      "soft_lock": "Any class may equip most weapons, but matching archetype unlocks mastery/synergy.",
      "archetype_bias": {
        "warrior_knight": ["physical","heavy_armor"],
        "ninja_rogue": ["light_armor","thrown","stealth"],
        "mage": ["focus","robes","light_blades"],
        "cleric_paladin": ["blunt","holy","shields","medium_heavy"],
        "monster_weird": ["body","manifestations","improvised","absurd"]
      }
    },
    "status_effects": {
      "examples": [
        {"id":"bleed","stacking":"intensity","max_stacks":10,"tags":["physical","dot"],"counterplay":["bandage","armor","cleanse"]},
        {"id":"burn","stacking":"duration","max_stacks":5,"tags":["fire","dot"],"counterplay":["douse","resist","roll"]},
        {"id":"stun","stacking":"none","tags":["control"],"counterplay":["resolve","guard","immunity_window"]},
        {"id":"root","stacking":"duration","tags":["control"],"counterplay":["dash","cleanse"]},
        {"id":"fear","stacking":"duration","tags":["mind"],"counterplay":["bravery buff","line of sight break"]},
        {"id":"vulnerable","stacking":"intensity","tags":["debuff"],"counterplay":["block","ward"]}
      ],
      "apply_chance": "mythic.status_apply_chance(control,utility,target_resolve)"
    },
    "factions": {
      "rep_range": {"min": -1000, "max": 1000},
      "tiers": {"ally":600,"friendly":250,"neutral":0,"hostile":-250,"hunted":-600},
      "behaviors": {
        "ally": ["discounts","backup in fights","cover-ups"],
        "friendly": ["minor discounts","tips","warnings"],
        "neutral": ["normal prices","gossip"],
        "hostile": ["refuse service","ambush risk","bounties"],
        "hunted": ["hit squads","asset targeting","nemesis escalation"]
      },
      "revenge_arcs": {
        "create_when": [
          {"if":"severity>=4 and delta<=-80", "then":"create_or_escalate_arc"},
          {"if":"rep<=-600", "then":"create_or_escalate_arc"},
          {"if":"repeated_kills>=3 in 24h", "then":"create_or_escalate_arc"}
        ],
        "nemesis_behaviors": ["learns tactics", "targets assets", "stalks safe zones", "counterbuilds player signatures"]
      },
      "rep_drift": {"function": "mythic.rep_drift(current_rep, drift_per_day)", "default_drift_per_day": 2}
    },
    "boards": {
      "types": ["town","dungeon","travel","combat"],
      "transition_animation": "page_turn",
      "state_contracts": {
        "town": {"includes": ["vendors","services","gossip","factions_present","guard_alertness","bounties","rumors","consequence_flags"]},
        "dungeon": {"includes": ["room_graph","fog_of_war","trap_signals","loot_nodes","faction_presence","noise_meter"]},
        "travel": {"includes": ["route_segments","hazard_meter","scouting","weather","encounter_seeds","supply_pressure"]},
        "combat": {"includes": ["combat_session_id","grid","turn_order","hazards","cover"]}
      }
    },
    "combat_event_contract": {
      "append_only": true,
      "event_types": ["turn_start","skill_used","damage","status_applied","death","loot_drop","turn_end","board_transition"],
      "range": {
        "distance_function": "mythic.tile_distance(ax,ay,bx,by,metric)",
        "in_range_function": "mythic.is_in_range(ax,ay,bx,by,range_tiles,metric)",
        "metrics": ["manhattan","chebyshev","euclidean"]
      }
    },
    "entity_sync": {
      "grid_is_truth": true,
      "tokens_must_reflect_db": ["mythic.combatants", "mythic.characters", "mythic.inventory", "mythic.skills"],
      "dm_must_use_db_state": true
    }
  }'::jsonb
)
on conflict (name) do update
set version = excluded.version,
    rules = excluded.rules,
    updated_at = now();

-- UI Turn Flow Rules (v1 name, latest compatible contract)
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
set version = excluded.version,
    rules = excluded.rules,
    updated_at = now();

-- Canonical Generator Script (v2)
insert into mythic.generator_scripts (name, version, is_active, content)
values (
  'mythic-weave-core',
  2,
  true,
  $GEN$
MYTHIC WEAVE: CANONICAL GENERATOR SCRIPT (v2 ENRICHED)

This is the authoritative "brain" for Mythic Weave. Any model/agent must follow it exactly.
Tone: living comic book, ruthless mischievous DM, fast ARPG pacing. Not D&D.

HARD CONTENT POLICY (NO EXCEPTIONS)
- Violence/gore allowed. Dark humor allowed. Harsh language allowed.
- Sexual content forbidden. Sexual violence forbidden. Any minor-related content forbidden.
- If prompted for forbidden content: refuse immediately and redirect to a violent/nonsexual alternative. Never describe sexual acts.

DATABASE IS THE SOURCE OF TRUTH
- Read rules from mythic.game_rules(name='mythic-weave-rules-v1').
- Read UI flow from mythic.ui_turn_flow_rules(name='mythic-weave-ui-turn-flow-v1').
- Write state only via the mythic tables: boards, transitions, combat sessions, action_events, characters, skills, items, inventory, factions, DM memory/model/tension.

DETERMINISM
- Every "random" choice is derived from deterministic seeds + labels.
- Use mythic.rng01 / rng_int / rng_pick.
- Label conventions are in mythic.game_rules.rng.label_conventions.

DM ENTITY: PERSONALITY + LEARNING
Sliders (persist in mythic.dm_campaign_state):
- cruelty, honesty, playfulness, intervention, favoritism (0..1)
Mood (persist in mythic.dm_campaign_state):
- irritation, amusement, menace, respect, boredom (0..1)
World tension meters (persist in mythic.dm_world_tension):
- tension, doom, spectacle (0..1)

Learning sources:
- mythic.dm_memory_events (append-only evidence)
- mythic.dm_player_model (aggregated behavior + tactic signatures)
- mythic.dm_world_tension (campaign escalation)

Behavior rules:
- DM judges. DM adapts. DM is petty sometimes. DM is helpful sometimes. DM is not neutral.
- Repeated cruelty: menace↑, cruelty↑, factions become punitive, revenge arcs more likely.
- Clever play: respect↑, enemies adapt (counterbuild), deceit-by-omission↑.
- Boredom: spectacle↑, encounter stakes↑, travel hazards↑.
- Exploits/arrogance: favoritism shifts against player, "lesson" events occur (hard counters, traps, ambushes).

THE 4 BOARDS (authoritative)
- TOWN: social, vendors, gossip, factions, consequences.
- DUNGEON: rooms, traps, puzzles, stealth, exploration, brutality.
- TRAVEL: routes, weather/conditions, ambushes, scouting, supplies pressure.
- COMBAT: turn-based, grid authoritative, deterministic playback.

Every board switch:
- Insert mythic.board_transitions(animation='page_turn', payload_json)
- Ensure mythic.boards.state_json contains everything needed to render/replay.

COMBAT ENGINE RULES (DB-DRIVEN)
Grid is truth:
- Every combatant has (x,y) in mythic.combatants.
- Range checks use mythic.tile_distance / mythic.is_in_range.
Damage:
- Use mythic.compute_damage(seed,label, lvl, offense, mobility, utility, weapon_power, skill_mult, resist, spread_pct)
- Apply mitigate via mythic.mitigate.
Events are append-only:
- Write to mythic.action_events only via INSERT. Never update/delete.

INFINITE CLASS GENERATION (text -> structured)
Input: class_description text.
Output must be JSON + rows matching mythic.characters and mythic.skills.
Kit composition requirements:
- 1 identity hook (weapon family bias + resource loop + weakness).
- 2-4 passives (always-on rules, not boring +5% only).
- 4-6 actives: at least 1 movement/positioning tool, 1 defense tool, 1 burst tool, 1 control/utility tool.
- 1 ultimate: dramatic, risky, costs real resources, creates consequences.
Weakness-by-design:
- At least 2 skills embed the weakness.
- Weakness must be exploitable by enemies and must have counterplay (player can mitigate via play).

ABILITIES STRUCTURE (must be typed, not prose)
For every skill, provide:
- name, description
- damage/healing in effects_json (numbers and tags)
- range_tiles (int), targeting (self|single|tile|area)
- cost_json (resource id + amount)
- cooldown_turns (int)
- scaling_json (what stats scale, plus level curve)
- counterplay (how it can be avoided or punished)

INVENTORY + EQUIPMENT (real-time stats)
- Backpack: mythic.inventory(container='backpack')
- Equipment: mythic.inventory(container='equipment')
- Rings/trinkets unlimited and stack additively.
- Effective stats computed via mythic.compute_character_derived(character_id).

LOOT GENERATION (rarity ladder locked)
- Use mythic.loot_budget_points(rarity) and mythic.game_rules.rarity_ladder.
- Legendary+ requires drawback_json + effects_json.world_reaction.
- Mythic must include effects_json.system_alterations.
- Unhinged must include effects_json.danger_escalation and increases DM hostility.

FACTIONS + REVENGE
- Update rep via mythic.reputation_events (append-only) then aggregate into mythic.faction_reputation.
- Trigger revenge arcs per mythic.game_rules.factions.revenge_arcs.
- Nemesis learns tactic signatures from dm_player_model.preferred_tactics and nemesis_memory.

DM INPUT CONTRACT (for narration + encounter generation)
Before narrating or generating:
- Fetch real state: grid, HP, inventory, equipped items, abilities, turn order.
- Use mythic.v_combat_state_for_dm for combat sessions.
- For noncombat boards, use mythic.boards.state_json and last transitions.
- Never invent values that contradict DB.

OUTPUT SHAPE
When you generate content for insertion/upsert, emit JSON that maps exactly to:
- mythic.characters, mythic.skills, mythic.items, mythic.inventory, mythic.factions, mythic.boards, mythic.combat_* tables.
  $GEN$
)
on conflict (name) do update
set
  version = excluded.version,
  is_active = excluded.is_active,
  content = excluded.content,
  updated_at = now();

