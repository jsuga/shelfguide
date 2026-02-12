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
      books: {
        Row: {
          id: string
          user_id: string
          title: string
          author: string
          genre: string | null
          series_name: string | null
          is_first_in_series: boolean
          status: string | null
          created_at: string | null
          isbn: string | null
          isbn13: string | null
          rating: number | null
          date_read: string | null
          shelf: string | null
          description: string | null
          page_count: number | null
          thumbnail: string | null
          source: string | null
          dedupe_key: string | null
        }
        Insert: {
          id?: string
          user_id: string
          title: string
          author: string
          genre?: string | null
          series_name?: string | null
          is_first_in_series?: boolean
          status?: string | null
          created_at?: string | null
          isbn?: string | null
          isbn13?: string | null
          rating?: number | null
          date_read?: string | null
          shelf?: string | null
          description?: string | null
          page_count?: number | null
          thumbnail?: string | null
          source?: string | null
          dedupe_key?: string | null
        }
        Update: {
          id?: string
          user_id?: string
          title?: string
          author?: string
          genre?: string | null
          series_name?: string | null
          is_first_in_series?: boolean
          status?: string | null
          created_at?: string | null
          isbn?: string | null
          isbn13?: string | null
          rating?: number | null
          date_read?: string | null
          shelf?: string | null
          description?: string | null
          page_count?: number | null
          thumbnail?: string | null
          source?: string | null
          dedupe_key?: string | null
        }
      }
      profiles: {
        Row: {
          user_id: string
          username: string
          display_name: string | null
          is_public: boolean
          created_at: string | null
        }
        Insert: {
          user_id: string
          username: string
          display_name?: string | null
          is_public?: boolean
          created_at?: string | null
        }
        Update: {
          user_id?: string
          username?: string
          display_name?: string | null
          is_public?: boolean
          created_at?: string | null
        }
      }
      copilot_preferences: {
        Row: {
          user_id: string
          preferred_genres: string[]
          avoided_genres: string[]
          preferred_pace: string | null
          preferred_formats: string[]
          notes: string | null
          ui_theme: string | null
          updated_at: string
        }
        Insert: {
          user_id: string
          preferred_genres?: string[]
          avoided_genres?: string[]
          preferred_pace?: string | null
          preferred_formats?: string[]
          notes?: string | null
          ui_theme?: string | null
          updated_at?: string
        }
        Update: {
          user_id?: string
          preferred_genres?: string[]
          avoided_genres?: string[]
          preferred_pace?: string | null
          preferred_formats?: string[]
          notes?: string | null
          ui_theme?: string | null
          updated_at?: string
        }
      }
      copilot_feedback: {
        Row: {
          id: string
          user_id: string
          book_id: string | null
          title: string
          author: string | null
          genre: string | null
          tags: string[]
          decision: string
          reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          book_id?: string | null
          title: string
          author?: string | null
          genre?: string | null
          tags?: string[]
          decision: string
          reason?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          book_id?: string | null
          title?: string
          author?: string | null
          genre?: string | null
          tags?: string[]
          decision?: string
          reason?: string | null
          created_at?: string
        }
      }
      copilot_recommendations: {
        Row: {
          id: string
          user_id: string
          book_id: string | null
          title: string
          author: string | null
          genre: string | null
          tags: string[]
          summary: string | null
          source: string | null
          reasons: string[]
          why_new: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          book_id?: string | null
          title: string
          author?: string | null
          genre?: string | null
          tags?: string[]
          summary?: string | null
          source?: string | null
          reasons?: string[]
          why_new?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          book_id?: string | null
          title?: string
          author?: string | null
          genre?: string | null
          tags?: string[]
          summary?: string | null
          source?: string | null
          reasons?: string[]
          why_new?: string | null
          created_at?: string
        }
      }
      copilot_rate_limits: {
        Row: {
          id: string
          key: string
          user_id: string | null
          ip: string | null
          window_start: string
          count: number
          updated_at: string
        }
        Insert: {
          id?: string
          key: string
          user_id?: string | null
          ip?: string | null
          window_start: string
          count?: number
          updated_at?: string
        }
        Update: {
          id?: string
          key?: string
          user_id?: string | null
          ip?: string | null
          window_start?: string
          count?: number
          updated_at?: string
        }
      }
      import_logs: {
        Row: {
          id: string
          user_id: string
          source: string
          added_count: number
          updated_count: number
          failed_count: number
          failures: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          source: string
          added_count?: number
          updated_count?: number
          failed_count?: number
          failures?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          source?: string
          added_count?: number
          updated_count?: number
          failed_count?: number
          failures?: Json | null
          created_at?: string
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
