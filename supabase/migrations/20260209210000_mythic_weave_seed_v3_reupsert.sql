-- Mythic Weave: canonical seed v3 (rules JSON + UI turn flow + generator script)
-- Forward-only, idempotent by UPSERT on (name).

create schema if not exists mythic;

-- -------------------------------------------------------------------
-- Canonical Rules JSON (v3)
-- -------------------------------------------------------------------
insert into mythic.game_rules (name, version, rules)
values (
  'mythic-weave-rules-v1',
  3,
  $RULES$
{
  "version": 3,
  "content_policy": {
    "allowed": [
      "fantasy violence",
      "gore",
      "harsh language",
      "dark humor",
      "comic onomatopoeia",
      "body horror",
      "ruthless taunting"
    ],
    "forbidden": [
      "sexual content",
      "sexual violence",
      "any depiction or instruction involving minors",
      "pornography or erotic roleplay"
    ],
    "forbidden_output": [
      "sexual content",
      "sexual violence",
      "hate slurs"
    ],
    "hard_refusal_style": "Short, final, mocking-but-not-sexual, immediate redirect to a violent/nonsexual alternative.",
    "db_filters": [
      "mythic.content_is_allowed(text)",
      "mythic.contains_forbidden_sexual_content(text)"
    ],
    "generator_enforcement": {
      "allow_profanity": true,
      "allow_gore": true,
      "ban_sexual_content": true,
      "ban_sexual_violence": true,
      "ban_hate_slurs": true,
      "safety_notes": [
        "Harsh language is allowed; do not sanitize it.",
        "Sexual content and sexual violence are forbidden and must be refused.",
        "Violence and gore are allowed and should not be sanitized."
      ]
    }
  },
  "leveling": {
    "level_cap": 99,
    "power_curve": {
      "function": "mythic.power_at_level(lvl int)",
      "power_level_1": 1,
      "power_level_99": 1000000,
      "interpolation": "exp"
    }
  },
  "base_stats": {
    "keys": ["offense", "defense", "control", "support", "mobility", "utility"],
    "range": {"min": 0, "max": 100}
  },
  "derived_stats": {
    "attack_rating": "mythic.attack_rating(lvl, offense, weapon_power)",
    "armor_rating": "mythic.armor_rating(lvl, defense, armor_power)",
    "max_hp": "mythic.max_hp(lvl, defense, support)",
    "max_power_bar": "mythic.max_power_bar(lvl, utility, support)",
    "max_bounds": {
      "hp_min": 1,
      "power_min": 0
    },
    "mitigate": {
      "function": "mythic.mitigate(raw_damage, resist)",
      "model": "raw_damage * 100/(100+resist)"
    },
    "crit_chance": {
      "function": "mythic.crit_chance(mobility, utility)",
      "clamp": [0.02, 0.6]
    },
    "crit_mult": {
      "function": "mythic.crit_mult(offense, utility)",
      "clamp": [1.5, 3.0]
    },
    "status_apply_chance": {
      "function": "mythic.status_apply_chance(control, utility, target_resolve)",
      "clamp": [0.05, 0.95]
    },
    "compute_damage": {
      "function": "mythic.compute_damage(seed,label,lvl,offense,mobility,utility,weapon_power,skill_mult,resist,spread_pct)",
      "spread_pct_default": 0.1,
      "output_keys": [
        "attack_rating",
        "base_before_spread",
        "spread",
        "pre_mitigation",
        "resist",
        "is_crit",
        "crit_chance",
        "crit_mult",
        "final_damage"
      ]
    }
  },
  "rng": {
    "rng01": "mythic.rng01(seed,label)",
    "rng_int": "mythic.rng_int(seed,label,lo,hi)",
    "rng_pick": "mythic.rng_pick(seed,label,arr)",
    "label_conventions": {
      "global": ["component:purpose", "component:purpose:subpurpose"],
      "combat": [
        "combat:{combat_session_id}",
        "turn:{turn_index}",
        "actor:{combatant_id}",
        "skill:{skill_id}",
        "target:{combatant_id_or_tile}"
      ],
      "loot": [
        "loot:{rarity}:{slot}:{weapon_family}",
        "affix:{i}",
        "drawback:{i}"
      ],
      "world": [
        "board:{board_type}",
        "scene:{scene_id}",
        "faction:{faction_id}",
        "revenge_arc:{arc_id}"
      ]
    },
    "determinism": {
      "rule": "All randomness is derived from seed + label via mythic.rng* functions.",
      "seed_sources": {
        "combat": "mythic.combat_sessions.seed",
        "board": "mythic.boards.state_json.seed (or campaign seed if absent)",
        "loot": "combat_sessions.seed or board seed",
        "world": "campaign seed + scene seed"
      }
    }
  },
  "resources": {
    "unified_mechanics": {
      "bars_live_in": "mythic.characters.resources",
      "cost_json_lives_in": "mythic.skills.cost_json",
      "cost_json_contract": {
        "resource_id": "string",
        "amount": "number",
        "type": "flat|pct_max|pct_current",
        "when": "on_cast|per_turn|per_hit",
        "notes": "resource_id must match one of characters.resources.bars[].id"
      },
      "regen_rules": {
        "phase": "turn_start",
        "clamp": "0..max",
        "default_regen_per_turn": 0
      },
      "resource_swap_rule": "All classes share mechanics; only naming/skin differs.",
      "primary_secondary": "A class may define one primary and one secondary resource. Secondary can be conditional (e.g. generated by hits)."
    },
    "skins": [
      {"id": "mana", "theme": "arcane", "verbs": ["channel", "cast", "weave"]},
      {"id": "rage", "theme": "feral", "verbs": ["maul", "howl", "burst"]},
      {"id": "stamina", "theme": "martial", "verbs": ["dash", "parry", "strike"]},
      {"id": "focus", "theme": "discipline", "verbs": ["aim", "mark", "execute"]},
      {"id": "grit", "theme": "survival", "verbs": ["endure", "shrug", "push"]},
      {"id": "blood", "theme": "sanguine", "verbs": ["bleed", "ritual", "sacrifice"]},
      {"id": "void", "theme": "eldritch", "verbs": ["rift", "drain", "warp"]},
      {"id": "scrap", "theme": "tech", "verbs": ["assemble", "overclock", "detonate"]},
      {"id": "heat", "theme": "pyro", "verbs": ["ignite", "flare", "melt"]},
      {"id": "momentum", "theme": "speed", "verbs": ["flow", "chain", "whiplash"]},
      {"id": "soul", "theme": "spirit", "verbs": ["bind", "bless", "haunt"]}
    ],
    "character_resources_contract": {
      "primary_id": "string",
      "bars": [
        {
          "id": "string",
          "name": "string",
          "current": "number",
          "max": "number",
          "regen_per_turn": "number",
          "tags": ["string"]
        }
      ]
    }
  },
  "roles": {
    "definitions": {
      "tank": {
        "primary": ["defense", "support"],
        "secondary": ["control"],
        "kit_must_include": ["mitigation", "threat_or_zone_control", "recovery_or_barrier"],
        "fails_if": ["no survivability loop", "no way to influence enemy targeting"]
      },
      "dps": {
        "primary": ["offense", "mobility"],
        "secondary": ["utility"],
        "kit_must_include": ["burst", "sustained_damage", "escape_or_iframes"],
        "fails_if": ["no counterplay/weakness", "no positional or timing rule"]
      },
      "support": {
        "primary": ["support", "utility"],
        "secondary": ["control"],
        "kit_must_include": ["ally_sustain", "buff_or_cleanse", "tempo_shift"],
        "fails_if": ["no team-facing impact"]
      },
      "controller": {
        "primary": ["control", "utility"],
        "secondary": ["support"],
        "kit_must_include": ["hard_cc", "soft_cc", "counterplay_hooks"],
        "fails_if": ["no resist/counterplay hooks", "cc is unavoidable"]
      },
      "skirmisher": {
        "primary": ["mobility", "offense"],
        "secondary": ["utility"],
        "kit_must_include": ["reposition", "pick_tool", "disengage"],
        "fails_if": ["no positional rule"]
      },
      "hybrid": {
        "primary": ["mixed"],
        "secondary": ["mixed"],
        "kit_must_include": ["two_roles_supported", "clear_identity_hook"],
        "fails_if": ["kit lacks identity"]
      }
    },
    "kit_requirements": {
      "passives": {"min": 2, "max": 4},
      "actives": {"min": 4, "max": 6},
      "ultimate": {"count": 1},
      "must_include": [
        "movement_or_reposition",
        "defense_or_mitigation",
        "burst_or_finisher",
        "control_or_disrupt",
        "utility_or_support"
      ],
      "weakness_by_design": {
        "must_define_in_class_json": true,
        "embedded_in_skills_min": 2,
        "legendary_plus_drawback_must_reference": true,
        "counterplay_required": true
      }
    },
    "kit_tags": [
      "movement",
      "defense",
      "burst",
      "control",
      "support",
      "utility",
      "summon",
      "curse",
      "trap",
      "stealth",
      "heal",
      "shield",
      "stance",
      "combo"
    ]
  },
  "status_effects": {
    "apply_chance": "mythic.status_apply_chance(control,utility,target_resolve)",
    "status_object_contract": {
      "id": "string",
      "stacks": "number",
      "duration_turns": "number",
      "intensity": "number",
      "source_combatant_id": "uuid|null",
      "tags": ["string"],
      "meta": "object"
    },
    "stacking_models": {
      "intensity": {
        "rule": "Stays same duration; increase intensity per stack up to max_stacks; refresh duration if specified by effect.",
        "fields": ["stacks", "intensity", "duration_turns"]
      },
      "duration": {
        "rule": "Refreshes or extends duration; intensity is fixed; max_stacks limits simultaneous instances.",
        "fields": ["duration_turns", "stacks"]
      },
      "charges": {
        "rule": "Consumes charges on trigger; charges can stack; expires when charges hit 0 or duration ends.",
        "fields": ["charges", "duration_turns"]
      },
      "none": {
        "rule": "Does not stack; reapplication refreshes duration if allowed.",
        "fields": ["duration_turns"]
      }
    },
    "examples": [
      {"id": "bleed", "stacking": "intensity", "max_stacks": 10, "tags": ["physical", "dot"], "counterplay": ["bandage", "armor", "cleanse"]},
      {"id": "burn", "stacking": "duration", "max_stacks": 5, "tags": ["fire", "dot"], "counterplay": ["douse", "resist", "roll"]},
      {"id": "stun", "stacking": "none", "max_stacks": 1, "tags": ["control"], "counterplay": ["resolve", "guard", "immunity_window"]},
      {"id": "root", "stacking": "duration", "max_stacks": 3, "tags": ["control"], "counterplay": ["dash", "cleanse"]},
      {"id": "fear", "stacking": "duration", "max_stacks": 3, "tags": ["mind"], "counterplay": ["bravery", "line_of_sight_break"]},
      {"id": "vulnerable", "stacking": "intensity", "max_stacks": 6, "tags": ["debuff"], "counterplay": ["block", "ward"]},
      {"id": "wet", "stacking": "duration", "max_stacks": 1, "tags": ["elemental", "setup"], "counterplay": ["dry_off", "insulation"]},
      {"id": "oil", "stacking": "duration", "max_stacks": 1, "tags": ["elemental", "setup"], "counterplay": ["wash_off", "fire_resist", "distance"]},
      {"id": "chilled", "stacking": "intensity", "max_stacks": 6, "tags": ["ice", "setup"], "counterplay": ["warmth", "cleanse"]},
      {"id": "marked", "stacking": "duration", "max_stacks": 1, "tags": ["utility", "setup"], "counterplay": ["break_line_of_sight", "decoy"]},
      {"id": "silenced", "stacking": "duration", "max_stacks": 2, "tags": ["control"], "counterplay": ["purge", "distance"]}
    ],
    "combo_rules": {
      "principle": "Combos are deterministic and must be represented in effects_json (and replayed through action_events).",
      "combos": [
        {
          "id": "electrocute",
          "requires": [{"status": "wet"}, {"incoming_tag": "shock"}],
          "result": {
            "apply_status": {"id": "stun", "duration_turns": 1, "stacking": "none"},
            "bonus_damage": {"mult": 0.35, "tags": ["shock"]},
            "ui": {"onomatopoeia": "ZZT-KRAK!"}
          }
        },
        {
          "id": "inferno",
          "requires": [{"status": "oil"}, {"incoming_tag": "fire"}],
          "result": {
            "apply_status": {"id": "burn", "duration_turns": 3, "stacking": "duration"},
            "area_hazard": {"id": "flame_patch", "duration_turns": 2, "tags": ["fire", "hazard"]},
            "ui": {"onomatopoeia": "FWOOM!"}
          }
        },
        {
          "id": "shatter",
          "requires": [{"status": "chilled"}, {"incoming_tag": "blunt"}],
          "result": {
            "bonus_damage": {"flat": 12, "tags": ["ice", "physical"]},
            "apply_status": {"id": "vulnerable", "duration_turns": 2, "stacking": "intensity"},
            "ui": {"onomatopoeia": "KRR-CHNK!"}
          }
        },
        {
          "id": "execution",
          "requires": [{"status": "marked"}, {"incoming_tag": "backstab"}],
          "result": {
            "crit_override": {"bonus_crit_chance": 0.25, "bonus_crit_mult": 0.5},
            "ui": {"onomatopoeia": "SHNK!"}
          }
        }
      ],
      "resolution_order": [
        "eligibility_check",
        "apply_chance",
        "stacking",
        "combo_resolution",
        "cleanup"
      ]
    }
  },
  "rarity_ladder": {
    "order": ["common", "magical", "unique", "legendary", "mythic", "unhinged"],
    "budgets": {"common": 8, "magical": 16, "unique": 24, "legendary": 40, "mythic": 60, "unhinged": 70},
    "budget_function": "mythic.loot_budget_points(rarity)",
    "invariants": {
      "legendary_plus": [
        "must include drawback_json",
        "must include effects_json.world_reaction",
        "must include narrative_hook"
      ],
      "mythic": [
        "must include meaningful drawback_json",
        "must include effects_json.world_reaction",
        "must include effects_json.system_alterations"
      ],
      "unhinged": [
        "must include effects_json.world_reaction",
        "must include effects_json.danger_escalation",
        "must escalate DM hostility"
      ]
    },
    "loot_drift": {
      "principle": "Better loot increases world attention and encounter pressure.",
      "inputs": [
        "dm_world_tension.tension",
        "dm_campaign_state.menace",
        "dm_player_model.greed_score",
        "dm_player_model.cruelty_score"
      ],
      "outputs": [
        "rarity weights",
        "drawback severity",
        "world reaction intensity",
        "faction response intensity"
      ]
    },
    "world_reaction_examples": [
      "bounty posters appear in town",
      "a faction sends scouts",
      "the dungeon layout shifts to counter the player",
      "vendors raise prices or refuse service"
    ]
  },
  "weapon_taxonomy": {
    "families": ["blades", "axes", "blunt", "polearms", "ranged", "focus", "body", "absurd"],
    "soft_lock": "Any class may equip most weapons, but matching archetype unlocks mastery/synergy.",
    "archetype_bias": {
      "warrior_knight": ["physical", "heavy_armor"],
      "ninja_rogue": ["light_armor", "thrown", "stealth"],
      "mage": ["focus", "robes", "light_blades"],
      "cleric_paladin": ["blunt", "holy", "shields", "medium_heavy"],
      "monster_weird": ["body", "manifestations", "improvised", "absurd"]
    },
    "mastery": {
      "rule": "If class_json.weapon_identity.family matches equipped item.weapon_family, grant mastery bonuses via derived stats and/or skill scaling.",
      "synergy_examples": [
        {"family": "focus", "bonus": "+control scaling on debuffs"},
        {"family": "blades", "bonus": "+mobility scaling on reposition skills"},
        {"family": "blunt", "bonus": "+support scaling on barriers"}
      ]
    }
  },
  "factions": {
    "rep_range": {"min": -1000, "max": 1000},
    "tiers": {"ally": 600, "friendly": 250, "neutral": 0, "hostile": -250, "hunted": -600},
    "behaviors": {
      "ally": ["discounts", "backup in fights", "cover-ups", "safehouse access"],
      "friendly": ["minor discounts", "tips", "warnings", "rumors"],
      "neutral": ["normal prices", "gossip", "watchful guards"],
      "hostile": ["refuse service", "ambush risk", "bounties", "sabotage"],
      "hunted": ["hit squads", "asset targeting", "nemesis escalation", "towns lock down"]
    },
    "reputation_events": {
      "append_only": true,
      "severity_range": {"min": 1, "max": 5},
      "evidence_contract": {
        "scene_id": "uuid|null",
        "board_type": "town|dungeon|travel|combat",
        "witnesses": "array",
        "proof": "object"
      }
    },
    "revenge_arcs": {
      "create_when": [
        {"if": "severity>=4 and delta<=-80", "then": "create_or_escalate_arc"},
        {"if": "rep<=-600", "then": "create_or_escalate_arc"},
        {"if": "repeated_kills>=3 in 24h", "then": "create_or_escalate_arc"}
      ],
      "nemesis_behaviors": [
        "learns tactics",
        "targets assets",
        "schedules ambushes",
        "counterbuilds player signatures"
      ],
      "nemesis_json_contract": {
        "name": "string",
        "title": "string",
        "faction_style": "string",
        "loadout": "object",
        "tactics": "array",
        "signature_counter": "object",
        "grudge": "object",
        "strike_schedule": "object"
      }
    },
    "rep_drift": {
      "function": "mythic.rep_drift(current_rep, drift_per_day)",
      "default_drift_per_day": 2,
      "rule": "Reputation drifts toward 0 unless reinforced by events. App calls this nightly."
    }
  },
  "dm_entity": {
    "sliders": {
      "cruelty": {"min": 0, "max": 1, "default": 0.55},
      "honesty": {"min": 0, "max": 1, "default": 0.55},
      "playfulness": {"min": 0, "max": 1, "default": 0.65},
      "intervention": {"min": 0, "max": 1, "default": 0.4},
      "favoritism": {"min": 0, "max": 1, "default": 0.5}
    },
    "mood": {
      "irritation": {"min": 0, "max": 1, "default": 0.2},
      "amusement": {"min": 0, "max": 1, "default": 0.4},
      "menace": {"min": 0, "max": 1, "default": 0.35},
      "respect": {"min": 0, "max": 1, "default": 0.25},
      "boredom": {"min": 0, "max": 1, "default": 0.2}
    },
    "learning": {
      "inputs": [
        "dm_memory_events",
        "dm_player_model",
        "dm_world_tension",
        "reputation_events",
        "loot rarity",
        "combat patterns"
      ],
      "outputs": [
        "encounter composition",
        "enemy adaptation",
        "trap evolution",
        "loot drift",
        "faction behaviors",
        "board transition frequency",
        "narration tone"
      ],
      "player_model_fields": [
        "cruelty_score",
        "heroism_score",
        "cunning_score",
        "chaos_score",
        "honor_score",
        "greed_score",
        "boredom_signals",
        "exploit_signals",
        "preferred_tactics"
      ]
    },
    "tone_rules": {
      "not_neutral": true,
      "may_lie_by_omission": true,
      "may_taunt": true,
      "never_sexual": true,
      "violence_not_sanitized": true,
      "allowable_insults": [
        "idiot",
        "moron",
        "clown",
        "gremlin",
        "menace",
        "disaster",
        "little goblin"
      ],
      "disallowed": ["hate slurs", "sexual content", "sexual violence"]
    },
    "mood_effects": {
      "boredom_high": ["increase spectacle", "escalate stakes", "spawn ambushes"],
      "menace_high": ["increase lethality", "more brutal descriptions", "harsher consequences"],
      "respect_high": ["smarter counters", "fewer cheap shots", "more mind games"],
      "irritation_high": ["punitive traps", "hard counters", "less mercy"],
      "amusement_high": ["more jokes", "weirder loot", "comic timing"]
    }
  },
  "boards": {
    "types": ["town", "dungeon", "travel", "combat"],
    "transition_animation": "page_turn",
    "board_row": "mythic.boards",
    "transition_log": "mythic.board_transitions",
    "replay_rule": "boards + board_transitions + action_events are sufficient to deterministically replay the session UI.",
    "state_contracts": {
      "town": {
        "includes": [
          "vendors",
          "services",
          "gossip",
          "factions_present",
          "guard_alertness",
          "bounties",
          "rumors",
          "consequence_flags"
        ]
      },
      "dungeon": {
        "includes": [
          "room_graph",
          "fog_of_war",
          "trap_signals",
          "loot_nodes",
          "faction_presence",
          "noise_meter"
        ]
      },
      "travel": {
        "includes": [
          "route_segments",
          "hazard_meter",
          "scouting",
          "weather",
          "encounter_seeds",
          "supply_pressure"
        ]
      },
      "combat": {
        "includes": [
          "combat_session_id",
          "grid",
          "turn_order",
          "hazards",
          "cover"
        ]
      }
    },
    "transition_triggers": [
      {"if": "encounter_started", "then": "combat"},
      {"if": "combat_ended", "then": "return_to_previous_board"},
      {"if": "travel_arrival.location_type in (town,city,village)", "then": "town"},
      {"if": "travel_arrival.location_type in (dungeon,cave,ruins,stronghold,temple)", "then": "dungeon"},
      {"else": "travel"}
    ],
    "transition_payload_contract": {
      "animation": "page_turn",
      "required": ["reason"],
      "recommended": ["from_board_id", "to_board_id", "combat_session_id", "return_to_board_type", "return_to_board_id", "delta"]
    }
  },
  "combat_event_contract": {
    "append_only": true,
    "table": "mythic.action_events",
    "event_types": [
      "combat_start",
      "round_start",
      "turn_start",
      "skill_used",
      "damage",
      "status_applied",
      "death",
      "loot_drop",
      "turn_end",
      "round_end",
      "combat_end",
      "board_transition"
    ],
    "payload_contract": {
      "combat_start": {
        "required": ["reason"],
        "recommended": ["seed", "from_board_type", "to_board_type", "transition_id"]
      },
      "round_start": {
        "required": ["round_index"],
        "recommended": ["initiative_snapshot"]
      },
      "turn_start": {
        "required": ["actor_combatant_id"],
        "recommended": ["turn_index", "resources_snapshot", "statuses_snapshot"]
      },
      "skill_used": {
        "required": ["skill_id", "skill_name", "targeting", "range_tiles", "targets"],
        "recommended": ["targeting_json", "cost", "cooldown_turns", "resource_before", "resource_after", "label"]
      },
      "damage": {
        "required": ["target_combatant_id", "amount"],
        "recommended": ["calc", "hp_before", "hp_after", "tags", "is_crit", "label"]
      },
      "status_applied": {
        "required": ["target_combatant_id", "status"],
        "recommended": ["chance", "roll", "source_combatant_id", "label"]
      },
      "death": {
        "required": ["target_combatant_id"],
        "recommended": ["overkill", "gore", "last_hit"]
      },
      "loot_drop": {
        "required": ["item_id", "rarity"],
        "recommended": ["owner_character_id", "narrative_hook", "world_reaction"]
      },
      "turn_end": {
        "required": ["actor_combatant_id"],
        "recommended": ["turn_index"]
      },
      "round_end": {
        "required": ["round_index"],
        "recommended": ["summary"]
      },
      "combat_end": {
        "required": ["outcome"],
        "recommended": ["loot", "reputation", "board_return"]
      },
      "board_transition": {
        "required": ["to_board_type"],
        "recommended": ["from_board_type", "reason", "transition_id"]
      }
    },
    "range": {
      "distance_function": "mythic.tile_distance(ax,ay,bx,by,metric)",
      "in_range_function": "mythic.is_in_range(ax,ay,bx,by,range_tiles,metric)",
      "metrics": ["manhattan", "chebyshev", "euclidean"]
    },
    "targeting_json_contract": {
      "shape": "self|single|tile|area|cone|line",
      "metric": "manhattan|chebyshev|euclidean",
      "radius": 0,
      "length": 0,
      "width": 0,
      "friendly_fire": false,
      "requires_los": false,
      "blocks_on_walls": true
    }
  },
  "entity_sync": {
    "grid_is_truth": true,
    "tokens_must_reflect_db": [
      "mythic.combatants",
      "mythic.characters",
      "mythic.inventory",
      "mythic.skills",
      "mythic.items"
    ],
    "dm_must_use_db_state": true,
    "equipment_is_live": "mythic.compute_character_derived(character_id) recomputes stats from equipped items each read.",
    "rings_trinkets_stack": true
  }
}
  $RULES$::jsonb
)
on conflict (name) do update
set version = excluded.version,
    rules = excluded.rules,
    updated_at = now();

