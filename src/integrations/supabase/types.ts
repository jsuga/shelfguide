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
          author: string
          cover_cache_error: string | null
          cover_cache_status: string | null
          cover_cached_at: string | null
          cover_failed_at: string | null
          cover_source: string | null
          cover_storage_path: string | null
          cover_url: string | null
          created_at: string
          date_read: string | null
          dedupe_key: string | null
          default_library_id: number | null
          description: string | null
          genre: string | null
          goodreads_book_id: string | null
          google_volume_id: string | null
          id: string
          is_first_in_series: boolean | null
          isbn: string | null
          isbn13: string | null
          page_count: number | null
          published_year: number | null
          rating: number | null
          series_name: string | null
          shelf: string | null
          source: string | null
          status: string | null
          thumbnail: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          author: string
          cover_cache_error?: string | null
          cover_cache_status?: string | null
          cover_cached_at?: string | null
          cover_failed_at?: string | null
          cover_source?: string | null
          cover_storage_path?: string | null
          cover_url?: string | null
          created_at?: string
          date_read?: string | null
          dedupe_key?: string | null
          default_library_id?: number | null
          description?: string | null
          genre?: string | null
          goodreads_book_id?: string | null
          google_volume_id?: string | null
          id?: string
          is_first_in_series?: boolean | null
          isbn?: string | null
          isbn13?: string | null
          page_count?: number | null
          published_year?: number | null
          rating?: number | null
          series_name?: string | null
          shelf?: string | null
          source?: string | null
          status?: string | null
          thumbnail?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          author?: string
          cover_cache_error?: string | null
          cover_cache_status?: string | null
          cover_cached_at?: string | null
          cover_failed_at?: string | null
          cover_source?: string | null
          cover_storage_path?: string | null
          cover_url?: string | null
          created_at?: string
          date_read?: string | null
          dedupe_key?: string | null
          default_library_id?: number | null
          description?: string | null
          genre?: string | null
          goodreads_book_id?: string | null
          google_volume_id?: string | null
          id?: string
          is_first_in_series?: boolean | null
          isbn?: string | null
          isbn13?: string | null
          page_count?: number | null
          published_year?: number | null
          rating?: number | null
          series_name?: string | null
          shelf?: string | null
          source?: string | null
          status?: string | null
          thumbnail?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      copilot_feedback: {
        Row: {
          author: string | null
          book_id: string | null
          created_at: string | null
          decision: string
          genre: string | null
          id: string
          note: string | null
          reason: string | null
          tags: string[] | null
          title: string
          user_id: string
        }
        Insert: {
          author?: string | null
          book_id?: string | null
          created_at?: string | null
          decision: string
          genre?: string | null
          id?: string
          note?: string | null
          reason?: string | null
          tags?: string[] | null
          title: string
          user_id: string
        }
        Update: {
          author?: string | null
          book_id?: string | null
          created_at?: string | null
          decision?: string
          genre?: string | null
          id?: string
          note?: string | null
          reason?: string | null
          tags?: string[] | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      copilot_preferences: {
        Row: {
          avoided_genres: string[] | null
          created_at: string | null
          id: string
          notes: string | null
          preferred_formats: string[] | null
          preferred_genres: string[] | null
          preferred_pace: string | null
          rotation_state: Json | null
          ui_theme: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          avoided_genres?: string[] | null
          created_at?: string | null
          id?: string
          notes?: string | null
          preferred_formats?: string[] | null
          preferred_genres?: string[] | null
          preferred_pace?: string | null
          rotation_state?: Json | null
          ui_theme?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          avoided_genres?: string[] | null
          created_at?: string | null
          id?: string
          notes?: string | null
          preferred_formats?: string[] | null
          preferred_genres?: string[] | null
          preferred_pace?: string | null
          rotation_state?: Json | null
          ui_theme?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      copilot_rate_limits: {
        Row: {
          count: number | null
          ip: string | null
          key: string
          updated_at: string | null
          user_id: string | null
          window_start: string | null
        }
        Insert: {
          count?: number | null
          ip?: string | null
          key: string
          updated_at?: string | null
          user_id?: string | null
          window_start?: string | null
        }
        Update: {
          count?: number | null
          ip?: string | null
          key?: string
          updated_at?: string | null
          user_id?: string | null
          window_start?: string | null
        }
        Relationships: []
      }
      copilot_recommendations: {
        Row: {
          author: string | null
          book_id: string | null
          created_at: string | null
          genre: string | null
          id: string
          reasons: string[] | null
          source: string | null
          summary: string | null
          tags: string[] | null
          title: string
          user_id: string
          why_new: string | null
        }
        Insert: {
          author?: string | null
          book_id?: string | null
          created_at?: string | null
          genre?: string | null
          id?: string
          reasons?: string[] | null
          source?: string | null
          summary?: string | null
          tags?: string[] | null
          title: string
          user_id: string
          why_new?: string | null
        }
        Update: {
          author?: string | null
          book_id?: string | null
          created_at?: string | null
          genre?: string | null
          id?: string
          reasons?: string[] | null
          source?: string | null
          summary?: string | null
          tags?: string[] | null
          title?: string
          user_id?: string
          why_new?: string | null
        }
        Relationships: []
      }
      import_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          file_name: string | null
          id: string
          row_count: number | null
          status: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          row_count?: number | null
          status?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          file_name?: string | null
          id?: string
          row_count?: number | null
          status?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string | null
          display_name: string | null
          is_public: boolean | null
          updated_at: string | null
          user_id: string
          username: string
        }
        Insert: {
          created_at?: string | null
          display_name?: string | null
          is_public?: boolean | null
          updated_at?: string | null
          user_id: string
          username: string
        }
        Update: {
          created_at?: string | null
          display_name?: string | null
          is_public?: boolean | null
          updated_at?: string | null
          user_id?: string
          username?: string
        }
        Relationships: []
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
