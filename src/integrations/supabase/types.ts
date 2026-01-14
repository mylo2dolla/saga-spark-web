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
    }
    Views: {
      [_ in never]: never
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
      is_campaign_member: {
        Args: { _campaign_id: string; _user_id: string }
        Returns: boolean
      }
      is_campaign_owner: {
        Args: { _campaign_id: string; _user_id: string }
        Returns: boolean
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
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
    },
  },
} as const