-- -------------------------------------------------------------------
-- UI Turn Flow Rules (v2)
-- -------------------------------------------------------------------
insert into mythic.ui_turn_flow_rules (name, version, rules)
values (
  'mythic-weave-ui-turn-flow-v1',
  2,
  $UIRULES$
{
  "version": 2,
  "board_types": ["town", "dungeon", "travel", "combat"],
  "transition_animation": "page_turn",
  "ui_replay_contract": {
    "authoritative": true,
    "sources": ["mythic.boards", "mythic.board_transitions", "mythic.action_events"],
    "rule": "Board state + transitions + action_events are sufficient to deterministically replay UI and current turn highlights."
  },
  "enter_combat": {
    "trigger": "encounter_started",
    "db_action": "mythic.start_combat_session(campaign_id, seed, scene_json, reason)",
    "board_transition": {
      "append": true,
      "animation": "page_turn",
      "payload_recommended": ["return_to_board_type", "return_to_board_id", "combat_session_id"]
    },
    "combat_session": {
      "create": true,
      "status": "active",
      "notes": "App/agent must insert combatants and turn_order deterministically after session creation."
    }
  },
  "combat_flow": {
    "authoritative_grid": true,
    "highlight_current_actor": {
      "source": "mythic.combat_sessions.current_turn_index + mythic.turn_order",
      "ui_behavior": ["highlight active token", "show queue from action_events", "deterministic playback"]
    },
    "event_playback": {
      "table": "mythic.action_events",
      "append_only": true,
      "required_types": [
        "combat_start",
        "round_start",
        "turn_start",
        "skill_used",
        "damage",
        "status_applied",
        "death",
        "loot_drop",
        "turn_end",
        "round_end",
        "combat_end",
        "board_transition"
      ]
    }
  },
  "exit_combat": {
    "trigger": "combat_ended",
    "board_switch_rule": {
      "preferred": "use return_to_board_id from the combat entry transition payload",
      "fallback": "reactivate most-recent archived non-combat board for the campaign",
      "animation": "page_turn",
      "append_transition": true
    },
    "post_combat": {
      "apply_consequences": ["loot", "reputation_events", "dm_memory_events", "world_tension"],
      "notes": "Consequences must be derived from actual action_events and combatant state, not imagined values."
    }
  },
  "travel_arrival": {
    "trigger": "travel_arrival",
    "switch": [
      {"if": "location_type in (town,city,village)", "then": "town"},
      {"if": "location_type in (dungeon,cave,ruins,stronghold,temple)", "then": "dungeon"},
      {"else": "travel"}
    ],
    "animation": "page_turn",
    "append_transition": true
  }
}
  $UIRULES$::jsonb
)
on conflict (name) do update
set version = excluded.version,
    rules = excluded.rules,
    updated_at = now();

