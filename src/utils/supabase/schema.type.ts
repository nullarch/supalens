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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          channel: string | null
          cost_usd: number
          created_at: string
          data_source_id: string | null
          ended_at: string | null
          error: string | null
          id: string
          org_id: string
          question: string
          result: Json | null
          share_token: string | null
          status: Database["public"]["Enums"]["agent_run_status"]
          tokens_in: number
          tokens_out: number
          trigger_run_id: string | null
          turns: number
          user_id: string | null
        }
        Insert: {
          channel?: string | null
          cost_usd?: number
          created_at?: string
          data_source_id?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          org_id: string
          question: string
          result?: Json | null
          share_token?: string | null
          status?: Database["public"]["Enums"]["agent_run_status"]
          tokens_in?: number
          tokens_out?: number
          trigger_run_id?: string | null
          turns?: number
          user_id?: string | null
        }
        Update: {
          channel?: string | null
          cost_usd?: number
          created_at?: string
          data_source_id?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          org_id?: string
          question?: string
          result?: Json | null
          share_token?: string | null
          status?: Database["public"]["Enums"]["agent_run_status"]
          tokens_in?: number
          tokens_out?: number
          trigger_run_id?: string | null
          turns?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_events: {
        Row: {
          ack_kind: string | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          alert_id: string
          cause_correction: string | null
          cause_feedback: string | null
          created_at: string
          explained: boolean
          explanation: string | null
          explanation_run_id: string | null
          id: string
          kind: string
          message: string | null
          notified: boolean
          org_id: string
          value: number | null
        }
        Insert: {
          ack_kind?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id: string
          cause_correction?: string | null
          cause_feedback?: string | null
          created_at?: string
          explained?: boolean
          explanation?: string | null
          explanation_run_id?: string | null
          id?: string
          kind: string
          message?: string | null
          notified?: boolean
          org_id: string
          value?: number | null
        }
        Update: {
          ack_kind?: string | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          alert_id?: string
          cause_correction?: string | null
          cause_feedback?: string | null
          created_at?: string
          explained?: boolean
          explanation?: string | null
          explanation_run_id?: string | null
          id?: string
          kind?: string
          message?: string | null
          notified?: boolean
          org_id?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_events_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_alert_id_fkey"
            columns: ["alert_id"]
            isOneToOne: false
            referencedRelation: "alerts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          condition: Json | null
          consecutive_fires: number
          cooldown_seconds: number
          created_at: string
          created_by: string | null
          data_source_id: string
          deleted_at: string | null
          description: string | null
          enabled: boolean
          fire_threshold: number
          goal: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_fired_at: string | null
          last_notified_at: string | null
          last_value: number | null
          metric_sql: string
          name: string
          operator: Database["public"]["Enums"]["alert_op"]
          org_id: string
          saved_query_id: string | null
          sensitivity: number | null
          snoozed_until: string | null
          status: Database["public"]["Enums"]["alert_status"]
          threshold: number
          type: Database["public"]["Enums"]["alert_type"]
          updated_at: string
        }
        Insert: {
          condition?: Json | null
          consecutive_fires?: number
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          data_source_id: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          fire_threshold?: number
          goal?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_fired_at?: string | null
          last_notified_at?: string | null
          last_value?: number | null
          metric_sql: string
          name: string
          operator: Database["public"]["Enums"]["alert_op"]
          org_id: string
          saved_query_id?: string | null
          sensitivity?: number | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          threshold: number
          type?: Database["public"]["Enums"]["alert_type"]
          updated_at?: string
        }
        Update: {
          condition?: Json | null
          consecutive_fires?: number
          cooldown_seconds?: number
          created_at?: string
          created_by?: string | null
          data_source_id?: string
          deleted_at?: string | null
          description?: string | null
          enabled?: boolean
          fire_threshold?: number
          goal?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_fired_at?: string | null
          last_notified_at?: string | null
          last_value?: number | null
          metric_sql?: string
          name?: string
          operator?: Database["public"]["Enums"]["alert_op"]
          org_id?: string
          saved_query_id?: string | null
          sensitivity?: number | null
          snoozed_until?: string | null
          status?: Database["public"]["Enums"]["alert_status"]
          threshold?: number
          type?: Database["public"]["Enums"]["alert_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alerts_saved_query_id_fkey"
            columns: ["saved_query_id"]
            isOneToOne: false
            referencedRelation: "saved_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          kind: string
          last_four: string | null
          last_used_at: string | null
          org_id: string
          prefix: string
          revoked_at: string | null
          scopes: string[]
          token_hash: string
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          last_four?: string | null
          last_used_at?: string | null
          org_id: string
          prefix: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash: string
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          kind?: string
          last_four?: string | null
          last_used_at?: string | null
          org_id?: string
          prefix?: string
          revoked_at?: string | null
          scopes?: string[]
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          at: string
          diff: Json | null
          entity: string
          entity_id: string | null
          id: number
          org_id: string
          request_id: string | null
          source_ip: unknown
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind?: string
          at?: string
          diff?: Json | null
          entity: string
          entity_id?: string | null
          id?: never
          org_id: string
          request_id?: string | null
          source_ip?: unknown
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          at?: string
          diff?: Json | null
          entity?: string
          entity_id?: string | null
          id?: never
          org_id?: string
          request_id?: string | null
          source_ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_transactions: {
        Row: {
          amount_cents: number | null
          billed_at: string | null
          created_at: string
          currency: string | null
          id: string
          org_id: string
          paddle_subscription_id: string | null
          paddle_transaction_id: string
          status: string | null
        }
        Insert: {
          amount_cents?: number | null
          billed_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id: string
          paddle_subscription_id?: string | null
          paddle_transaction_id: string
          status?: string | null
        }
        Update: {
          amount_cents?: number | null
          billed_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          org_id?: string
          paddle_subscription_id?: string | null
          paddle_transaction_id?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      code_analysis_runs: {
        Row: {
          after_sha: string | null
          before_sha: string | null
          cost_usd: number
          created_at: string
          data_source_id: string | null
          ended_at: string | null
          error: string | null
          id: string
          kind: string
          org_id: string
          ref: string | null
          repo_id: string | null
          result: Json | null
          status: Database["public"]["Enums"]["code_run_status"]
          tokens_in: number
          tokens_out: number
          trigger_run_id: string | null
          turns: number
          user_id: string | null
        }
        Insert: {
          after_sha?: string | null
          before_sha?: string | null
          cost_usd?: number
          created_at?: string
          data_source_id?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          kind?: string
          org_id: string
          ref?: string | null
          repo_id?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["code_run_status"]
          tokens_in?: number
          tokens_out?: number
          trigger_run_id?: string | null
          turns?: number
          user_id?: string | null
        }
        Update: {
          after_sha?: string | null
          before_sha?: string | null
          cost_usd?: number
          created_at?: string
          data_source_id?: string | null
          ended_at?: string | null
          error?: string | null
          id?: string
          kind?: string
          org_id?: string
          ref?: string | null
          repo_id?: string | null
          result?: Json | null
          status?: Database["public"]["Enums"]["code_run_status"]
          tokens_in?: number
          tokens_out?: number
          trigger_run_id?: string | null
          turns?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "code_analysis_runs_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analysis_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analysis_runs_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "github_repositories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "code_analysis_runs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_agent_attribution: {
        Row: {
          campaign_id: string | null
          captured_at: string
          created_at: string
          org_id: string
          variant_id: string
        }
        Insert: {
          campaign_id?: string | null
          captured_at: string
          created_at?: string
          org_id: string
          variant_id: string
        }
        Update: {
          campaign_id?: string | null
          captured_at?: string
          created_at?: string
          org_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_agent_attribution_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      content_agent_outbox: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_id: string
          failed_at: string | null
          id: string
          last_error: string | null
          name: string
          next_attempt_at: string
          org_id: string | null
          payload: Json
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_id: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          name: string
          next_attempt_at?: string
          org_id?: string | null
          payload: Json
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_id?: string
          failed_at?: string | null
          id?: string
          last_error?: string | null
          name?: string
          next_attempt_at?: string
          org_id?: string | null
          payload?: Json
        }
        Relationships: []
      }
      credential_revocations: {
        Row: {
          attempts: number
          completed_at: string | null
          connection_id: string | null
          created_at: string
          id: string
          kind: string
          last_error: string | null
          org_id: string
          payload: Json | null
          secret_id: string | null
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string
          id?: string
          kind: string
          last_error?: string | null
          org_id: string
          payload?: Json | null
          secret_id?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          connection_id?: string | null
          created_at?: string
          id?: string
          kind?: string
          last_error?: string | null
          org_id?: string
          payload?: Json | null
          secret_id?: string | null
          status?: string
        }
        Relationships: []
      }
      dashboard_widgets: {
        Row: {
          created_at: string
          dashboard_id: string
          data_source_id: string | null
          deleted_at: string | null
          h: number
          id: string
          org_id: string
          position: number
          refresh_interval: number | null
          sample: Json | null
          saved_query_id: string | null
          spec: Json
          updated_at: string
          w: number
          x: number
          y: number
        }
        Insert: {
          created_at?: string
          dashboard_id: string
          data_source_id?: string | null
          deleted_at?: string | null
          h?: number
          id?: string
          org_id: string
          position?: number
          refresh_interval?: number | null
          sample?: Json | null
          saved_query_id?: string | null
          spec: Json
          updated_at?: string
          w?: number
          x?: number
          y?: number
        }
        Update: {
          created_at?: string
          dashboard_id?: string
          data_source_id?: string | null
          deleted_at?: string | null
          h?: number
          id?: string
          org_id?: string
          position?: number
          refresh_interval?: number | null
          sample?: Json | null
          saved_query_id?: string | null
          spec?: Json
          updated_at?: string
          w?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_dashboard_id_fkey"
            columns: ["dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_saved_query_id_fkey"
            columns: ["saved_query_id"]
            isOneToOne: false
            referencedRelation: "saved_queries"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          name: string
          org_id: string
          pinned: boolean
          position: number
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name: string
          org_id: string
          pinned?: boolean
          position?: number
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          name?: string
          org_id?: string
          pinned?: boolean
          position?: number
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboards_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboards_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_encryption_keys: {
        Row: {
          algo: string
          created_at: string
          destroyed_at: string | null
          id: string
          kek_provider: string
          kek_uri: string
          org_id: string
          rotated_at: string | null
          state: string
          wrapped_dek: string
        }
        Insert: {
          algo?: string
          created_at?: string
          destroyed_at?: string | null
          id: string
          kek_provider: string
          kek_uri: string
          org_id: string
          rotated_at?: string | null
          state?: string
          wrapped_dek: string
        }
        Update: {
          algo?: string
          created_at?: string
          destroyed_at?: string | null
          id?: string
          kek_provider?: string
          kek_uri?: string
          org_id?: string
          rotated_at?: string | null
          state?: string
          wrapped_dek?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_encryption_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_context: {
        Row: {
          content_md: string | null
          created_at: string
          data_source_id: string
          error: string | null
          generated_at: string | null
          generated_by: string | null
          generated_from_sha: string | null
          model: string | null
          org_id: string
          schema_hash: string | null
          source_repo_id: string | null
          status: Database["public"]["Enums"]["context_status"]
          token_estimate: number | null
          updated_at: string
        }
        Insert: {
          content_md?: string | null
          created_at?: string
          data_source_id: string
          error?: string | null
          generated_at?: string | null
          generated_by?: string | null
          generated_from_sha?: string | null
          model?: string | null
          org_id: string
          schema_hash?: string | null
          source_repo_id?: string | null
          status?: Database["public"]["Enums"]["context_status"]
          token_estimate?: number | null
          updated_at?: string
        }
        Update: {
          content_md?: string | null
          created_at?: string
          data_source_id?: string
          error?: string | null
          generated_at?: string | null
          generated_by?: string | null
          generated_from_sha?: string | null
          model?: string | null
          org_id?: string
          schema_hash?: string | null
          source_repo_id?: string | null
          status?: Database["public"]["Enums"]["context_status"]
          token_estimate?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_context_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: true
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_context_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_context_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_source_context_source_repo_id_fkey"
            columns: ["source_repo_id"]
            isOneToOne: false
            referencedRelation: "github_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_objects: {
        Row: {
          approx_row_count: number | null
          columns: Json
          data_source_id: string
          id: string
          introspected_at: string
          object_name: string
          object_type: string
          primary_key: string[] | null
          schema_name: string
          stats_synced_at: string | null
        }
        Insert: {
          approx_row_count?: number | null
          columns: Json
          data_source_id: string
          id?: string
          introspected_at?: string
          object_name: string
          object_type: string
          primary_key?: string[] | null
          schema_name: string
          stats_synced_at?: string | null
        }
        Update: {
          approx_row_count?: number | null
          columns?: Json
          data_source_id?: string
          id?: string
          introspected_at?: string
          object_name?: string
          object_type?: string
          primary_key?: string[] | null
          schema_name?: string
          stats_synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_source_objects_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_schemas: {
        Row: {
          content_hash: string | null
          data_source_id: string
          error: string | null
          object_count: number | null
          status: Database["public"]["Enums"]["introspection_status"]
          synced_at: string | null
          updated_at: string
        }
        Insert: {
          content_hash?: string | null
          data_source_id: string
          error?: string | null
          object_count?: number | null
          status?: Database["public"]["Enums"]["introspection_status"]
          synced_at?: string | null
          updated_at?: string
        }
        Update: {
          content_hash?: string | null
          data_source_id?: string
          error?: string | null
          object_count?: number | null
          status?: Database["public"]["Enums"]["introspection_status"]
          synced_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_source_schemas_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: true
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          config: Json
          connection_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          engine: Database["public"]["Enums"]["ds_engine"]
          id: string
          is_demo: boolean
          last_connected_at: string | null
          last_error_code: string | null
          last_error_redacted: string | null
          name: string
          org_id: string
          provider: Database["public"]["Enums"]["ds_provider"]
          repo_id: string | null
          status: Database["public"]["Enums"]["ds_status"]
          updated_at: string
        }
        Insert: {
          config?: Json
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          engine: Database["public"]["Enums"]["ds_engine"]
          id?: string
          is_demo?: boolean
          last_connected_at?: string | null
          last_error_code?: string | null
          last_error_redacted?: string | null
          name: string
          org_id: string
          provider?: Database["public"]["Enums"]["ds_provider"]
          repo_id?: string | null
          status?: Database["public"]["Enums"]["ds_status"]
          updated_at?: string
        }
        Update: {
          config?: Json
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          engine?: Database["public"]["Enums"]["ds_engine"]
          id?: string
          is_demo?: boolean
          last_connected_at?: string | null
          last_error_code?: string | null
          last_error_redacted?: string | null
          name?: string
          org_id?: string
          provider?: Database["public"]["Enums"]["ds_provider"]
          repo_id?: string | null
          status?: Database["public"]["Enums"]["ds_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_connection_fk"
            columns: ["connection_id", "org_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "data_sources_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_sources_repo_id_fkey"
            columns: ["repo_id"]
            isOneToOne: false
            referencedRelation: "github_repositories"
            referencedColumns: ["id"]
          },
        ]
      }
      demo_requests: {
        Row: {
          cookie_id: string
          created_at: string
          id: string
          ip_hash: string
          question: string
          run_id: string | null
        }
        Insert: {
          cookie_id: string
          created_at?: string
          id?: string
          ip_hash: string
          question: string
          run_id?: string | null
        }
        Update: {
          cookie_id?: string
          created_at?: string
          id?: string
          ip_hash?: string
          question?: string
          run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_requests_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      github_repositories: {
        Row: {
          analysis_enabled: boolean
          clone_url: string | null
          connection_id: string
          created_at: string
          created_by: string | null
          default_branch: string
          deleted_at: string | null
          full_name: string
          github_repo_id: number
          id: string
          is_private: boolean
          last_pushed_at: string | null
          last_synced_sha: string | null
          org_id: string
          sparse_paths: string[] | null
          status: string
          updated_at: string
        }
        Insert: {
          analysis_enabled?: boolean
          clone_url?: string | null
          connection_id: string
          created_at?: string
          created_by?: string | null
          default_branch?: string
          deleted_at?: string | null
          full_name: string
          github_repo_id: number
          id?: string
          is_private?: boolean
          last_pushed_at?: string | null
          last_synced_sha?: string | null
          org_id: string
          sparse_paths?: string[] | null
          status?: string
          updated_at?: string
        }
        Update: {
          analysis_enabled?: boolean
          clone_url?: string | null
          connection_id?: string
          created_at?: string
          created_by?: string | null
          default_branch?: string
          deleted_at?: string | null
          full_name?: string
          github_repo_id?: number
          id?: string
          is_private?: boolean
          last_pushed_at?: string | null
          last_synced_sha?: string | null
          org_id?: string
          sparse_paths?: string[] | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_repositories_connection_fk"
            columns: ["connection_id", "org_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "github_repositories_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "github_repositories_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      github_webhook_events: {
        Row: {
          created_at: string
          delivery_id: string
          event_type: string
          id: string
          installation_id: number | null
          org_id: string | null
          repo_full_name: string | null
          run_id: string | null
          status: string
        }
        Insert: {
          created_at?: string
          delivery_id: string
          event_type: string
          id?: string
          installation_id?: number | null
          org_id?: string | null
          repo_full_name?: string | null
          run_id?: string | null
          status?: string
        }
        Update: {
          created_at?: string
          delivery_id?: string
          event_type?: string
          id?: string
          installation_id?: number | null
          org_id?: string | null
          repo_full_name?: string | null
          run_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "github_webhook_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "code_analysis_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_catalog: {
        Row: {
          alert_config: Json | null
          applied: Json | null
          category: string
          created_at: string
          data_source_id: string
          description: string | null
          evidence: Json
          extraction_id: string | null
          id: string
          importance: number
          key: string
          metric_sql: string
          org_id: string
          status: string
          title: string
          updated_at: string
          viz_spec: Json
        }
        Insert: {
          alert_config?: Json | null
          applied?: Json | null
          category: string
          created_at?: string
          data_source_id: string
          description?: string | null
          evidence?: Json
          extraction_id?: string | null
          id?: string
          importance?: number
          key: string
          metric_sql: string
          org_id: string
          status?: string
          title: string
          updated_at?: string
          viz_spec: Json
        }
        Update: {
          alert_config?: Json | null
          applied?: Json | null
          category?: string
          created_at?: string
          data_source_id?: string
          description?: string | null
          evidence?: Json
          extraction_id?: string | null
          id?: string
          importance?: number
          key?: string
          metric_sql?: string
          org_id?: string
          status?: string
          title?: string
          updated_at?: string
          viz_spec?: Json
        }
        Relationships: [
          {
            foreignKeyName: "kpi_catalog_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_catalog_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      kpi_extractions: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string | null
          data_source_id: string
          error: string | null
          id: string
          org_id: string
          proposed_count: number | null
          status: string
          tier: number
          trigger_run_id: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id: string
          error?: string | null
          id?: string
          org_id: string
          proposed_count?: number | null
          status?: string
          tier?: number
          trigger_run_id?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id?: string
          error?: string | null
          id?: string
          org_id?: string
          proposed_count?: number | null
          status?: string
          tier?: number
          trigger_run_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "kpi_extractions_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "kpi_extractions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lifecycle_email_log: {
        Row: {
          dedupe_key: string
          id: string
          kind: string
          org_id: string
          sent_at: string
          user_id: string
        }
        Insert: {
          dedupe_key: string
          id?: string
          kind: string
          org_id: string
          sent_at?: string
          user_id: string
        }
        Update: {
          dedupe_key?: string
          id?: string
          kind?: string
          org_id?: string
          sent_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lifecycle_email_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lifecycle_email_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_channels: {
        Row: {
          config: Json
          connection_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          enabled: boolean
          id: string
          label: string | null
          org_id: string
          provider: string
          target: string
          updated_at: string
        }
        Insert: {
          config?: Json
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          label?: string | null
          org_id: string
          provider: string
          target: string
          updated_at?: string
        }
        Update: {
          config?: Json
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          enabled?: boolean
          id?: string
          label?: string | null
          org_id?: string
          provider?: string
          target?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_channels_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_channels_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_auth_codes: {
        Row: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          org_id: string
          redirect_uri: string
          resource: string | null
          scope: string | null
          user_id: string | null
        }
        Insert: {
          client_id: string
          code_challenge: string
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          org_id: string
          redirect_uri: string
          resource?: string | null
          scope?: string | null
          user_id?: string | null
        }
        Update: {
          client_id?: string
          code_challenge?: string
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          org_id?: string
          redirect_uri?: string
          resource?: string | null
          scope?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "oauth_auth_codes_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "oauth_clients"
            referencedColumns: ["client_id"]
          },
          {
            foreignKeyName: "oauth_auth_codes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_auth_codes_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          client_name: string | null
          client_secret_hash: string | null
          created_at: string
          grant_types: string[]
          redirect_uris: string[]
          token_endpoint_auth_method: string
        }
        Insert: {
          client_id: string
          client_name?: string | null
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          redirect_uris: string[]
          token_endpoint_auth_method?: string
        }
        Update: {
          client_id?: string
          client_name?: string | null
          client_secret_hash?: string | null
          created_at?: string
          grant_types?: string[]
          redirect_uris?: string[]
          token_endpoint_auth_method?: string
        }
        Relationships: []
      }
      org_slack_config: {
        Row: {
          created_at: string
          created_by: string | null
          org_id: string
          updated_at: string
          webhook_url: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          org_id: string
          updated_at?: string
          webhook_url: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          org_id?: string
          updated_at?: string
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_slack_config_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_slack_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_invitations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_invitations_accepted_by_fkey"
            columns: ["accepted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_members: {
        Row: {
          created_at: string
          email_alert_opt_out: boolean
          email_digest_opt_out: boolean
          email_lifecycle_opt_out: boolean
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_alert_opt_out?: boolean
          email_digest_opt_out?: boolean
          email_lifecycle_opt_out?: boolean
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_alert_opt_out?: boolean
          email_digest_opt_out?: boolean
          email_lifecycle_opt_out?: boolean
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          billing_event_at: string | null
          context_extractions_used: number
          created_at: string
          current_period_ends_at: string | null
          current_period_query_count: number
          current_period_starts_at: string | null
          current_period_token_count: number
          deleted_at: string | null
          home_dashboard_id: string | null
          id: string
          name: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: Database["public"]["Enums"]["plan_tier"]
          scheduled_change: Json | null
          slug: string
          subscription_status: string | null
          timezone: string
          updated_at: string
          usage_limit_reached_at: string | null
          usage_warned_at: string | null
          weekly_digest_enabled: boolean
        }
        Insert: {
          billing_event_at?: string | null
          context_extractions_used?: number
          created_at?: string
          current_period_ends_at?: string | null
          current_period_query_count?: number
          current_period_starts_at?: string | null
          current_period_token_count?: number
          deleted_at?: string | null
          home_dashboard_id?: string | null
          id?: string
          name: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          scheduled_change?: Json | null
          slug: string
          subscription_status?: string | null
          timezone?: string
          updated_at?: string
          usage_limit_reached_at?: string | null
          usage_warned_at?: string | null
          weekly_digest_enabled?: boolean
        }
        Update: {
          billing_event_at?: string | null
          context_extractions_used?: number
          created_at?: string
          current_period_ends_at?: string | null
          current_period_query_count?: number
          current_period_starts_at?: string | null
          current_period_token_count?: number
          deleted_at?: string | null
          home_dashboard_id?: string | null
          id?: string
          name?: string
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          plan?: Database["public"]["Enums"]["plan_tier"]
          scheduled_change?: Json | null
          slug?: string
          subscription_status?: string | null
          timezone?: string
          updated_at?: string
          usage_limit_reached_at?: string | null
          usage_warned_at?: string | null
          weekly_digest_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "organizations_home_dashboard_id_fkey"
            columns: ["home_dashboard_id"]
            isOneToOne: false
            referencedRelation: "dashboards"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_campaign_conversions: {
        Row: {
          campaign_id: string
          created_at: string
          id: string
          org_id: string
          user_id: string | null
        }
        Insert: {
          campaign_id: string
          created_at?: string
          id?: string
          org_id: string
          user_id?: string | null
        }
        Update: {
          campaign_id?: string
          created_at?: string
          id?: string
          org_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_campaign_conversions_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "outreach_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_campaign_conversions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_campaigns: {
        Row: {
          channel: string
          code: string
          created_at: string
          deleted_at: string | null
          id: string
          label: string
          notes: string | null
          target_path: string
        }
        Insert: {
          channel?: string
          code: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label: string
          notes?: string | null
          target_path?: string
        }
        Update: {
          channel?: string
          code?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          label?: string
          notes?: string | null
          target_path?: string
        }
        Relationships: []
      }
      outreach_clicks: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          ref_code: string
          referer: string | null
          user_agent: string | null
          visitor_hash: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          ref_code: string
          referer?: string | null
          user_agent?: string | null
          visitor_hash?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          ref_code?: string
          referer?: string | null
          user_agent?: string | null
          visitor_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_clicks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "outreach_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_leads: {
        Row: {
          bio: string | null
          channel: string
          click_count: number
          clicked_at: string | null
          company: string | null
          contacted_at: string | null
          contacted_via: string | null
          converted_at: string | null
          converted_org_id: string | null
          converted_user_id: string | null
          created_at: string
          deleted_at: string | null
          dm_variant: string | null
          email: string | null
          email_source: string | null
          followed_at: string | null
          followers: number
          id: string
          location: string | null
          login: string | null
          name: string | null
          notes: string | null
          queued_at: string | null
          ref_code: string
          repos: string | null
          source: string
          status: string
          tier: string | null
          twitter: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          bio?: string | null
          channel?: string
          click_count?: number
          clicked_at?: string | null
          company?: string | null
          contacted_at?: string | null
          contacted_via?: string | null
          converted_at?: string | null
          converted_org_id?: string | null
          converted_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dm_variant?: string | null
          email?: string | null
          email_source?: string | null
          followed_at?: string | null
          followers?: number
          id?: string
          location?: string | null
          login?: string | null
          name?: string | null
          notes?: string | null
          queued_at?: string | null
          ref_code: string
          repos?: string | null
          source?: string
          status?: string
          tier?: string | null
          twitter?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          bio?: string | null
          channel?: string
          click_count?: number
          clicked_at?: string | null
          company?: string | null
          contacted_at?: string | null
          contacted_via?: string | null
          converted_at?: string | null
          converted_org_id?: string | null
          converted_user_id?: string | null
          created_at?: string
          deleted_at?: string | null
          dm_variant?: string | null
          email?: string | null
          email_source?: string | null
          followed_at?: string | null
          followers?: number
          id?: string
          location?: string | null
          login?: string | null
          name?: string | null
          notes?: string | null
          queued_at?: string | null
          ref_code?: string
          repos?: string | null
          source?: string
          status?: string
          tier?: string | null
          twitter?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "outreach_leads_converted_org_id_fkey"
            columns: ["converted_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outreach_leads_converted_user_id_fkey"
            columns: ["converted_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      paddle_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          occurred_at: string | null
          payload: Json | null
          received_at: string
          status: string
        }
        Insert: {
          event_id: string
          event_type: string
          occurred_at?: string | null
          payload?: Json | null
          received_at?: string
          status?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          occurred_at?: string | null
          payload?: Json | null
          received_at?: string
          status?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          is_admin: boolean
          locale: string | null
          wizard_completed_at: string | null
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id: string
          is_admin?: boolean
          locale?: string | null
          wizard_completed_at?: string | null
        }
        Update: {
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          is_admin?: boolean
          locale?: string | null
          wizard_completed_at?: string | null
        }
        Relationships: []
      }
      provider_connections: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          display_name: string | null
          external_account_id: string | null
          id: string
          installation_id: number | null
          metadata: Json
          org_id: string
          prev_refresh_hash: string | null
          provider: Database["public"]["Enums"]["provider_kind"]
          refresh_generation: number
          reuse_detected_at: string | null
          scopes: string[] | null
          status: Database["public"]["Enums"]["connection_status"]
          token_family_id: string
          token_refreshed_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          installation_id?: number | null
          metadata?: Json
          org_id: string
          prev_refresh_hash?: string | null
          provider: Database["public"]["Enums"]["provider_kind"]
          refresh_generation?: number
          reuse_detected_at?: string | null
          scopes?: string[] | null
          status?: Database["public"]["Enums"]["connection_status"]
          token_family_id?: string
          token_refreshed_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          display_name?: string | null
          external_account_id?: string | null
          id?: string
          installation_id?: number | null
          metadata?: Json
          org_id?: string
          prev_refresh_hash?: string | null
          provider?: Database["public"]["Enums"]["provider_kind"]
          refresh_generation?: number
          reuse_detected_at?: string | null
          scopes?: string[] | null
          status?: Database["public"]["Enums"]["connection_status"]
          token_family_id?: string
          token_refreshed_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_connections_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_connections_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      proxy_callbacks: {
        Row: {
          attempts: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          event: string
          id: string
          last_error: string | null
          next_attempt_at: string
          partner_id: string
          payload: Json
          status: string
          subscription_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          event: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          partner_id: string
          payload: Json
          status?: string
          subscription_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          event?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string
          partner_id?: string
          payload?: Json
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proxy_callbacks_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "proxy_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxy_callbacks_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "proxy_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      proxy_partners: {
        Row: {
          allowed_origins: string[]
          api_key: string
          api_key_previous: string | null
          api_secret: string
          callback_url: string | null
          code: string
          created_at: string
          id: string
          is_active: boolean
          is_test: boolean
          name: string
        }
        Insert: {
          allowed_origins?: string[]
          api_key: string
          api_key_previous?: string | null
          api_secret: string
          callback_url?: string | null
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_test?: boolean
          name: string
        }
        Update: {
          allowed_origins?: string[]
          api_key?: string
          api_key_previous?: string | null
          api_secret?: string
          callback_url?: string | null
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_test?: boolean
          name?: string
        }
        Relationships: []
      }
      proxy_products: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: string
          metadata: Json
          paddle_price_id: string
          partner_id: string
          sku: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          metadata?: Json
          paddle_price_id: string
          partner_id: string
          sku: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: string
          metadata?: Json
          paddle_price_id?: string
          partner_id?: string
          sku?: string
        }
        Relationships: [
          {
            foreignKeyName: "proxy_products_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "proxy_partners"
            referencedColumns: ["id"]
          },
        ]
      }
      proxy_subscriptions: {
        Row: {
          billing_event_at: string | null
          canceled_at: string | null
          created_at: string
          current_period_ends_at: string | null
          current_period_starts_at: string | null
          customer_email: string | null
          fail_url: string
          id: string
          metadata: Json
          paddle_checkout_txn_id: string | null
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          partner_id: string
          partner_order_id: string | null
          partner_user_id: string
          product_id: string
          scheduled_change: Json | null
          status: string
          success_url: string
          updated_at: string
        }
        Insert: {
          billing_event_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at?: string | null
          customer_email?: string | null
          fail_url: string
          id?: string
          metadata?: Json
          paddle_checkout_txn_id?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          partner_id: string
          partner_order_id?: string | null
          partner_user_id: string
          product_id: string
          scheduled_change?: Json | null
          status?: string
          success_url: string
          updated_at?: string
        }
        Update: {
          billing_event_at?: string | null
          canceled_at?: string | null
          created_at?: string
          current_period_ends_at?: string | null
          current_period_starts_at?: string | null
          customer_email?: string | null
          fail_url?: string
          id?: string
          metadata?: Json
          paddle_checkout_txn_id?: string | null
          paddle_customer_id?: string | null
          paddle_subscription_id?: string | null
          partner_id?: string
          partner_order_id?: string | null
          partner_user_id?: string
          product_id?: string
          scheduled_change?: Json | null
          status?: string
          success_url?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proxy_subscriptions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "proxy_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxy_subscriptions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "proxy_products"
            referencedColumns: ["id"]
          },
        ]
      }
      proxy_transactions: {
        Row: {
          amount_cents: number | null
          billed_at: string | null
          billing_period_ends_at: string | null
          billing_period_starts_at: string | null
          created_at: string
          currency: string | null
          id: string
          kind: string
          paddle_subscription_id: string | null
          paddle_transaction_id: string
          partner_id: string
          status: string
          subscription_id: string | null
        }
        Insert: {
          amount_cents?: number | null
          billed_at?: string | null
          billing_period_ends_at?: string | null
          billing_period_starts_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          kind?: string
          paddle_subscription_id?: string | null
          paddle_transaction_id: string
          partner_id: string
          status: string
          subscription_id?: string | null
        }
        Update: {
          amount_cents?: number | null
          billed_at?: string | null
          billing_period_ends_at?: string | null
          billing_period_starts_at?: string | null
          created_at?: string
          currency?: string | null
          id?: string
          kind?: string
          paddle_subscription_id?: string | null
          paddle_transaction_id?: string
          partner_id?: string
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proxy_transactions_partner_id_fkey"
            columns: ["partner_id"]
            isOneToOne: false
            referencedRelation: "proxy_partners"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proxy_transactions_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "proxy_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_queries: {
        Row: {
          created_at: string
          created_by: string | null
          data_source_id: string | null
          id: string
          name: string | null
          org_id: string
          source: Json | null
          sql: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          id?: string
          name?: string | null
          org_id: string
          source?: Json | null
          sql: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          id?: string
          name?: string | null
          org_id?: string
          source?: Json | null
          sql?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_queries_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_queries_data_source_id_fkey"
            columns: ["data_source_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_queries_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      secret_access_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_kind: string
          at: string
          id: number
          org_id: string
          prev_hash: string | null
          purpose: string | null
          request_id: string | null
          secret_id: string | null
          source_ip: unknown
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_kind: string
          at?: string
          id?: never
          org_id: string
          prev_hash?: string | null
          purpose?: string | null
          request_id?: string | null
          secret_id?: string | null
          source_ip?: unknown
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_kind?: string
          at?: string
          id?: never
          org_id?: string
          prev_hash?: string | null
          purpose?: string | null
          request_id?: string | null
          secret_id?: string | null
          source_ip?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "secret_access_log_secret_id_fkey"
            columns: ["secret_id"]
            isOneToOne: false
            referencedRelation: "secrets"
            referencedColumns: ["id"]
          },
        ]
      }
      secrets: {
        Row: {
          aad_version: number
          access_count: number
          algo: string
          ciphertext: string
          connection_id: string | null
          created_at: string
          created_by: string | null
          data_source_id: string | null
          dek_id: string
          expires_at: string | null
          id: string
          is_current: boolean
          kind: Database["public"]["Enums"]["secret_kind"]
          last_accessed_at: string | null
          nonce: string
          not_after: string | null
          org_id: string
          revoked_at: string | null
          revoked_reason: string | null
          rotated_at: string | null
          status: Database["public"]["Enums"]["secret_status"]
          updated_at: string
          version: number
        }
        Insert: {
          aad_version?: number
          access_count?: number
          algo?: string
          ciphertext: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          dek_id: string
          expires_at?: string | null
          id?: string
          is_current?: boolean
          kind: Database["public"]["Enums"]["secret_kind"]
          last_accessed_at?: string | null
          nonce: string
          not_after?: string | null
          org_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_at?: string | null
          status?: Database["public"]["Enums"]["secret_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          aad_version?: number
          access_count?: number
          algo?: string
          ciphertext?: string
          connection_id?: string | null
          created_at?: string
          created_by?: string | null
          data_source_id?: string | null
          dek_id?: string
          expires_at?: string | null
          id?: string
          is_current?: boolean
          kind?: Database["public"]["Enums"]["secret_kind"]
          last_accessed_at?: string | null
          nonce?: string
          not_after?: string | null
          org_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          rotated_at?: string | null
          status?: Database["public"]["Enums"]["secret_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "secrets_conn_fk"
            columns: ["connection_id", "org_id"]
            isOneToOne: false
            referencedRelation: "provider_connections"
            referencedColumns: ["id", "org_id"]
          },
          {
            foreignKeyName: "secrets_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secrets_dek_id_fkey"
            columns: ["dek_id"]
            isOneToOne: false
            referencedRelation: "data_encryption_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "secrets_ds_fk"
            columns: ["data_source_id", "org_id"]
            isOneToOne: false
            referencedRelation: "data_sources"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      slack_events: {
        Row: {
          created_at: string
          event_id: string
          org_id: string | null
        }
        Insert: {
          created_at?: string
          event_id: string
          org_id?: string | null
        }
        Update: {
          created_at?: string
          event_id?: string
          org_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "slack_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      xray_reports: {
        Row: {
          commit_sha: string | null
          completed_at: string | null
          cookie_id: string
          cost_usd: number | null
          created_at: string
          default_branch: string | null
          error_code: string | null
          file_count: number | null
          full_name: string
          grade: string | null
          hidden_at: string | null
          id: string
          ip_hash: string
          locale: string
          owner: string
          repo: string
          report: Json | null
          score: number | null
          started_at: string | null
          status: string
          tokens_in: number | null
          tokens_out: number | null
          trigger_run_id: string | null
        }
        Insert: {
          commit_sha?: string | null
          completed_at?: string | null
          cookie_id: string
          cost_usd?: number | null
          created_at?: string
          default_branch?: string | null
          error_code?: string | null
          file_count?: number | null
          full_name: string
          grade?: string | null
          hidden_at?: string | null
          id?: string
          ip_hash: string
          locale?: string
          owner: string
          repo: string
          report?: Json | null
          score?: number | null
          started_at?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          trigger_run_id?: string | null
        }
        Update: {
          commit_sha?: string | null
          completed_at?: string | null
          cookie_id?: string
          cost_usd?: number | null
          created_at?: string
          default_branch?: string | null
          error_code?: string | null
          file_count?: number | null
          full_name?: string
          grade?: string | null
          hidden_at?: string | null
          id?: string
          ip_hash?: string
          locale?: string
          owner?: string
          repo?: string
          report?: Json | null
          score?: number | null
          started_at?: string | null
          status?: string
          tokens_in?: number | null
          tokens_out?: number | null
          trigger_run_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation:
        | {
            Args: { p_invitation_id: string; p_user_id: string }
            Returns: Json
          }
        | { Args: { p_token: string }; Returns: string }
      cleanup_expired_oauth_codes: { Args: never; Returns: undefined }
      cleanup_expired_oauth_tokens: { Args: never; Returns: undefined }
      cleanup_old_data: { Args: never; Returns: undefined }
      cleanup_old_widget_executions: { Args: never; Returns: undefined }
      cleanup_orphaned_organizations: { Args: never; Returns: undefined }
      create_organization: {
        Args: { p_name: string; p_slug: string }
        Returns: {
          billing_event_at: string | null
          context_extractions_used: number
          created_at: string
          current_period_ends_at: string | null
          current_period_query_count: number
          current_period_starts_at: string | null
          current_period_token_count: number
          deleted_at: string | null
          home_dashboard_id: string | null
          id: string
          name: string
          paddle_customer_id: string | null
          paddle_subscription_id: string | null
          plan: Database["public"]["Enums"]["plan_tier"]
          scheduled_change: Json | null
          slug: string
          subscription_status: string | null
          timezone: string
          updated_at: string
          usage_limit_reached_at: string | null
          usage_warned_at: string | null
          weekly_digest_enabled: boolean
        }
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      generate_api_key: { Args: never; Returns: string }
      generate_mcp_oauth_client: {
        Args: { org_id: string }
        Returns: {
          client_id: string
          client_secret: string
        }[]
      }
      generate_org_api_key: { Args: { org_id: string }; Returns: string }
      has_org_role: {
        Args: { org_id: string; required_role: string; user_id: string }
        Returns: boolean
      }
      increment_context_extractions: {
        Args: { org_id: string }
        Returns: undefined
      }
      increment_org_usage: {
        Args: {
          org_id: string
          query_increment?: number
          token_increment?: number
        }
        Returns: undefined
      }
      increment_triggered_count: {
        Args: { alert_id: string }
        Returns: undefined
      }
      invite_member: {
        Args: {
          p_email: string
          p_org: string
          p_role: Database["public"]["Enums"]["org_role"]
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          status: string
          token: string
        }
        SetofOptions: {
          from: "*"
          to: "organization_invitations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      leave_org: { Args: { p_org: string }; Returns: undefined }
      list_org_members: {
        Args: { p_org: string }
        Returns: {
          created_at: string
          display_name: string
          email: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }[]
      }
      nanoid: { Args: { size?: number }; Returns: string }
      outreach_campaign_stats: {
        Args: never
        Returns: {
          channel: string
          clicks: number
          code: string
          created_at: string
          id: string
          label: string
          own_db_orgs: number
          signups: number
          target_path: string
          unique_visitors: number
        }[]
      }
      put_current_secret: {
        Args: {
          p_aad_version: number
          p_algo: string
          p_ciphertext: string
          p_connection_id: string
          p_created_by: string
          p_data_source_id: string
          p_dek_id: string
          p_expires_at: string
          p_id: string
          p_kind: Database["public"]["Enums"]["secret_kind"]
          p_nonce: string
          p_not_after: string
          p_org_id: string
        }
        Returns: string
      }
      remove_member: {
        Args: { p_org: string; p_user: string }
        Returns: undefined
      }
      revoke_invitation: { Args: { p_invite: string }; Returns: undefined }
      revoke_org_api_key: { Args: { org_id: string }; Returns: boolean }
      transfer_ownership: {
        Args: { p_org: string; p_user: string }
        Returns: undefined
      }
      update_member_role: {
        Args: {
          p_org: string
          p_role: Database["public"]["Enums"]["org_role"]
          p_user: string
        }
        Returns: undefined
      }
      verify_mcp_oauth_client: {
        Args: { p_client_id: string; p_client_secret: string }
        Returns: string
      }
    }
    Enums: {
      agent_run_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
      alert_op: "lt" | "lte" | "gt" | "gte" | "eq" | "neq"
      alert_status: "normal" | "firing"
      alert_type: "threshold" | "change_rate" | "anomaly"
      code_run_status:
        | "queued"
        | "running"
        | "succeeded"
        | "failed"
        | "cancelled"
      connection_status: "active" | "revoked" | "error" | "expired" | "pending"
      context_status: "pending" | "generating" | "fresh" | "stale" | "failed"
      ds_engine: "postgres" | "mysql" | "firestore"
      ds_provider:
        | "supabase"
        | "self_hosted"
        | "rds"
        | "neon"
        | "planetscale"
        | "generic"
        | "firebase"
      ds_status: "pending" | "active" | "error" | "disabled"
      introspection_status: "pending" | "syncing" | "fresh" | "stale" | "failed"
      org_role: "owner" | "admin" | "member" | "viewer"
      plan_tier: "free" | "basic" | "standard" | "premium"
      provider_kind: "supabase" | "github" | "slack"
      secret_kind:
        | "db_password"
        | "oauth_refresh_token"
        | "ssl_client_key"
        | "provisioning_service_role"
        | "gcp_service_account"
        | "slack_bot_token"
      secret_status: "active" | "revoked" | "expired" | "compromised"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      agent_run_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
      alert_op: ["lt", "lte", "gt", "gte", "eq", "neq"],
      alert_status: ["normal", "firing"],
      alert_type: ["threshold", "change_rate", "anomaly"],
      code_run_status: [
        "queued",
        "running",
        "succeeded",
        "failed",
        "cancelled",
      ],
      connection_status: ["active", "revoked", "error", "expired", "pending"],
      context_status: ["pending", "generating", "fresh", "stale", "failed"],
      ds_engine: ["postgres", "mysql", "firestore"],
      ds_provider: [
        "supabase",
        "self_hosted",
        "rds",
        "neon",
        "planetscale",
        "generic",
        "firebase",
      ],
      ds_status: ["pending", "active", "error", "disabled"],
      introspection_status: ["pending", "syncing", "fresh", "stale", "failed"],
      org_role: ["owner", "admin", "member", "viewer"],
      plan_tier: ["free", "basic", "standard", "premium"],
      provider_kind: ["supabase", "github", "slack"],
      secret_kind: [
        "db_password",
        "oauth_refresh_token",
        "ssl_client_key",
        "provisioning_service_role",
        "gcp_service_account",
        "slack_bot_token",
      ],
      secret_status: ["active", "revoked", "expired", "compromised"],
    },
  },
} as const
