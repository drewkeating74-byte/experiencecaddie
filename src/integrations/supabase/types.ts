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
      artists: {
        Row: {
          created_at: string
          demographic_fit_score: number | null
          description: string | null
          genre: string | null
          id: string
          image_url: string | null
          name: string
          subgenre: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          demographic_fit_score?: number | null
          description?: string | null
          genre?: string | null
          id?: string
          image_url?: string | null
          name: string
          subgenre?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          demographic_fit_score?: number | null
          description?: string | null
          genre?: string | null
          id?: string
          image_url?: string | null
          name?: string
          subgenre?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          booking_date: string
          created_at: string
          event_date: string | null
          guests: number | null
          id: string
          notes: string | null
          package_id: string
          payment_intent_id: string | null
          status: string
          total_price: number
          updated_at: string
          user_id: string
        }
        Insert: {
          booking_date?: string
          created_at?: string
          event_date?: string | null
          guests?: number | null
          id?: string
          notes?: string | null
          package_id: string
          payment_intent_id?: string | null
          status?: string
          total_price: number
          updated_at?: string
          user_id: string
        }
        Update: {
          booking_date?: string
          created_at?: string
          event_date?: string | null
          guests?: number | null
          id?: string
          notes?: string | null
          package_id?: string
          payment_intent_id?: string | null
          status?: string
          total_price?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      destinations: {
        Row: {
          city: string | null
          country: string | null
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          lat: number | null
          lng: number | null
          name: string
          state: string | null
          updated_at: string
        }
        Insert: {
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          name: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          name?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      events: {
        Row: {
          artist_id: string | null
          availability_status: string | null
          created_at: string
          currency: string | null
          description: string | null
          event_date: string
          event_time: string | null
          id: string
          image_url: string | null
          max_price: number | null
          min_price: number | null
          name: string
          source_id: string | null
          source_name: string | null
          ticket_url: string | null
          timezone: string | null
          updated_at: string
          venue_id: string | null
        }
        Insert: {
          artist_id?: string | null
          availability_status?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          event_date: string
          event_time?: string | null
          id?: string
          image_url?: string | null
          max_price?: number | null
          min_price?: number | null
          name: string
          source_id?: string | null
          source_name?: string | null
          ticket_url?: string | null
          timezone?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Update: {
          artist_id?: string | null
          availability_status?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          event_date?: string
          event_time?: string | null
          id?: string
          image_url?: string | null
          max_price?: number | null
          min_price?: number | null
          name?: string
          source_id?: string | null
          source_name?: string | null
          ticket_url?: string | null
          timezone?: string | null
          updated_at?: string
          venue_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "events_venue_id_fkey"
            columns: ["venue_id"]
            isOneToOne: false
            referencedRelation: "venues"
            referencedColumns: ["id"]
          },
        ]
      }
      golf_courses: {
        Row: {
          address: string | null
          booking_url: string | null
          city: string | null
          country: string | null
          created_at: string
          description: string | null
          destination_id: string | null
          green_fee_max: number | null
          green_fee_min: number | null
          guest_policy: string | null
          holes: number | null
          id: string
          image_url: string | null
          lat: number | null
          lng: number | null
          name: string
          place_id: string | null
          public_access: boolean | null
          rating: number | null
          slope: number | null
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          booking_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          destination_id?: string | null
          green_fee_max?: number | null
          green_fee_min?: number | null
          guest_policy?: string | null
          holes?: number | null
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          name: string
          place_id?: string | null
          public_access?: boolean | null
          rating?: number | null
          slope?: number | null
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          booking_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          destination_id?: string | null
          green_fee_max?: number | null
          green_fee_min?: number | null
          guest_policy?: string | null
          holes?: number | null
          id?: string
          image_url?: string | null
          lat?: number | null
          lng?: number | null
          name?: string
          place_id?: string | null
          public_access?: boolean | null
          rating?: number | null
          slope?: number | null
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "golf_courses_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
      }
      packages: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string
          description: string | null
          destination_id: string | null
          distance_miles: number | null
          drive_time_minutes: number | null
          event_id: string | null
          featured: boolean | null
          golf_course_id: string | null
          id: string
          image_url: string | null
          itinerary_json: Json | null
          name: string
          original_price: number | null
          price: number
          updated_at: string
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string
          description?: string | null
          destination_id?: string | null
          distance_miles?: number | null
          drive_time_minutes?: number | null
          event_id?: string | null
          featured?: boolean | null
          golf_course_id?: string | null
          id?: string
          image_url?: string | null
          itinerary_json?: Json | null
          name: string
          original_price?: number | null
          price: number
          updated_at?: string
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string
          description?: string | null
          destination_id?: string | null
          distance_miles?: number | null
          drive_time_minutes?: number | null
          event_id?: string | null
          featured?: boolean | null
          golf_course_id?: string | null
          id?: string
          image_url?: string | null
          itinerary_json?: Json | null
          name?: string
          original_price?: number | null
          price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "packages_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_golf_course_id_fkey"
            columns: ["golf_course_id"]
            isOneToOne: false
            referencedRelation: "golf_courses"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          first_name: string | null
          id: string
          last_name: string | null
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venues: {
        Row: {
          address: string | null
          capacity: number | null
          city: string | null
          country: string | null
          created_at: string
          destination_id: string | null
          id: string
          lat: number | null
          lng: number | null
          name: string
          state: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          destination_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name: string
          state?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          capacity?: number | null
          city?: string | null
          country?: string | null
          created_at?: string
          destination_id?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          name?: string
          state?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "venues_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "destinations"
            referencedColumns: ["id"]
          },
        ]
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
      app_role: "admin" | "user"
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
      app_role: ["admin", "user"],
    },
  },
} as const