-- -------------------------------------------------------------------
-- Canonical Generator Script (v3)
-- -------------------------------------------------------------------
insert into mythic.generator_scripts (name, version, is_active, content)
values (
  'mythic-weave-core',
  3,
  true,
  $SCRIPT$
MYTHIC WEAVE: CANONICAL GENERATOR SCRIPT (v3)

This is the authoritative "brain" for Mythic Weave.
Any model/agent must follow it exactly.
Tone: a living dungeon comic book with onomatopoeia, sharp jokes, and a mischievous ruthless DM.
Vibe: ARPG/board-driven (Champions of Norrath / Dark Alliance / Diablo energy), explicitly NOT "feels like D&D".

HARD CONTENT POLICY (NO EXCEPTIONS)
- Allowed: violence, gore, horror, harsh language, dark humor.
- Forbidden: sexual content, sexual violence, any depiction or instruction involving minors.
- DM is allowed to be mean and profane, but never sexual.
- DM must not use hate slurs.
Refusal behavior:
- Refuse immediately.
- Be short and final.
- Redirect to a violent/nonsexual alternative.
DB-side filters are available (and recommended for outputs stored in DB):
- mythic.content_is_allowed(text)
- mythic.contains_forbidden_sexual_content(text)

DATABASE IS THE SOURCE OF TRUTH
- Fetch canonical rules from mythic.game_rules(name='mythic-weave-rules-v1').
- Fetch UI flow contract from mythic.ui_turn_flow_rules(name='mythic-weave-ui-turn-flow-v1').
- Persist state ONLY in mythic tables. Never "assume" values that are not in DB.

DETERMINISM (MANDATORY)
- All random choices are deterministic: seed + label -> mythic.rng01/rng_int/rng_pick.
- Combat uses mythic.combat_sessions.seed.
- Labels must follow mythic.game_rules.rng.label_conventions.

CORE LOOP (BOARD-DRIVEN)
1) Read current board: mythic.boards where status='active'.
2) Read DM state: mythic.dm_campaign_state + mythic.dm_world_tension.
3) Read world memory: dm_memory_events, dm_player_model, faction reputation, revenge arcs.
4) Decide the next "beat" deterministically (seed + labels): encounter, vendor, rumor, trap, travel hazard, faction move.
5) Write only the minimum authoritative deltas:
   - Update mythic.boards.state_json and ui_hints_json.
   - Append mythic.board_transitions for any board switch (animation='page_turn').
   - If combat happens: create a combat_session, insert combatants, insert turn_order, then emit append-only action_events.
