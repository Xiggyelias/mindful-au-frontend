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
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      ai_diagnostics: {
        Row: {
          anxiety_level: number | null
          created_at: string
          depression_level: number | null
          id: string
          insights: string | null
          mood: string | null
          recommendations: string | null
          risk_level: string | null
          session_id: string | null
          stress_level: number | null
          student_id: string
        }
        Insert: {
          anxiety_level?: number | null
          created_at?: string
          depression_level?: number | null
          id?: string
          insights?: string | null
          mood?: string | null
          recommendations?: string | null
          risk_level?: string | null
          session_id?: string | null
          stress_level?: number | null
          student_id: string
        }
        Update: {
          anxiety_level?: number | null
          created_at?: string
          depression_level?: number | null
          id?: string
          insights?: string | null
          mood?: string | null
          recommendations?: string | null
          risk_level?: string | null
          session_id?: string | null
          stress_level?: number | null
          student_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_diagnostics_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          counselor_id: string
          created_at: string
          duration_minutes: number | null
          id: string
          notes: string | null
          scheduled_at: string
          status: string | null
          student_id: string
        }
        Insert: {
          counselor_id: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          notes?: string | null
          scheduled_at: string
          status?: string | null
          student_id: string
        }
        Update: {
          counselor_id?: string
          created_at?: string
          duration_minutes?: number | null
          id?: string
          notes?: string | null
          scheduled_at?: string
          status?: string | null
          student_id?: string
        }
        Relationships: []
      }
      counselor_wellness_logs: {
        Row: {
          burnout_index: number | null
          counselor_id: string
          created_at: string
          id: string
          mood_score: number | null
          notes: string | null
          recommendations: string | null
          stress_level: number | null
        }
        Insert: {
          burnout_index?: number | null
          counselor_id: string
          created_at?: string
          id?: string
          mood_score?: number | null
          notes?: string | null
          recommendations?: string | null
          stress_level?: number | null
        }
        Update: {
          burnout_index?: number | null
          counselor_id?: string
          created_at?: string
          id?: string
          mood_score?: number | null
          notes?: string | null
          recommendations?: string | null
          stress_level?: number | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          content: string
          created_at: string
          file_url: string | null
          id: string
          is_encrypted: boolean | null
          message_type: string | null
          sender_id: string
          session_id: string
        }
        Insert: {
          content: string
          created_at?: string
          file_url?: string | null
          id?: string
          is_encrypted?: boolean | null
          message_type?: string | null
          sender_id: string
          session_id: string
        }
        Update: {
          content?: string
          created_at?: string
          file_url?: string | null
          id?: string
          is_encrypted?: boolean | null
          message_type?: string | null
          sender_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string
          read: boolean | null
          title: string
          type: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          read?: boolean | null
          title: string
          type?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string
        }
        Relationships: []
      }
      panic_logs: {
        Row: {
          created_at: string
          id: string
          location: string | null
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
          student_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          location?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          student_id: string
        }
        Update: {
          created_at?: string
          id?: string
          location?: string | null
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
          student_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          anonymous_mode: boolean | null
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          id_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          anonymous_mode?: boolean | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          id_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          anonymous_mode?: boolean | null
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          id_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      sessions: {
        Row: {
          ai_summary: string | null
          counselor_id: string | null
          created_at: string
          ended_at: string | null
          id: string
          notes: string | null
          session_type: string | null
          started_at: string | null
          status: string | null
          student_id: string
        }
        Insert: {
          ai_summary?: string | null
          counselor_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          notes?: string | null
          session_type?: string | null
          started_at?: string | null
          status?: string | null
          student_id: string
        }
        Update: {
          ai_summary?: string | null
          counselor_id?: string | null
          created_at?: string
          ended_at?: string | null
          id?: string
          notes?: string | null
          session_type?: string | null
          started_at?: string | null
          status?: string | null
          student_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          approved: boolean | null
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          approved?: boolean | null
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          approved?: boolean | null
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "counselor" | "student"
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
      app_role: ["admin", "counselor", "student"],
    },
  },
} as const
