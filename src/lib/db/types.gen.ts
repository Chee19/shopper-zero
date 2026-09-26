export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      agent_requests: {
        Row: {
          agent_profile: string | null
          created_at: string
          id: number
          store_id: string | null
          surface: string
          tool: string | null
          user_agent: string | null
        }
        Insert: {
          agent_profile?: string | null
          created_at?: string
          id?: never
          store_id?: string | null
          surface: string
          tool?: string | null
          user_agent?: string | null
        }
        Update: {
          agent_profile?: string | null
          created_at?: string
          id?: never
          store_id?: string | null
          surface?: string
          tool?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_requests_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      checkout_events: {
        Row: {
          checkout_id: string
          created_at: string
          data: Json
          from_state: string | null
          id: number
          message: string | null
          to_state: string
        }
        Insert: {
          checkout_id: string
          created_at?: string
          data?: Json
          from_state?: string | null
          id?: never
          message?: string | null
          to_state: string
        }
        Update: {
          checkout_id?: string
          created_at?: string
          data?: Json
          from_state?: string | null
          id?: never
          message?: string | null
          to_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkout_events_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: false
            referencedRelation: "checkouts"
            referencedColumns: ["id"]
          },
        ]
      }
      checkouts: {
        Row: {
          agent_profile: string | null
          buyer: Json | null
          connector: string
          connector_state: Json
          continue_url: string | null
          created_at: string
          currency: string | null
          error: Json | null
          expires_at: string | null
          fulfillment: Json | null
          id: string
          idempotency_key: string | null
          line_items: Json
          messages: Json
          payment: Json
          state: string
          store_id: string
          total_minor: number | null
          totals: Json
          updated_at: string
        }
        Insert: {
          agent_profile?: string | null
          buyer?: Json | null
          connector: string
          connector_state?: Json
          continue_url?: string | null
          created_at?: string
          currency?: string | null
          error?: Json | null
          expires_at?: string | null
          fulfillment?: Json | null
          id?: string
          idempotency_key?: string | null
          line_items: Json
          messages?: Json
          payment?: Json
          state?: string
          store_id: string
          total_minor?: number | null
          totals?: Json
          updated_at?: string
        }
        Update: {
          agent_profile?: string | null
          buyer?: Json | null
          connector?: string
          connector_state?: Json
          continue_url?: string | null
          created_at?: string
          currency?: string | null
          error?: Json | null
          expires_at?: string | null
          fulfillment?: Json | null
          id?: string
          idempotency_key?: string | null
          line_items?: Json
          messages?: Json
          payment?: Json
          state?: string
          store_id?: string
          total_minor?: number | null
          totals?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checkouts_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      crawl_runs: {
        Row: {
          created_at: string
          error: string | null
          finished_at: string | null
          id: string
          log: Json
          pages_failed: number
          pages_fetched: number
          products_found: number
          started_at: string | null
          status: string
          store_id: string
          strategy: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          pages_failed?: number
          pages_fetched?: number
          products_found?: number
          started_at?: string | null
          status?: string
          store_id: string
          strategy?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          error?: string | null
          finished_at?: string | null
          id?: string
          log?: Json
          pages_failed?: number
          pages_fetched?: number
          products_found?: number
          started_at?: string | null
          status?: string
          store_id?: string
          strategy?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crawl_runs_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          amount_minor: number
          checkout_id: string
          created_at: string
          currency: string
          id: string
          merchant_order_id: string | null
          merchant_order_url: string | null
          payer: string | null
          payment_reference: string | null
          rail: string
          status: string
          store_id: string
          updated_at: string
        }
        Insert: {
          amount_minor: number
          checkout_id: string
          created_at?: string
          currency: string
          id?: string
          merchant_order_id?: string | null
          merchant_order_url?: string | null
          payer?: string | null
          payment_reference?: string | null
          rail: string
          status: string
          store_id: string
          updated_at?: string
        }
        Update: {
          amount_minor?: number
          checkout_id?: string
          created_at?: string
          currency?: string
          id?: string
          merchant_order_id?: string | null
          merchant_order_url?: string | null
          payer?: string | null
          payment_reference?: string | null
          rail?: string
          status?: string
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_checkout_id_fkey"
            columns: ["checkout_id"]
            isOneToOne: true
            referencedRelation: "checkouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          availability: string
          available: boolean
          checked_at: string
          compare_at_minor: number | null
          created_at: string
          currency: string
          external_id: string
          gtin: string | null
          id: string
          image_url: string | null
          inventory_quantity: number | null
          options: Json
          position: number
          price_minor: number
          product_id: string
          seq: number
          sku: string | null
          store_id: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          availability?: string
          available?: boolean
          checked_at?: string
          compare_at_minor?: number | null
          created_at?: string
          currency: string
          external_id: string
          gtin?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          options?: Json
          position?: number
          price_minor: number
          product_id: string
          seq?: never
          sku?: string | null
          store_id: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          availability?: string
          available?: boolean
          checked_at?: string
          compare_at_minor?: number | null
          created_at?: string
          currency?: string
          external_id?: string
          gtin?: string | null
          id?: string
          image_url?: string | null
          inventory_quantity?: number | null
          options?: Json
          position?: number
          price_minor?: number
          product_id?: string
          seq?: never
          sku?: string | null
          store_id?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          availability: string | null
          available: boolean
          brand: string | null
          category: string | null
          content_hash: string | null
          created_at: string
          currency: string | null
          description: string | null
          description_html: string | null
          external_id: string | null
          fts: unknown
          gtin: string | null
          handle: string
          id: string
          images: string[]
          last_seen_at: string | null
          options: Json
          price: number | null
          price_max_minor: number | null
          price_min_minor: number | null
          product_type: string | null
          raw: Json
          seq: number
          source: string | null
          store_id: string
          tags: string[]
          title: string
          updated_at: string
          url: string
          variants: Json
        }
        Insert: {
          availability?: string | null
          available?: boolean
          brand?: string | null
          category?: string | null
          content_hash?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          description_html?: string | null
          external_id?: string | null
          fts?: unknown
          gtin?: string | null
          handle: string
          id?: string
          images?: string[]
          last_seen_at?: string | null
          options?: Json
          price?: number | null
          price_max_minor?: number | null
          price_min_minor?: number | null
          product_type?: string | null
          raw?: Json
          seq?: never
          source?: string | null
          store_id: string
          tags?: string[]
          title: string
          updated_at?: string
          url: string
          variants?: Json
        }
        Update: {
          availability?: string | null
          available?: boolean
          brand?: string | null
          category?: string | null
          content_hash?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          description_html?: string | null
          external_id?: string | null
          fts?: unknown
          gtin?: string | null
          handle?: string
          id?: string
          images?: string[]
          last_seen_at?: string | null
          options?: Json
          price?: number | null
          price_max_minor?: number | null
          price_min_minor?: number | null
          product_type?: string | null
          raw?: Json
          seq?: never
          source?: string | null
          store_id?: string
          tags?: string[]
          title?: string
          updated_at?: string
          url?: string
          variants?: Json
        }
        Relationships: [
          {
            foreignKeyName: "products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      scans: {
        Row: {
          after: Json | null
          best_method: string
          checks: Json
          created_at: string
          grade: string
          id: string
          mode: string
          platform: string
          probes: Json
          recommendations: Json
          score: number
          status: string
          store_id: string
          updated_at: string
          url: string
        }
        Insert: {
          after?: Json | null
          best_method?: string
          checks?: Json
          created_at?: string
          grade?: string
          id?: string
          mode?: string
          platform?: string
          probes?: Json
          recommendations?: Json
          score?: number
          status?: string
          store_id: string
          updated_at?: string
          url: string
        }
        Update: {
          after?: Json | null
          best_method?: string
          checks?: Json
          created_at?: string
          grade?: string
          id?: string
          mode?: string
          platform?: string
          probes?: Json
          recommendations?: Json
          score?: number
          status?: string
          store_id?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "scans_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_claims: {
        Row: {
          created_at: string
          method: string
          store_id: string
          token: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          method: string
          store_id: string
          token: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          method?: string
          store_id?: string
          token?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_claims_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          base_url: string
          best_method: string | null
          checkout_connector: string
          checkout_methods: string[]
          claimed_at: string | null
          country: string | null
          created_at: string
          currency: string | null
          dom_recipe: Json | null
          domain: string
          id: string
          last_crawled_at: string | null
          latest_scan_id: string | null
          metadata: Json
          name: string | null
          opted_out: boolean
          platform: string | null
          product_count: number
          readiness: Json
          seq: number
          slug: string
          status: string
          strategy: Json | null
          updated_at: string
        }
        Insert: {
          base_url: string
          best_method?: string | null
          checkout_connector?: string
          checkout_methods?: string[]
          claimed_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          dom_recipe?: Json | null
          domain: string
          id?: string
          last_crawled_at?: string | null
          latest_scan_id?: string | null
          metadata?: Json
          name?: string | null
          opted_out?: boolean
          platform?: string | null
          product_count?: number
          readiness?: Json
          seq?: never
          slug: string
          status?: string
          strategy?: Json | null
          updated_at?: string
        }
        Update: {
          base_url?: string
          best_method?: string | null
          checkout_connector?: string
          checkout_methods?: string[]
          claimed_at?: string | null
          country?: string | null
          created_at?: string
          currency?: string | null
          dom_recipe?: Json | null
          domain?: string
          id?: string
          last_crawled_at?: string | null
          latest_scan_id?: string | null
          metadata?: Json
          name?: string | null
          opted_out?: boolean
          platform?: string | null
          product_count?: number
          readiness?: Json
          seq?: never
          slug?: string
          status?: string
          strategy?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_latest_scan_id_fkey"
            columns: ["latest_scan_id"]
            isOneToOne: false
            referencedRelation: "scans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_public_metrics: { Args: never; Returns: Json }
      immutable_array_to_string: {
        Args: { arr: string[]; sep: string }
        Returns: string
      }
      search_products: {
        Args: {
          match_count?: number
          match_offset?: number
          p_available?: boolean
          p_brands?: string[]
          p_categories?: string[]
          p_currency?: string
          p_max_minor?: number
          p_min_minor?: number
          p_store_id?: string
          query_embedding?: string
          query_text?: string
        }
        Returns: {
          id: string
          score: number
          total_count: number
        }[]
      }
      upsert_product_batch: {
        Args: { p_products: Json; p_seen_at?: string; p_store_id: string }
        Returns: {
          error: string
          handle: string
          product_id: string
          status: string
          variant_count: number
        }[]
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