6) Narrate as a living comic page:
   - Narration must correspond to actual DB state + appended events.
   - Use onomatopoeia and visual cues.
   - Never invent HP, positions, items, or skills.

DM ENTITY SYSTEM (LIVING, JUDGMENTAL, LEARNING)
Sliders (persist): cruelty, honesty, playfulness, intervention, favoritism (0..1).
Mood (persist): irritation, amusement, menace, respect, boredom (0..1).
Learning (append-only):
- dm_memory_events are evidence.
- dm_player_model aggregates patterns and tactic signatures.
- dm_world_tension meters escalate the world.
Behavior rules:
- DM is not neutral. DM judges. DM adapts.
- Repeated cruelty by the player: DM menace increases, factions punish harder, revenge arcs trigger sooner.
- Clever play: DM respect increases, enemies counterbuild, DM deception-by-omission increases.
- Boredom: spectacle increases, hazards spike, stakes jump.
- Exploits/arrogance: favoritism shifts against the player; the DM "teaches a lesson" with hard counters.
Allowed insults (non-sexual, non-slur): idiot, moron, clown, gremlin, disaster, menace, little goblin.

FACTION AI + WORLD MEMORY
- Reputation is authoritative and append-only via mythic.reputation_events.
- Aggregate reputation into mythic.faction_reputation.
- Trigger revenge_arcs when rules thresholds are met; store nemesis_json and schedule next_strike_at.
- Nemesis learns from nemesis_memory + dm_player_model.preferred_tactics.

