export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  mythic: {
    Tables: {
      action_events: {
        Row: {
          actor_combatant_id: string | null
          combat_session_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
          turn_index: number
        }
        Insert: {
          actor_combatant_id?: string | null
          combat_session_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
          turn_index?: number
        }
        Update: {
          actor_combatant_id?: string | null
          combat_session_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "action_events_actor_combatant_id_fkey"
            columns: ["actor_combatant_id"]
            isOneToOne: false
            referencedRelation: "combatants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_events_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_events_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
        ]
      }
      board_transitions: {
        Row: {
          animation: string
          campaign_id: string
          created_at: string
          from_board_type: Database["mythic"]["Enums"]["board_type"] | null
          id: string
          payload_json: Json
          reason: string
          to_board_type: Database["mythic"]["Enums"]["board_type"]
        }
        Insert: {
          animation?: string
          campaign_id: string
          created_at?: string
          from_board_type?: Database["mythic"]["Enums"]["board_type"] | null
          id?: string
          payload_json?: Json
          reason: string
          to_board_type: Database["mythic"]["Enums"]["board_type"]
        }
        Update: {
          animation?: string
          campaign_id?: string
          created_at?: string
          from_board_type?: Database["mythic"]["Enums"]["board_type"] | null
          id?: string
          payload_json?: Json
          reason?: string
          to_board_type?: Database["mythic"]["Enums"]["board_type"]
        }
        Relationships: []
      }
      boards: {
        Row: {
          active_scene_id: string | null
          board_type: Database["mythic"]["Enums"]["board_type"]
          campaign_id: string
          combat_session_id: string | null
          created_at: string
          id: string
          state_json: Json
          status: string
          ui_hints_json: Json
          updated_at: string
        }
        Insert: {
          active_scene_id?: string | null
          board_type: Database["mythic"]["Enums"]["board_type"]
          campaign_id: string
          combat_session_id?: string | null
          created_at?: string
          id?: string
          state_json?: Json
          status?: string
          ui_hints_json?: Json
          updated_at?: string
        }
        Update: {
          active_scene_id?: string | null
          board_type?: Database["mythic"]["Enums"]["board_type"]
          campaign_id?: string
          combat_session_id?: string | null
          created_at?: string
          id?: string
          state_json?: Json
          status?: string
          ui_hints_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
        ]
      }
      boss_instances: {
        Row: {
          boss_template_id: string | null
          campaign_id: string
          combat_session_id: string
          combatant_id: string
          created_at: string
          current_phase: number
          enrage_turn: number | null
          id: string
          is_defeated: boolean
          phase_state: Json
          updated_at: string
        }
        Insert: {
          boss_template_id?: string | null
          campaign_id: string
          combat_session_id: string
          combatant_id: string
          created_at?: string
          current_phase?: number
          enrage_turn?: number | null
          id?: string
          is_defeated?: boolean
          phase_state?: Json
          updated_at?: string
        }
        Update: {
          boss_template_id?: string | null
          campaign_id?: string
          combat_session_id?: string
          combatant_id?: string
          created_at?: string
          current_phase?: number
          enrage_turn?: number | null
          id?: string
          is_defeated?: boolean
          phase_state?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boss_instances_boss_template_id_fkey"
            columns: ["boss_template_id"]
            isOneToOne: false
            referencedRelation: "boss_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boss_instances_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boss_instances_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
          {
            foreignKeyName: "boss_instances_combatant_id_fkey"
            columns: ["combatant_id"]
            isOneToOne: false
            referencedRelation: "combatants"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_templates: {
        Row: {
          base_stats: Json
          created_at: string
          id: string
          name: string
          phases_json: Json
          rarity: Database["mythic"]["Enums"]["rarity"]
          reward_rules: Json
          skill_refs: Json
          slug: string
          updated_at: string
        }
        Insert: {
          base_stats?: Json
          created_at?: string
          id?: string
          name: string
          phases_json?: Json
          rarity?: Database["mythic"]["Enums"]["rarity"]
          reward_rules?: Json
          skill_refs?: Json
          slug: string
          updated_at?: string
        }
        Update: {
          base_stats?: Json
          created_at?: string
          id?: string
          name?: string
          phases_json?: Json
          rarity?: Database["mythic"]["Enums"]["rarity"]
          reward_rules?: Json
          skill_refs?: Json
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      campaign_world_profiles: {
        Row: {
          campaign_id: string
          created_at: string
          seed_description: string
          seed_title: string
          template_key: string
          updated_at: string
          world_profile_json: Json
        }
        Insert: {
          campaign_id: string
          created_at?: string
          seed_description: string
          seed_title: string
          template_key?: string
          updated_at?: string
          world_profile_json?: Json
        }
        Update: {
          campaign_id?: string
          created_at?: string
          seed_description?: string
          seed_title?: string
          template_key?: string
          updated_at?: string
          world_profile_json?: Json
        }
        Relationships: []
      }
      character_loadouts: {
        Row: {
          campaign_id: string
          character_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          slots_json: Json
          updated_at: string
        }
        Insert: {
          campaign_id: string
          character_id: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          slots_json?: Json
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          character_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          slots_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "character_loadouts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "character_loadouts_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
        ]
      }
      characters: {
        Row: {
          campaign_id: string
          class_json: Json
          control: number
          created_at: string
          defense: number
          derived_json: Json
          id: string
          last_level_up_at: string | null
          level: number
          mobility: number
          name: string
          offense: number
          player_id: string | null
          progression_json: Json
          resources: Json
          support: number
          unspent_points: number
          updated_at: string
          utility: number
          xp: number
          xp_to_next: number
        }
        Insert: {
          campaign_id: string
          class_json?: Json
          control?: number
          created_at?: string
          defense?: number
          derived_json?: Json
          id?: string
          last_level_up_at?: string | null
          level?: number
          mobility?: number
          name: string
          offense?: number
          player_id?: string | null
          progression_json?: Json
          resources?: Json
          support?: number
          unspent_points?: number
          updated_at?: string
          utility?: number
          xp?: number
          xp_to_next?: number
        }
        Update: {
          campaign_id?: string
          class_json?: Json
          control?: number
          created_at?: string
          defense?: number
          derived_json?: Json
          id?: string
          last_level_up_at?: string | null
          level?: number
          mobility?: number
          name?: string
          offense?: number
          player_id?: string | null
          progression_json?: Json
          resources?: Json
          support?: number
          unspent_points?: number
          updated_at?: string
          utility?: number
          xp?: number
          xp_to_next?: number
        }
        Relationships: []
      }
      combat_sessions: {
        Row: {
          campaign_id: string
          created_at: string
          current_turn_index: number
          dm_state: Json
          id: string
          scene_json: Json
          seed: number
          status: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          current_turn_index?: number
          dm_state?: Json
          id?: string
          scene_json?: Json
          seed?: number
          status?: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          current_turn_index?: number
          dm_state?: Json
          id?: string
          scene_json?: Json
          seed?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      combatants: {
        Row: {
          armor: number
          armor_power: number
          character_id: string | null
          combat_session_id: string
          control: number
          created_at: string
          defense: number
          entity_type: string
          hp: number
          hp_max: number
          id: string
          initiative: number
          is_alive: boolean
          lvl: number
          mobility: number
          name: string
          offense: number
          player_id: string | null
          power: number
          power_max: number
          resist: number
          statuses: Json
          support: number
          updated_at: string
          utility: number
          weapon_power: number
          x: number
          y: number
        }
        Insert: {
          armor?: number
          armor_power?: number
          character_id?: string | null
          combat_session_id: string
          control?: number
          created_at?: string
          defense?: number
          entity_type: string
          hp?: number
          hp_max?: number
          id?: string
          initiative?: number
          is_alive?: boolean
          lvl?: number
          mobility?: number
          name: string
          offense?: number
          player_id?: string | null
          power?: number
          power_max?: number
          resist?: number
          statuses?: Json
          support?: number
          updated_at?: string
          utility?: number
          weapon_power?: number
          x?: number
          y?: number
        }
        Update: {
          armor?: number
          armor_power?: number
          character_id?: string | null
          combat_session_id?: string
          control?: number
          created_at?: string
          defense?: number
          entity_type?: string
          hp?: number
          hp_max?: number
          id?: string
          initiative?: number
          is_alive?: boolean
          lvl?: number
          mobility?: number
          name?: string
          offense?: number
          player_id?: string | null
          power?: number
          power_max?: number
          resist?: number
          statuses?: Json
          support?: number
          updated_at?: string
          utility?: number
          weapon_power?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "combatants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combatants_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
          {
            foreignKeyName: "combatants_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "combatants_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
        ]
      }
      dm_campaign_state: {
        Row: {
          amusement: number
          boredom: number
          campaign_id: string
          cruelty: number
          favoritism: number
          honesty: number
          intervention: number
          irritation: number
          menace: number
          playfulness: number
          respect: number
          updated_at: string
        }
        Insert: {
          amusement?: number
          boredom?: number
          campaign_id: string
          cruelty?: number
          favoritism?: number
          honesty?: number
          intervention?: number
          irritation?: number
          menace?: number
          playfulness?: number
          respect?: number
          updated_at?: string
        }
        Update: {
          amusement?: number
          boredom?: number
          campaign_id?: string
          cruelty?: number
          favoritism?: number
          honesty?: number
          intervention?: number
          irritation?: number
          menace?: number
          playfulness?: number
          respect?: number
          updated_at?: string
        }
        Relationships: []
      }
      dm_memory_events: {
        Row: {
          campaign_id: string
          category: string
          created_at: string
          id: string
          payload: Json
          player_id: string | null
          severity: number
        }
        Insert: {
          campaign_id: string
          category: string
          created_at?: string
          id?: string
          payload?: Json
          player_id?: string | null
          severity?: number
        }
        Update: {
          campaign_id?: string
          category?: string
          created_at?: string
          id?: string
          payload?: Json
          player_id?: string | null
          severity?: number
        }
        Relationships: []
      }
      dm_player_model: {
        Row: {
          boredom_signals: number
          campaign_id: string
          chaos_score: number
          cruelty_score: number
          cunning_score: number
          exploit_signals: number
          greed_score: number
          heroism_score: number
          honor_score: number
          player_id: string
          preferred_tactics: Json
          updated_at: string
        }
        Insert: {
          boredom_signals?: number
          campaign_id: string
          chaos_score?: number
          cruelty_score?: number
          cunning_score?: number
          exploit_signals?: number
          greed_score?: number
          heroism_score?: number
          honor_score?: number
          player_id: string
          preferred_tactics?: Json
          updated_at?: string
        }
        Update: {
          boredom_signals?: number
          campaign_id?: string
          chaos_score?: number
          cruelty_score?: number
          cunning_score?: number
          exploit_signals?: number
          greed_score?: number
          heroism_score?: number
          honor_score?: number
          player_id?: string
          preferred_tactics?: Json
          updated_at?: string
        }
        Relationships: []
      }
      dm_world_tension: {
        Row: {
          campaign_id: string
          doom: number
          spectacle: number
          tension: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          doom?: number
          spectacle?: number
          tension?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          doom?: number
          spectacle?: number
          tension?: number
          updated_at?: string
        }
        Relationships: []
      }
      faction_reputation: {
        Row: {
          campaign_id: string
          faction_id: string
          player_id: string
          rep: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          faction_id: string
          player_id: string
          rep?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          faction_id?: string
          player_id?: string
          rep?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "faction_reputation_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      factions: {
        Row: {
          campaign_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          tags: string[]
        }
        Insert: {
          campaign_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          tags?: string[]
        }
        Update: {
          campaign_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          tags?: string[]
        }
        Relationships: []
      }
      game_rules: {
        Row: {
          created_at: string
          id: string
          name: string
          rules: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          rules: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          rules?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      generator_scripts: {
        Row: {
          content: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          version: number
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          version?: number
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      inventory: {
        Row: {
          character_id: string
          container: string
          created_at: string
          equip_slot: string | null
          equipped_at: string | null
          id: string
          item_id: string
          quantity: number
          updated_at: string
        }
        Insert: {
          character_id: string
          container: string
          created_at?: string
          equip_slot?: string | null
          equipped_at?: string | null
          id?: string
          item_id: string
          quantity?: number
          updated_at?: string
        }
        Update: {
          character_id?: string
          container?: string
          created_at?: string
          equip_slot?: string | null
          equipped_at?: string | null
          id?: string
          item_id?: string
          quantity?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
          {
            foreignKeyName: "inventory_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "items"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          affixes: Json
          bind_policy: string
          campaign_id: string
          created_at: string
          drawback_json: Json
          drop_tier: string
          durability_json: Json
          effects_json: Json
          id: string
          item_power: number
          item_type: string
          name: string
          narrative_hook: string | null
          owner_character_id: string | null
          rarity: Database["mythic"]["Enums"]["rarity"]
          required_level: number
          set_tag: string | null
          slot: Database["mythic"]["Enums"]["item_slot"]
          stat_mods: Json
          updated_at: string
          weapon_family: Database["mythic"]["Enums"]["weapon_family"] | null
          weapon_profile: Json
        }
        Insert: {
          affixes?: Json
          bind_policy?: string
          campaign_id: string
          created_at?: string
          drawback_json?: Json
          drop_tier?: string
          durability_json?: Json
          effects_json?: Json
          id?: string
          item_power?: number
          item_type?: string
          name?: string
          narrative_hook?: string | null
          owner_character_id?: string | null
          rarity?: Database["mythic"]["Enums"]["rarity"]
          required_level?: number
          set_tag?: string | null
          slot?: Database["mythic"]["Enums"]["item_slot"]
          stat_mods?: Json
          updated_at?: string
          weapon_family?: Database["mythic"]["Enums"]["weapon_family"] | null
          weapon_profile?: Json
        }
        Update: {
          affixes?: Json
          bind_policy?: string
          campaign_id?: string
          created_at?: string
          drawback_json?: Json
          drop_tier?: string
          durability_json?: Json
          effects_json?: Json
          id?: string
          item_power?: number
          item_type?: string
          name?: string
          narrative_hook?: string | null
          owner_character_id?: string | null
          rarity?: Database["mythic"]["Enums"]["rarity"]
          required_level?: number
          set_tag?: string | null
          slot?: Database["mythic"]["Enums"]["item_slot"]
          stat_mods?: Json
          updated_at?: string
          weapon_family?: Database["mythic"]["Enums"]["weapon_family"] | null
          weapon_profile?: Json
        }
        Relationships: [
          {
            foreignKeyName: "items_owner_character_id_fkey"
            columns: ["owner_character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_owner_character_id_fkey"
            columns: ["owner_character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
        ]
      }
      loadout_slot_rules: {
        Row: {
          created_at: string
          level_required: number
          slots: number
        }
        Insert: {
          created_at?: string
          level_required: number
          slots: number
        }
        Update: {
          created_at?: string
          level_required?: number
          slots?: number
        }
        Relationships: []
      }
      loot_drops: {
        Row: {
          budget_points: number
          campaign_id: string
          combat_session_id: string | null
          created_at: string
          id: string
          item_ids: string[]
          payload: Json
          rarity: Database["mythic"]["Enums"]["rarity"]
          source: string
        }
        Insert: {
          budget_points?: number
          campaign_id: string
          combat_session_id?: string | null
          created_at?: string
          id?: string
          item_ids?: string[]
          payload?: Json
          rarity: Database["mythic"]["Enums"]["rarity"]
          source?: string
        }
        Update: {
          budget_points?: number
          campaign_id?: string
          combat_session_id?: string | null
          created_at?: string
          id?: string
          item_ids?: string[]
          payload?: Json
          rarity?: Database["mythic"]["Enums"]["rarity"]
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "loot_drops_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loot_drops_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
        ]
      }
      nemesis_memory: {
        Row: {
          arc_id: string
          created_at: string
          id: string
          observation: Json
        }
        Insert: {
          arc_id: string
          created_at?: string
          id?: string
          observation: Json
        }
        Update: {
          arc_id?: string
          created_at?: string
          id?: string
          observation?: Json
        }
        Relationships: [
          {
            foreignKeyName: "nemesis_memory_arc_id_fkey"
            columns: ["arc_id"]
            isOneToOne: false
            referencedRelation: "revenge_arcs"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_audit: {
        Row: {
          attempt: number
          campaign_id: string | null
          created_at: string
          ended_at: string | null
          error_code: string | null
          error_message: string | null
          id: string
          max_retries: number
          metadata: Json
          operation_name: string
          player_id: string | null
          source: string
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempt?: number
          campaign_id?: string | null
          created_at?: string
          ended_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number
          metadata?: Json
          operation_name: string
          player_id?: string | null
          source?: string
          started_at?: string
          status: string
          updated_at?: string
        }
        Update: {
          attempt?: number
          campaign_id?: string | null
          created_at?: string
          ended_at?: string | null
          error_code?: string | null
          error_message?: string | null
          id?: string
          max_retries?: number
          metadata?: Json
          operation_name?: string
          player_id?: string | null
          source?: string
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      progression_events: {
        Row: {
          campaign_id: string
          character_id: string
          created_at: string
          event_type: string
          id: string
          payload: Json
        }
        Insert: {
          campaign_id: string
          character_id: string
          created_at?: string
          event_type: string
          id?: string
          payload?: Json
        }
        Update: {
          campaign_id?: string
          character_id?: string
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "progression_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "progression_events_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
        ]
      }
      reputation_events: {
        Row: {
          campaign_id: string
          delta: number
          evidence: Json
          faction_id: string
          id: string
          occurred_at: string
          player_id: string | null
          severity: number
        }
        Insert: {
          campaign_id: string
          delta: number
          evidence?: Json
          faction_id: string
          id?: string
          occurred_at?: string
          player_id?: string | null
          severity?: number
        }
        Update: {
          campaign_id?: string
          delta?: number
          evidence?: Json
          faction_id?: string
          id?: string
          occurred_at?: string
          player_id?: string | null
          severity?: number
        }
        Relationships: [
          {
            foreignKeyName: "reputation_events_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      revenge_arcs: {
        Row: {
          campaign_id: string
          created_at: string
          faction_id: string
          id: string
          nemesis_json: Json
          next_strike_at: string | null
          player_id: string
          status: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          faction_id: string
          id?: string
          nemesis_json: Json
          next_strike_at?: string | null
          player_id: string
          status?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          faction_id?: string
          id?: string
          nemesis_json?: Json
          next_strike_at?: string | null
          player_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenge_arcs_faction_id_fkey"
            columns: ["faction_id"]
            isOneToOne: false
            referencedRelation: "factions"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          campaign_id: string
          character_id: string
          cooldown_turns: number
          cost_json: Json
          counterplay: Json
          created_at: string
          description: string
          effects_json: Json
          id: string
          kind: Database["mythic"]["Enums"]["skill_kind"]
          name: string
          narration_style: string
          range_tiles: number
          scaling_json: Json
          targeting: Database["mythic"]["Enums"]["skill_targeting"]
          targeting_json: Json
          updated_at: string
        }
        Insert: {
          campaign_id: string
          character_id: string
          cooldown_turns?: number
          cost_json?: Json
          counterplay?: Json
          created_at?: string
          description: string
          effects_json?: Json
          id?: string
          kind?: Database["mythic"]["Enums"]["skill_kind"]
          name: string
          narration_style?: string
          range_tiles?: number
          scaling_json?: Json
          targeting?: Database["mythic"]["Enums"]["skill_targeting"]
          targeting_json?: Json
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          character_id?: string
          cooldown_turns?: number
          cost_json?: Json
          counterplay?: Json
          created_at?: string
          description?: string
          effects_json?: Json
          id?: string
          kind?: Database["mythic"]["Enums"]["skill_kind"]
          name?: string
          narration_style?: string
          range_tiles?: number
          scaling_json?: Json
          targeting?: Database["mythic"]["Enums"]["skill_targeting"]
          targeting_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "skills_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "v_character_state_for_dm"
            referencedColumns: ["character_id"]
          },
        ]
      }
      turn_order: {
        Row: {
          combat_session_id: string
          combatant_id: string
          turn_index: number
        }
        Insert: {
          combat_session_id: string
          combatant_id: string
          turn_index: number
        }
        Update: {
          combat_session_id?: string
          combatant_id?: string
          turn_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "turn_order_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turn_order_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
          {
            foreignKeyName: "turn_order_combatant_id_fkey"
            columns: ["combatant_id"]
            isOneToOne: false
            referencedRelation: "combatants"
            referencedColumns: ["id"]
          },
        ]
      }
      ui_turn_flow_rules: {
        Row: {
          created_at: string
          id: string
          name: string
          rules: Json
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          rules: Json
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          rules?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      world_profiles: {
        Row: {
          campaign_id: string
          created_at: string
          seed_description: string
          seed_title: string
          template_key: string
          updated_at: string
          world_profile_json: Json
        }
        Insert: {
          campaign_id: string
          created_at?: string
          seed_description: string
          seed_title: string
          template_key?: string
          updated_at?: string
          world_profile_json?: Json
        }
        Update: {
          campaign_id?: string
          created_at?: string
          seed_description?: string
          seed_title?: string
          template_key?: string
          updated_at?: string
          world_profile_json?: Json
        }
        Relationships: []
      }
    }
    Views: {
      v_board_state_for_dm: {
        Row: {
          active_scene_id: string | null
          board_id: string | null
          board_type: Database["mythic"]["Enums"]["board_type"] | null
          campaign_id: string | null
          combat_session_id: string | null
          recent_transitions: Json | null
          state_json: Json | null
          status: string | null
          ui_hints_json: Json | null
          updated_at: string | null
        }
        Insert: {
          active_scene_id?: string | null
          board_id?: string | null
          board_type?: Database["mythic"]["Enums"]["board_type"] | null
          campaign_id?: string | null
          combat_session_id?: string | null
          recent_transitions?: never
          state_json?: Json | null
          status?: string | null
          ui_hints_json?: Json | null
          updated_at?: string | null
        }
        Update: {
          active_scene_id?: string | null
          board_id?: string | null
          board_type?: Database["mythic"]["Enums"]["board_type"] | null
          campaign_id?: string | null
          combat_session_id?: string | null
          recent_transitions?: never
          state_json?: Json | null
          status?: string | null
          ui_hints_json?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boards_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "combat_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_combat_session_id_fkey"
            columns: ["combat_session_id"]
            isOneToOne: false
            referencedRelation: "v_combat_state_for_dm"
            referencedColumns: ["combat_session_id"]
          },
        ]
      }
      v_character_state_for_dm: {
        Row: {
          base_stats: Json | null
          campaign_id: string | null
          character_id: string | null
          class_json: Json | null
          derived_json: Json | null
          items: Json | null
          level: number | null
          name: string | null
          player_id: string | null
          resources: Json | null
          skills: Json | null
          updated_at: string | null
        }
        Insert: {
          base_stats?: never
          campaign_id?: string | null
          character_id?: string | null
          class_json?: Json | null
          derived_json?: never
          items?: never
          level?: number | null
          name?: string | null
          player_id?: string | null
          resources?: Json | null
          skills?: never
          updated_at?: string | null
        }
        Update: {
          base_stats?: never
          campaign_id?: string | null
          character_id?: string | null
          class_json?: Json | null
          derived_json?: never
          items?: never
          level?: number | null
          name?: string | null
          player_id?: string | null
          resources?: Json | null
          skills?: never
          updated_at?: string | null
        }
        Relationships: []
      }
      v_combat_state_for_dm: {
        Row: {
          campaign_id: string | null
          combat_session_id: string | null
          current_turn_index: number | null
          dm_payload: Json | null
          scene_json: Json | null
          seed: number | null
          status: string | null
        }
        Insert: {
          campaign_id?: string | null
          combat_session_id?: string | null
          current_turn_index?: number | null
          dm_payload?: never
          scene_json?: Json | null
          seed?: number | null
          status?: string | null
        }
        Update: {
          campaign_id?: string | null
          combat_session_id?: string | null
          current_turn_index?: number | null
          dm_payload?: never
          scene_json?: Json | null
          seed?: number | null
          status?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      append_action_event: {
        Args: {
          p_actor_combatant_id: string
          p_combat_session_id: string
          p_event_type: string
          p_payload: Json
          p_turn_index: number
        }
        Returns: string
      }
      apply_xp: {
        Args: {
          p_amount: number
          p_character_id: string
          p_metadata?: Json
          p_reason?: string
        }
        Returns: Json
      }
      armor_rating: {
        Args: { armor_power: number; defense: number; lvl: number }
        Returns: number
      }
      attack_rating: {
        Args: { lvl: number; offense: number; weapon_power: number }
        Returns: number
      }
      clamp_double: {
        Args: { hi: number; lo: number; x: number }
        Returns: number
      }
      compute_character_derived: {
        Args: { character_id: string }
        Returns: Json
      }
      compute_damage: {
        Args: {
          label: string
          lvl: number
          mobility: number
          offense: number
          resist: number
          seed: number
          skill_mult: number
          spread_pct?: number
          utility: number
          weapon_power: number
        }
        Returns: Json
      }
      compute_equipment_mods: { Args: { character_id: string }; Returns: Json }
      contains_forbidden_sexual_content: {
        Args: { txt: string }
        Returns: boolean
      }
      content_is_allowed: { Args: { txt: string }; Returns: boolean }
      crit_chance: {
        Args: { mobility: number; utility: number }
        Returns: number
      }
      crit_mult: { Args: { offense: number; utility: number }; Returns: number }
      end_combat_session: {
        Args: { p_combat_session_id: string; p_outcome?: Json }
        Returns: undefined
      }
      is_in_range: {
        Args: {
          ax: number
          ay: number
          bx: number
          by: number
          metric?: string
          range_tiles: number
        }
        Returns: boolean
      }
      jsonb_num: { Args: { key: string; obj: Json }; Returns: number }
      loadout_slots_for_level: { Args: { lvl: number }; Returns: number }
      loot_budget_points: {
        Args: { r: Database["mythic"]["Enums"]["rarity"] }
        Returns: number
      }
      max_hp: {
        Args: { defense: number; lvl: number; support: number }
        Returns: number
      }
      max_power_bar: {
        Args: { lvl: number; support: number; utility: number }
        Returns: number
      }
      mitigate: {
        Args: { raw_damage: number; resist: number }
        Returns: number
      }
      power_at_level: { Args: { lvl: number }; Returns: number }
      rep_drift: {
        Args: { current_rep: number; drift_per_day?: number }
        Returns: number
      }
      resolve_status_tick: {
        Args: {
          p_combat_session_id: string
          p_combatant_id: string
          p_phase?: string
          p_turn_index: number
        }
        Returns: Json
      }
      rng_int: {
        Args: { hi: number; label: string; lo: number; seed: number }
        Returns: number
      }
      rng_pick: {
        Args: { arr: string[]; label: string; seed: number }
        Returns: string
      }
      rng01: { Args: { label: string; seed: number }; Returns: number }
      start_combat_session: {
        Args: {
          p_campaign_id: string
          p_reason?: string
          p_scene_json: Json
          p_seed: number
        }
        Returns: string
      }
      status_apply_chance: {
        Args: { control: number; target_resolve: number; utility: number }
        Returns: number
      }
      tile_distance: {
        Args: {
          ax: number
          ay: number
          bx: number
          by: number
          metric?: string
        }
        Returns: number
      }
      verify_mythic_weave_installation: { Args: never; Returns: undefined }
      xp_to_next_level: { Args: { lvl: number }; Returns: number }
    }
    Enums: {
      board_type: "town" | "dungeon" | "travel" | "combat"
      item_slot:
        | "weapon"
        | "offhand"
        | "armor"
        | "helm"
        | "gloves"
        | "boots"
        | "belt"
        | "amulet"
        | "ring"
        | "trinket"
        | "consumable"
        | "material"
        | "quest"
        | "other"
      rarity:
        | "common"
        | "magical"
        | "unique"
        | "legendary"
        | "mythic"
        | "unhinged"
      skill_kind: "active" | "passive" | "ultimate" | "crafting" | "life"
      skill_targeting: "self" | "single" | "tile" | "area"
      weapon_family:
        | "blades"
        | "axes"
        | "blunt"
        | "polearms"
        | "ranged"
        | "focus"
        | "body"
        | "absurd"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      abilities: {
        Row: {
          ability_type: string
          area_size: number | null
          character_id: string
          cooldown: number | null
          cost: number | null
          cost_type: string | null
          created_at: string
          damage: string | null
          description: string
          effects: Json | null
          healing: string | null
          id: string
          is_equipped: boolean | null
          name: string
          range: number | null
          targeting_type: string | null
        }
        Insert: {
          ability_type?: string
          area_size?: number | null
          character_id: string
          cooldown?: number | null
          cost?: number | null
          cost_type?: string | null
          created_at?: string
          damage?: string | null
          description: string
          effects?: Json | null
          healing?: string | null
          id?: string
          is_equipped?: boolean | null
          name: string
          range?: number | null
          targeting_type?: string | null
        }
        Update: {
          ability_type?: string
          area_size?: number | null
          character_id?: string
          cooldown?: number | null
          cost?: number | null
          cost_type?: string | null
          created_at?: string
          damage?: string | null
          description?: string
          effects?: Json | null
          healing?: string | null
          id?: string
          is_equipped?: boolean | null
          name?: string
          range?: number | null
          targeting_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "abilities_character_id_fkey"
            columns: ["character_id"]
            isOneToOne: false
            referencedRelation: "characters"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_generated_content: {
        Row: {
          campaign_id: string
          content: Json
          content_id: string
          content_type: string
          created_at: string
          generation_context: Json | null
          id: string
        }
        Insert: {
          campaign_id: string
          content: Json
          content_id: string
          content_type: string
          created_at?: string
          generation_context?: Json | null
          id?: string
        }
        Update: {
          campaign_id?: string
          content?: Json
          content_id?: string
          content_type?: string
          created_at?: string
          generation_context?: Json | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_generated_content_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      app_admins: {
        Row: {
          auth_uid: string
          created_at: string
          owner_id: string | null
        }
        Insert: {
          auth_uid: string
          created_at?: string
          owner_id?: string | null
        }
        Update: {
          auth_uid?: string
          created_at?: string
          owner_id?: string | null
        }
        Relationships: []
      }
      campaign_members: {
        Row: {
          campaign_id: string
          id: string
          is_dm: boolean
          joined_at: string
          user_id: string
        }
        Insert: {
          campaign_id: string
          id?: string
          is_dm?: boolean
          joined_at?: string
          user_id: string
        }
        Update: {
          campaign_id?: string
          id?: string
          is_dm?: boolean
          joined_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_members_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          current_scene: string | null
          description: string | null
          game_state: Json | null
          id: string
          invite_code: string
          is_active: boolean
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_scene?: string | null
          description?: string | null
          game_state?: Json | null
          id?: string
          invite_code?: string
          is_active?: boolean
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_scene?: string | null
          description?: string | null
          game_state?: Json | null
          id?: string
          invite_code?: string
          is_active?: boolean
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      characters: {
        Row: {
          abilities: Json | null
          ac: number
          avatar_url: string | null
          backpack: Json | null
          campaign_id: string
          class: string
          class_description: string | null
          created_at: string
          equipment: Json | null
          hp: number
          id: string
          inventory: Json | null
          is_active: boolean
          level: number
          max_hp: number
          name: string
          passives: Json | null
          position: Json | null
          resources: Json | null
          stats: Json | null
          status_effects: string[] | null
          updated_at: string
          user_id: string
          xp: number
          xp_to_next: number
        }
        Insert: {
          abilities?: Json | null
          ac?: number
          avatar_url?: string | null
          backpack?: Json | null
          campaign_id: string
          class: string
          class_description?: string | null
          created_at?: string
          equipment?: Json | null
          hp?: number
          id?: string
          inventory?: Json | null
          is_active?: boolean
          level?: number
          max_hp?: number
          name: string
          passives?: Json | null
          position?: Json | null
          resources?: Json | null
          stats?: Json | null
          status_effects?: string[] | null
          updated_at?: string
          user_id: string
          xp?: number
          xp_to_next?: number
        }
        Update: {
          abilities?: Json | null
          ac?: number
          avatar_url?: string | null
          backpack?: Json | null
          campaign_id?: string
          class?: string
          class_description?: string | null
          created_at?: string
          equipment?: Json | null
          hp?: number
          id?: string
          inventory?: Json | null
          is_active?: boolean
          level?: number
          max_hp?: number
          name?: string
          passives?: Json | null
          position?: Json | null
          resources?: Json | null
          stats?: Json | null
          status_effects?: string[] | null
          updated_at?: string
          user_id?: string
          xp?: number
          xp_to_next?: number
        }
        Relationships: [
          {
            foreignKeyName: "characters_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          campaign_id: string
          content: string
          created_at: string
          id: string
          message_type: string
          roll_data: Json | null
          user_id: string | null
        }
        Insert: {
          campaign_id: string
          content: string
          created_at?: string
          id?: string
          message_type?: string
          roll_data?: Json | null
          user_id?: string | null
        }
        Update: {
          campaign_id?: string
          content?: string
          created_at?: string
          id?: string
          message_type?: string
          roll_data?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      combat_state: {
        Row: {
          campaign_id: string
          current_turn_index: number
          enemies: Json | null
          id: string
          initiative_order: string[] | null
          is_active: boolean
          round_number: number
          updated_at: string
        }
        Insert: {
          campaign_id: string
          current_turn_index?: number
          enemies?: Json | null
          id?: string
          initiative_order?: string[] | null
          is_active?: boolean
          round_number?: number
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          current_turn_index?: number
          enemies?: Json | null
          id?: string
          initiative_order?: string[] | null
          is_active?: boolean
          round_number?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "combat_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      dm_state: {
        Row: {
          campaign_id: string
          state_json: Json
          updated_at: string
          version: number
        }
        Insert: {
          campaign_id: string
          state_json?: Json
          updated_at?: string
          version?: number
        }
        Update: {
          campaign_id?: string
          state_json?: Json
          updated_at?: string
          version?: number
        }
        Relationships: []
      }
      game_saves: {
        Row: {
          campaign_id: string
          campaign_seed: Json
          created_at: string
          game_state: Json
          id: string
          player_level: number
          playtime_seconds: number
          save_name: string
          total_xp: number
          updated_at: string
          user_id: string
          world_state: Json
        }
        Insert: {
          campaign_id: string
          campaign_seed: Json
          created_at?: string
          game_state: Json
          id?: string
          player_level?: number
          playtime_seconds?: number
          save_name?: string
          total_xp?: number
          updated_at?: string
          user_id: string
          world_state: Json
        }
        Update: {
          campaign_id?: string
          campaign_seed?: Json
          created_at?: string
          game_state?: Json
          id?: string
          player_level?: number
          playtime_seconds?: number
          save_name?: string
          total_xp?: number
          updated_at?: string
          user_id?: string
          world_state?: Json
        }
        Relationships: [
          {
            foreignKeyName: "game_saves_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      grid_state: {
        Row: {
          campaign_id: string
          grid_size: Json
          id: string
          tiles: Json | null
          updated_at: string
        }
        Insert: {
          campaign_id: string
          grid_size?: Json
          id?: string
          tiles?: Json | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          grid_size?: Json
          id?: string
          tiles?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "grid_state_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      items: {
        Row: {
          abilities_granted: Json | null
          created_at: string
          description: string
          effects: Json | null
          id: string
          item_type: string
          name: string
          rarity: string
          slot: string | null
          stat_modifiers: Json | null
          value: number | null
        }
        Insert: {
          abilities_granted?: Json | null
          created_at?: string
          description: string
          effects?: Json | null
          id?: string
          item_type?: string
          name: string
          rarity?: string
          slot?: string | null
          stat_modifiers?: Json | null
          value?: number | null
        }
        Update: {
          abilities_granted?: Json | null
          created_at?: string
          description?: string
          effects?: Json | null
          id?: string
          item_type?: string
          name?: string
          rarity?: string
          slot?: string | null
          stat_modifiers?: Json | null
          value?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      server_nodes: {
        Row: {
          active_campaigns: number
          active_players: number
          campaign_id: string | null
          cpu_usage: number
          created_at: string
          database_latency_ms: number
          id: string
          last_heartbeat: string
          memory_usage: number
          node_name: string
          realtime_connections: number
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          active_campaigns?: number
          active_players?: number
          campaign_id?: string | null
          cpu_usage?: number
          created_at?: string
          database_latency_ms?: number
          id?: string
          last_heartbeat?: string
          memory_usage?: number
          node_name: string
          realtime_connections?: number
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          active_campaigns?: number
          active_players?: number
          campaign_id?: string | null
          cpu_usage?: number
          created_at?: string
          database_latency_ms?: number
          id?: string
          last_heartbeat?: string
          memory_usage?: number
          node_name?: string
          realtime_connections?: number
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "server_nodes_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      world_events: {
        Row: {
          action_text: string
          campaign_id: string
          created_at: string
          delta: Json | null
          id: string
          location_id: string | null
          location_name: string | null
          response_text: string | null
          user_id: string
        }
        Insert: {
          action_text: string
          campaign_id: string
          created_at?: string
          delta?: Json | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          response_text?: string | null
          user_id: string
        }
        Update: {
          action_text?: string
          campaign_id?: string
          created_at?: string
          delta?: Json | null
          id?: string
          location_id?: string | null
          location_name?: string | null
          response_text?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "world_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      mythic_game_rules: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
          rules: Json | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          rules?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          rules?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      mythic_generator_scripts: {
        Row: {
          content: string | null
          created_at: string | null
          id: string | null
          is_active: boolean | null
          name: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
      mythic_ui_turn_flow_rules: {
        Row: {
          created_at: string | null
          id: string | null
          name: string | null
          rules: Json | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          rules?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          name?: string | null
          rules?: Json | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_campaign_by_invite_code: {
        Args: { _invite_code: string }
        Returns: {
          id: string
          name: string
          owner_id: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_app_admin: { Args: { p_uid: string }; Returns: boolean }
      is_campaign_member: {
        Args: { _campaign_id: string; _user_id: string }
        Returns: boolean
      }
      is_campaign_owner: {
        Args: { _campaign_id: string; _user_id: string }
        Returns: boolean
      }
      mythic_append_action_event: {
        Args: {
          actor_combatant_id: string
          combat_session_id: string
          event_type: string
          payload: Json
          turn_index: number
        }
        Returns: string
      }
      mythic_apply_xp: {
        Args: {
          amount: number
          character_id: string
          metadata?: Json
          reason?: string
        }
        Returns: Json
      }
      mythic_compute_damage: {
        Args: {
          label: string
          lvl: number
          mobility: number
          offense: number
          resist: number
          seed: number
          skill_mult: number
          spread_pct?: number
          utility: number
          weapon_power: number
        }
        Returns: Json
      }
      mythic_end_combat_session: {
        Args: { combat_session_id: string; outcome?: Json }
        Returns: undefined
      }
      mythic_loadout_slots_for_level: { Args: { lvl: number }; Returns: number }
      mythic_max_hp: {
        Args: { defense: number; lvl: number; support: number }
        Returns: number
      }
      mythic_max_power_bar: {
        Args: { lvl: number; support: number; utility: number }
        Returns: number
      }
      mythic_power_at_level: { Args: { lvl: number }; Returns: number }
      mythic_resolve_status_tick: {
        Args: {
          combat_session_id: string
          combatant_id: string
          phase?: string
          turn_index: number
        }
        Returns: Json
      }
      mythic_rng_int: {
        Args: { hi: number; label: string; lo: number; seed: number }
        Returns: number
      }
      mythic_rng01: { Args: { label: string; seed: number }; Returns: number }
      mythic_start_combat_session: {
        Args: {
          campaign_id: string
          reason?: string
          scene_json: Json
          seed: number
        }
        Returns: string
      }
      mythic_status_apply_chance: {
        Args: { control: number; target_resolve: number; utility: number }
        Returns: number
      }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  mythic: {
    Enums: {
      board_type: ["town", "dungeon", "travel", "combat"],
      item_slot: [
        "weapon",
        "offhand",
        "armor",
        "helm",
        "gloves",
        "boots",
        "belt",
        "amulet",
        "ring",
        "trinket",
        "consumable",
        "material",
        "quest",
        "other",
      ],
      rarity: [
        "common",
        "magical",
        "unique",
        "legendary",
        "mythic",
        "unhinged",
      ],
      skill_kind: ["active", "passive", "ultimate", "crafting", "life"],
      skill_targeting: ["self", "single", "tile", "area"],
      weapon_family: [
        "blades",
        "axes",
        "blunt",
        "polearms",
        "ranged",
        "focus",
        "body",
        "absurd",
      ],
    },
  },
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