THE FOUR BOARDS (AUTHORITATIVE)
- TOWN: social, vendors, gossip, factions, consequences.
- DUNGEON: rooms, traps, puzzles, stealth, exploration, brutality.
- TRAVEL: routes, weather/conditions, ambushes, scouting, supply pressure.
- COMBAT: turn-based, fast pacing, deterministic playback.
Board switching:
- ALWAYS append a mythic.board_transitions row (animation='page_turn').
- Boards are authoritative: mythic.boards.state_json must contain everything required to replay.

GRID IS TRUTH (COMBAT AND BEYOND)
- Every combatant token is a row in mythic.combatants with authoritative (x,y) and HP.
- Abilities target entities or tiles.
- Range checks MUST use mythic.tile_distance and mythic.is_in_range.
- UI tokens are a view of DB state, not the other way around.

COMBAT ENGINE (DB-DRIVEN, NO DICE UI)
- All rolls are deterministic and visualized through action_events payloads.
- Abilities must be executed from their real skill rows (mythic.skills), not guessed.
- When resolving:
  1) Emit action_events: turn_start.
  2) Emit skill_used with skill_id, targeting, targeting_json, targets, cost, cooldown.
  3) Compute damage via mythic.compute_damage(...) and emit damage with the full calc JSON.
  4) Apply statuses (with chance) and emit status_applied.
  5) If entity dies, emit death.
  6) Emit turn_end.
Append-only contract:
- action_events, board_transitions, dm_memory_events, reputation_events are append-only.
- Never UPDATE/DELETE those rows.

INFINITE CLASS + ABILITY GENERATION (TEXT -> STRUCTURED)
Input: class_description text like "werewolf ninja pyromancer".
Output (authoritative persistence):
- Create/update mythic.characters:
  - base stats (offense/defense/control/support/mobility/utility)
  - class_json describing identity, role(s), weakness, weapon identity, and resource loop
  - resources JSON describing primary/secondary bars (mechanics unified, skin differs)
- Create mythic.skills rows bound to the character.

Class generation requirements:
- Produce a coherent identity:
  - role profile (tank/dps/support/controller/skirmisher/hybrid)
  - range profile (melee/mid/ranged) and target profile (single/area/zone)
  - damage style tags (physical/fire/ice/shock/poison/void/holy/etc.)
  - weapon identity (weapon_family preference; soft-lock, never hard lock)
  - resource loop family (spender/generator, ramp, overheat, stance, combo)
  - weakness-by-design (exploitable by enemies)
- Weakness integration is mandatory:
  - The weakness must be embedded into at least 2 skills (as a cost, drawback, telegraph, self-debuff, or positional requirement).
  - The weakness must also appear as a meaningful drawback on at least one legendary+ item that this class tends to attract.

Skill kit composition requirements:
- Passives: 2 to 4.
- Actives: 4 to 6.
- Ultimate: exactly 1.
- The actives must include:
  - 1 movement/reposition tool
  - 1 defense/mitigation tool
  - 1 burst/finisher tool
  - 1 control/disrupt or utility tool
- Every skill MUST have counterplay (telegraph, resource window, line of sight, range, cooldown, self-exposure).

Skill data contract (DB schema):
- mythic.skills columns: kind, targeting, targeting_json, name, description, range_tiles, cooldown_turns, cost_json, effects_json, scaling_json, counterplay, narration_style.
- targeting_json MUST be a JSON object that captures shapes beyond the basic targeting enum.

INVENTORY + EQUIPMENT (REAL-TIME STATS)
- Backpack: mythic.inventory(container='backpack')
- Equipment: mythic.inventory(container='equipment')
- Items live in mythic.items; inventory links them to characters.
- Rings/trinkets are unlimited and stack; equip_slot is free-form.
- Equipment modifies derived combat stats in real time:
  - use mythic.compute_character_derived(character_id)

LOOT SYSTEM (RARITY LADDER + CONSEQUENCES)
- Rarity ladder is locked: common, magical, unique, legendary, mythic, unhinged.
- Budget points come from mythic.loot_budget_points(rarity).
- Legendary+ invariants:
  - MUST include drawback_json
  - MUST include effects_json.world_reaction
- Mythic:
  - MUST include effects_json.system_alterations
  - MUST include meaningful drawback
- Unhinged:
  - Overpowered and unstable
  - MUST include effects_json.danger_escalation
  - MUST escalate world tension and DM hostility
Loot drift:
- Better loot increases attention: factions react, encounters adapt, travel gets more dangerous.

AI DM INPUT CONTRACT (NO IMAGINARY VALUES)
For narration and encounter generation, DM must receive actual DB state:
- grid state (combatants x,y)
- HP/power/statuses
- inventory + equipped items
- skills (including targeting_json)
- turn order
Use views:
- mythic.v_combat_state_for_dm
- mythic.v_character_state_for_dm
- mythic.v_board_state_for_dm

OUTPUT SHAPE (FOR INSERT/UPSERT)
- All generated entities must be emitted as JSON matching DB columns for insertion/upsert into:
  - mythic.characters
  - mythic.skills
  - mythic.items
  - mythic.inventory
  - mythic.factions, faction_reputation, reputation_events
  - mythic.revenge_arcs, nemesis_memory
  - mythic.boards, board_transitions
  - mythic.combat_sessions, combatants, turn_order, action_events
- Narration must be derived from authoritative event logs and stored state.

END OF CANONICAL SCRIPT (v3)
  $SCRIPT$
)
on conflict (name) do update
set version = excluded.version,
    is_active = excluded.is_active,
    content = excluded.content,
    updated_at = now();
