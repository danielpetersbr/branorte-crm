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
      analises_ia_conversas: {
        Row: {
          analyzed_at: string | null
          animal: string | null
          avaliacao_vendedor: string | null
          conversa_id: string
          etapa_funil_detectada: string | null
          id: string
          interesse: string | null
          mensagens_analisadas: number | null
          motivo_avaliacao: string | null
          phone: string
          qualidade_detectada: string | null
          quantidade: number | null
          resumo: string | null
          status_detectado: string | null
          sugestao: string | null
          updated_at: string | null
        }
        Insert: {
          analyzed_at?: string | null
          animal?: string | null
          avaliacao_vendedor?: string | null
          conversa_id: string
          etapa_funil_detectada?: string | null
          id?: string
          interesse?: string | null
          mensagens_analisadas?: number | null
          motivo_avaliacao?: string | null
          phone: string
          qualidade_detectada?: string | null
          quantidade?: number | null
          resumo?: string | null
          status_detectado?: string | null
          sugestao?: string | null
          updated_at?: string | null
        }
        Update: {
          analyzed_at?: string | null
          animal?: string | null
          avaliacao_vendedor?: string | null
          conversa_id?: string
          etapa_funil_detectada?: string | null
          id?: string
          interesse?: string | null
          mensagens_analisadas?: number | null
          motivo_avaliacao?: string | null
          phone?: string
          qualidade_detectada?: string | null
          quantidade?: number | null
          resumo?: string | null
          status_detectado?: string | null
          sugestao?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "analises_ia_conversas_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      authorized_passwords: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          password_hash: string
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          password_hash: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          password_hash?: string
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string | null
        }
        Relationships: []
      }
      automation_flow_actions: {
        Row: {
          action_order: number
          action_type: string
          content: string
          created_at: string
          delay_seconds: number | null
          file_name: string | null
          flow_id: string
          id: string
        }
        Insert: {
          action_order?: number
          action_type: string
          content: string
          created_at?: string
          delay_seconds?: number | null
          file_name?: string | null
          flow_id: string
          id?: string
        }
        Update: {
          action_order?: number
          action_type?: string
          content?: string
          created_at?: string
          delay_seconds?: number | null
          file_name?: string | null
          flow_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_flow_actions_flow_id_fkey"
            columns: ["flow_id"]
            isOneToOne: false
            referencedRelation: "automation_flows"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_flows: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          trigger_code: string
          updated_at: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          trigger_code: string
          updated_at?: string
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          trigger_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          call_id: string
          created_at: string | null
          direction: string
          duration_ms: number | null
          ended_at: string | null
          from_number: string
          instance_id: string | null
          is_answered: boolean | null
          raw: Json
          seller_name: string | null
          started_at: string | null
          status: string | null
          to_number: string
          updated_at: string | null
          vendor_phone: string | null
        }
        Insert: {
          call_id: string
          created_at?: string | null
          direction: string
          duration_ms?: number | null
          ended_at?: string | null
          from_number: string
          instance_id?: string | null
          is_answered?: boolean | null
          raw: Json
          seller_name?: string | null
          started_at?: string | null
          status?: string | null
          to_number: string
          updated_at?: string | null
          vendor_phone?: string | null
        }
        Update: {
          call_id?: string
          created_at?: string | null
          direction?: string
          duration_ms?: number | null
          ended_at?: string | null
          from_number?: string
          instance_id?: string | null
          is_answered?: boolean | null
          raw?: Json
          seller_name?: string | null
          started_at?: string | null
          status?: string | null
          to_number?: string
          updated_at?: string | null
          vendor_phone?: string | null
        }
        Relationships: []
      }
      clientes_mapa: {
        Row: {
          categoria_importacao: string | null
          cidade: string | null
          created_at: string
          data_entrega: string | null
          data_venda: string | null
          endereco: string | null
          equipamento: string | null
          estado: string | null
          id: string
          lat: number | null
          lng: number | null
          nome_cliente: string | null
          numero_orcamento: string | null
          pais: string | null
          pedido_id: string | null
          telefone: string | null
          updated_at: string | null
          valor: number | null
          vendedor: string | null
        }
        Insert: {
          categoria_importacao?: string | null
          cidade?: string | null
          created_at?: string
          data_entrega?: string | null
          data_venda?: string | null
          endereco?: string | null
          equipamento?: string | null
          estado?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nome_cliente?: string | null
          numero_orcamento?: string | null
          pais?: string | null
          pedido_id?: string | null
          telefone?: string | null
          updated_at?: string | null
          valor?: number | null
          vendedor?: string | null
        }
        Update: {
          categoria_importacao?: string | null
          cidade?: string | null
          created_at?: string
          data_entrega?: string | null
          data_venda?: string | null
          endereco?: string | null
          equipamento?: string | null
          estado?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          nome_cliente?: string | null
          numero_orcamento?: string | null
          pais?: string | null
          pedido_id?: string | null
          telefone?: string | null
          updated_at?: string | null
          valor?: number | null
          vendedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clientes_mapa_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
      contatos: {
        Row: {
          avaliacao: string | null
          cliente_confirmou: string | null
          created_at: string | null
          criativo_facebook: string | null
          data: string
          data_fechamento: string | null
          external_id: string | null
          finalization_reason: string | null
          finalizo_como_o_atendimento: string | null
          fonte_origem: string | null
          funil_de_vendas: string | null
          funnel_stage: string | null
          id: string
          lead_classification: string | null
          lista_negra: boolean
          nome: string | null
          oque_precisa: string | null
          orcamento_enviado: boolean | null
          qual_animal: string | null
          qualificacao: string | null
          quantidade: number | null
          respondeu: string | null
          responsavel: string | null
          service_status: string | null
          status_do_atendimento: string | null
          telefone: string | null
          tiro_as_duvidas: string | null
          total_mensagens: number
          ultima_mensagem_de: string | null
          updated_at: string | null
          valor_possivel_venda: number | null
        }
        Insert: {
          avaliacao?: string | null
          cliente_confirmou?: string | null
          created_at?: string | null
          criativo_facebook?: string | null
          data?: string
          data_fechamento?: string | null
          external_id?: string | null
          finalization_reason?: string | null
          finalizo_como_o_atendimento?: string | null
          fonte_origem?: string | null
          funil_de_vendas?: string | null
          funnel_stage?: string | null
          id?: string
          lead_classification?: string | null
          lista_negra?: boolean
          nome?: string | null
          oque_precisa?: string | null
          orcamento_enviado?: boolean | null
          qual_animal?: string | null
          qualificacao?: string | null
          quantidade?: number | null
          respondeu?: string | null
          responsavel?: string | null
          service_status?: string | null
          status_do_atendimento?: string | null
          telefone?: string | null
          tiro_as_duvidas?: string | null
          total_mensagens?: number
          ultima_mensagem_de?: string | null
          updated_at?: string | null
          valor_possivel_venda?: number | null
        }
        Update: {
          avaliacao?: string | null
          cliente_confirmou?: string | null
          created_at?: string | null
          criativo_facebook?: string | null
          data?: string
          data_fechamento?: string | null
          external_id?: string | null
          finalization_reason?: string | null
          finalizo_como_o_atendimento?: string | null
          fonte_origem?: string | null
          funil_de_vendas?: string | null
          funnel_stage?: string | null
          id?: string
          lead_classification?: string | null
          lista_negra?: boolean
          nome?: string | null
          oque_precisa?: string | null
          orcamento_enviado?: boolean | null
          qual_animal?: string | null
          qualificacao?: string | null
          quantidade?: number | null
          respondeu?: string | null
          responsavel?: string | null
          service_status?: string | null
          status_do_atendimento?: string | null
          telefone?: string | null
          tiro_as_duvidas?: string | null
          total_mensagens?: number
          ultima_mensagem_de?: string | null
          updated_at?: string | null
          valor_possivel_venda?: number | null
        }
        Relationships: []
      }
      conversas: {
        Row: {
          analisado_em: string | null
          contact_id: string | null
          created_at: string | null
          data_entrada_fila: string | null
          etapa_funil: string | null
          foto_perfil_updated_at: string | null
          foto_perfil_url: string | null
          id: string
          mensagens_cliente: number | null
          mensagens_vendedor: number | null
          na_fila: boolean | null
          phone: string
          qualidade_lead: string | null
          status_atendimento: string | null
          total_mensagens: number | null
          ultima_msg: string | null
          ultima_msg_date: string | null
          ultima_msg_sender: string | null
          updated_at: string | null
          vendedor: string | null
        }
        Insert: {
          analisado_em?: string | null
          contact_id?: string | null
          created_at?: string | null
          data_entrada_fila?: string | null
          etapa_funil?: string | null
          foto_perfil_updated_at?: string | null
          foto_perfil_url?: string | null
          id?: string
          mensagens_cliente?: number | null
          mensagens_vendedor?: number | null
          na_fila?: boolean | null
          phone: string
          qualidade_lead?: string | null
          status_atendimento?: string | null
          total_mensagens?: number | null
          ultima_msg?: string | null
          ultima_msg_date?: string | null
          ultima_msg_sender?: string | null
          updated_at?: string | null
          vendedor?: string | null
        }
        Update: {
          analisado_em?: string | null
          contact_id?: string | null
          created_at?: string | null
          data_entrada_fila?: string | null
          etapa_funil?: string | null
          foto_perfil_updated_at?: string | null
          foto_perfil_url?: string | null
          id?: string
          mensagens_cliente?: number | null
          mensagens_vendedor?: number | null
          na_fila?: boolean | null
          phone?: string
          qualidade_lead?: string | null
          status_atendimento?: string | null
          total_mensagens?: number | null
          ultima_msg?: string | null
          ultima_msg_date?: string | null
          ultima_msg_sender?: string | null
          updated_at?: string | null
          vendedor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversas_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_analyses: {
        Row: {
          analysis_json: Json | null
          analyzed_at: string | null
          card_id: string
          contact_name: string | null
          contact_phone: string | null
          id: string
          last_message_at: string | null
          message_count: number | null
          score: number | null
          stage: string | null
          status: string | null
          value_cents: number | null
          vendor_name: string | null
        }
        Insert: {
          analysis_json?: Json | null
          analyzed_at?: string | null
          card_id: string
          contact_name?: string | null
          contact_phone?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          score?: number | null
          stage?: string | null
          status?: string | null
          value_cents?: number | null
          vendor_name?: string | null
        }
        Update: {
          analysis_json?: Json | null
          analyzed_at?: string | null
          card_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          id?: string
          last_message_at?: string | null
          message_count?: number | null
          score?: number | null
          stage?: string | null
          status?: string | null
          value_cents?: number | null
          vendor_name?: string | null
        }
        Relationships: []
      }
      dropdown_options: {
        Row: {
          category: string
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          label: string
          updated_at: string
          value: string
        }
        Insert: {
          category: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label: string
          updated_at?: string
          value: string
        }
        Update: {
          category?: string
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          label?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      feedbacks: {
        Row: {
          created_at: string
          descricao: string
          id: string
          pagina_origem: string | null
          prioridade: string
          resposta_admin: string | null
          screenshot_url: string | null
          status: string
          tipo: string
          titulo: string
          updated_at: string
          user_id: string | null
          user_nome: string | null
        }
        Insert: {
          created_at?: string
          descricao: string
          id?: string
          pagina_origem?: string | null
          prioridade?: string
          resposta_admin?: string | null
          screenshot_url?: string | null
          status?: string
          tipo: string
          titulo: string
          updated_at?: string
          user_id?: string | null
          user_nome?: string | null
        }
        Update: {
          created_at?: string
          descricao?: string
          id?: string
          pagina_origem?: string | null
          prioridade?: string
          resposta_admin?: string | null
          screenshot_url?: string | null
          status?: string
          tipo?: string
          titulo?: string
          updated_at?: string
          user_id?: string | null
          user_nome?: string | null
        }
        Relationships: []
      }
      formas_pagamento_direto: {
        Row: {
          created_at: string
          id: string
          nome: string
          parcelas: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          nome: string
          parcelas: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          nome?: string
          parcelas?: Json
          updated_at?: string
        }
        Relationships: []
      }
      import_discrepancy_log: {
        Row: {
          arquivo_nome: string | null
          categoria: string | null
          created_at: string | null
          dados_json: Json | null
          id: string
          nome_cliente: string | null
          numero_esperado: string
          numero_extraido: string | null
        }
        Insert: {
          arquivo_nome?: string | null
          categoria?: string | null
          created_at?: string | null
          dados_json?: Json | null
          id?: string
          nome_cliente?: string | null
          numero_esperado: string
          numero_extraido?: string | null
        }
        Update: {
          arquivo_nome?: string | null
          categoria?: string | null
          created_at?: string | null
          dados_json?: Json | null
          id?: string
          nome_cliente?: string | null
          numero_esperado?: string
          numero_extraido?: string | null
        }
        Relationships: []
      }
      label_mapping_history: {
        Row: {
          applied_at: string | null
          contact_id: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string | null
          id: string
          label_name: string | null
          labelid: string
          mapping_type: string
          new_value: string
          old_value: string | null
          owner: string
          webhook_payload: Json | null
        }
        Insert: {
          applied_at?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string | null
          id?: string
          label_name?: string | null
          labelid: string
          mapping_type: string
          new_value: string
          old_value?: string | null
          owner: string
          webhook_payload?: Json | null
        }
        Update: {
          applied_at?: string | null
          contact_id?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string | null
          id?: string
          label_name?: string | null
          labelid?: string
          mapping_type?: string
          new_value?: string
          old_value?: string | null
          owner?: string
          webhook_payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "label_mapping_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_analysis: {
        Row: {
          animal: string | null
          avaliacao_atendimento: string | null
          avaliacao_vendedor: string | null
          contact_id: string | null
          created_at: string | null
          dados_extraidos: string | null
          funil: string | null
          id: string
          interesse: string | null
          lead_phone: string
          mensagens_cliente: number | null
          mensagens_total: number | null
          mensagens_vendedor: number | null
          motivo_avaliacao: string | null
          observacoes: string | null
          qualidade: string | null
          quantidade: number | null
          quantidade_aves: number | null
          quantidade_bovino: number | null
          quantidade_suino: number | null
          sugestao: string | null
          ultima_mensagem_de: string | null
          updated_at: string | null
        }
        Insert: {
          animal?: string | null
          avaliacao_atendimento?: string | null
          avaliacao_vendedor?: string | null
          contact_id?: string | null
          created_at?: string | null
          dados_extraidos?: string | null
          funil?: string | null
          id?: string
          interesse?: string | null
          lead_phone: string
          mensagens_cliente?: number | null
          mensagens_total?: number | null
          mensagens_vendedor?: number | null
          motivo_avaliacao?: string | null
          observacoes?: string | null
          qualidade?: string | null
          quantidade?: number | null
          quantidade_aves?: number | null
          quantidade_bovino?: number | null
          quantidade_suino?: number | null
          sugestao?: string | null
          ultima_mensagem_de?: string | null
          updated_at?: string | null
        }
        Update: {
          animal?: string | null
          avaliacao_atendimento?: string | null
          avaliacao_vendedor?: string | null
          contact_id?: string | null
          created_at?: string | null
          dados_extraidos?: string | null
          funil?: string | null
          id?: string
          interesse?: string | null
          lead_phone?: string
          mensagens_cliente?: number | null
          mensagens_total?: number | null
          mensagens_vendedor?: number | null
          motivo_avaliacao?: string | null
          observacoes?: string | null
          qualidade?: string | null
          quantidade?: number | null
          quantidade_aves?: number | null
          quantidade_bovino?: number | null
          quantidade_suino?: number | null
          sugestao?: string | null
          ultima_mensagem_de?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_analysis_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      login_history: {
        Row: {
          browser: string | null
          device_type: string | null
          id: string
          ip_address: string | null
          logged_in_at: string
          os: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          browser?: string | null
          device_type?: string | null
          id?: string
          ip_address?: string | null
          logged_in_at?: string
          os?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          browser?: string | null
          device_type?: string | null
          id?: string
          ip_address?: string | null
          logged_in_at?: string
          os?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "login_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      media_cache: {
        Row: {
          conversa_id: string | null
          created_at: string | null
          file_size: number | null
          id: string
          media_type: string
          message_id: string
          mime_type: string | null
          original_url: string | null
          storage_path: string
          storage_url: string
          updated_at: string | null
        }
        Insert: {
          conversa_id?: string | null
          created_at?: string | null
          file_size?: number | null
          id?: string
          media_type: string
          message_id: string
          mime_type?: string | null
          original_url?: string | null
          storage_path: string
          storage_url: string
          updated_at?: string | null
        }
        Update: {
          conversa_id?: string | null
          created_at?: string | null
          file_size?: number | null
          id?: string
          media_type?: string
          message_id?: string
          mime_type?: string | null
          original_url?: string | null
          storage_path?: string
          storage_url?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_cache_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      media_files: {
        Row: {
          created_at: string
          folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          shortcut_code: string | null
          size_bytes: number | null
          type: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          shortcut_code?: string | null
          size_bytes?: number | null
          type: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          shortcut_code?: string | null
          size_bytes?: number | null
          type?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_files_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      media_folders: {
        Row: {
          created_at: string
          id: string
          name: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "media_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "media_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      mensagens: {
        Row: {
          ack: number | null
          conversa_id: string
          created_at: string | null
          direction: string | null
          download_status: string | null
          duration_ms: number | null
          file_size: number | null
          id: string
          media_type: string | null
          media_url: string | null
          message_id: string | null
          mime_type: string | null
          quoted_msg_id: string | null
          quoted_sender: string | null
          quoted_text: string | null
          reactions: Json | null
          sender: string
          storage_path: string | null
          storage_url: string | null
          text: string | null
          timestamp: string
          transcription: string | null
        }
        Insert: {
          ack?: number | null
          conversa_id: string
          created_at?: string | null
          direction?: string | null
          download_status?: string | null
          duration_ms?: number | null
          file_size?: number | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          quoted_msg_id?: string | null
          quoted_sender?: string | null
          quoted_text?: string | null
          reactions?: Json | null
          sender: string
          storage_path?: string | null
          storage_url?: string | null
          text?: string | null
          timestamp: string
          transcription?: string | null
        }
        Update: {
          ack?: number | null
          conversa_id?: string
          created_at?: string | null
          direction?: string | null
          download_status?: string | null
          duration_ms?: number | null
          file_size?: number | null
          id?: string
          media_type?: string | null
          media_url?: string | null
          message_id?: string | null
          mime_type?: string | null
          quoted_msg_id?: string | null
          quoted_sender?: string | null
          quoted_text?: string | null
          reactions?: Json | null
          sender?: string
          storage_path?: string | null
          storage_url?: string | null
          text?: string | null
          timestamp?: string
          transcription?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mensagens_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      metas_vendas: {
        Row: {
          ano: number
          created_at: string | null
          id: string
          mes: number
          updated_at: string | null
          valor: number
        }
        Insert: {
          ano: number
          created_at?: string | null
          id?: string
          mes: number
          updated_at?: string | null
          valor?: number
        }
        Update: {
          ano?: number
          created_at?: string | null
          id?: string
          mes?: number
          updated_at?: string | null
          valor?: number
        }
        Relationships: []
      }
      modelo_composicao: {
        Row: {
          created_at: string
          equipamento_id: string
          id: string
          modelo_id: string
          ordem: number
          quantidade: number
        }
        Insert: {
          created_at?: string
          equipamento_id: string
          id?: string
          modelo_id: string
          ordem?: number
          quantidade?: number
        }
        Update: {
          created_at?: string
          equipamento_id?: string
          id?: string
          modelo_id?: string
          ordem?: number
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "modelo_composicao_equipamento_id_fkey"
            columns: ["equipamento_id"]
            isOneToOne: false
            referencedRelation: "orcamentos_equipamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "modelo_composicao_modelo_id_fkey"
            columns: ["modelo_id"]
            isOneToOne: false
            referencedRelation: "precos_branorte"
            referencedColumns: ["id"]
          },
        ]
      }
      orcamentos: {
        Row: {
          arquivo_url: string | null
          atencao_a: string | null
          bairro: string | null
          cep: string | null
          cidade: string | null
          cliente: string | null
          cpf_cnpj: string | null
          created_at: string
          data: string
          email: string | null
          endereco: string | null
          equipamentos_json: Json | null
          forma_pagamento: string | null
          frete: string | null
          id: string
          inscricao_estadual: string | null
          motores_json: Json | null
          numero: string
          prazo_entrega: string | null
          telefone: string | null
          updated_at: string
          validade_proposta: string | null
          valor_equipamentos: number | null
          valor_motores: number | null
          valor_total: number | null
          vendedor: string | null
        }
        Insert: {
          arquivo_url?: string | null
          atencao_a?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          data?: string
          email?: string | null
          endereco?: string | null
          equipamentos_json?: Json | null
          forma_pagamento?: string | null
          frete?: string | null
          id?: string
          inscricao_estadual?: string | null
          motores_json?: Json | null
          numero: string
          prazo_entrega?: string | null
          telefone?: string | null
          updated_at?: string
          validade_proposta?: string | null
          valor_equipamentos?: number | null
          valor_motores?: number | null
          valor_total?: number | null
          vendedor?: string | null
        }
        Update: {
          arquivo_url?: string | null
          atencao_a?: string | null
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cliente?: string | null
          cpf_cnpj?: string | null
          created_at?: string
          data?: string
          email?: string | null
          endereco?: string | null
          equipamentos_json?: Json | null
          forma_pagamento?: string | null
          frete?: string | null
          id?: string
          inscricao_estadual?: string | null
          motores_json?: Json | null
          numero?: string
          prazo_entrega?: string | null
          telefone?: string | null
          updated_at?: string
          validade_proposta?: string | null
          valor_equipamentos?: number | null
          valor_motores?: number | null
          valor_total?: number | null
          vendedor?: string | null
        }
        Relationships: []
      }
      orcamentos_equipamentos: {
        Row: {
          ativo: boolean
          codigo: string
          created_at: string
          descricao_curta: string | null
          especificacoes: Json | null
          id: string
          imagem_url: string | null
          nome: string
          ordem: number | null
          preco: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          codigo: string
          created_at?: string
          descricao_curta?: string | null
          especificacoes?: Json | null
          id?: string
          imagem_url?: string | null
          nome: string
          ordem?: number | null
          preco?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          codigo?: string
          created_at?: string
          descricao_curta?: string | null
          especificacoes?: Json | null
          id?: string
          imagem_url?: string | null
          nome?: string
          ordem?: number | null
          preco?: number
          updated_at?: string
        }
        Relationships: []
      }
      orcamentos_motores: {
        Row: {
          ativo: boolean
          condicao: string
          created_at: string
          id: string
          ordem: number | null
          polos: number
          potencia: string
          preco: number
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          condicao?: string
          created_at?: string
          id?: string
          ordem?: number | null
          polos?: number
          potencia: string
          preco?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          condicao?: string
          created_at?: string
          id?: string
          ordem?: number | null
          polos?: number
          potencia?: string
          preco?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      order_installments: {
        Row: {
          amount: number
          boleto_enviado: boolean | null
          boleto_enviado_em: string | null
          canceled: boolean | null
          canceled_at: string | null
          cancellation_reason: string | null
          created_at: string | null
          description: string
          due_date: string
          id: string
          installment_no: number
          order_id: string
          reference_date: string
          reference_type: string
          status: Database["public"]["Enums"]["installment_status"] | null
          total_installments: number
          updated_at: string | null
        }
        Insert: {
          amount: number
          boleto_enviado?: boolean | null
          boleto_enviado_em?: string | null
          canceled?: boolean | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          created_at?: string | null
          description: string
          due_date: string
          id?: string
          installment_no: number
          order_id: string
          reference_date: string
          reference_type: string
          status?: Database["public"]["Enums"]["installment_status"] | null
          total_installments: number
          updated_at?: string | null
        }
        Update: {
          amount?: number
          boleto_enviado?: boolean | null
          boleto_enviado_em?: string | null
          canceled?: boolean | null
          canceled_at?: string | null
          cancellation_reason?: string | null
          created_at?: string | null
          description?: string
          due_date?: string
          id?: string
          installment_no?: number
          order_id?: string
          reference_date?: string
          reference_type?: string
          status?: Database["public"]["Enums"]["installment_status"] | null
          total_installments?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_installments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
      pedido_sequencia: {
        Row: {
          ano: number
          seq: number
          updated_at: string | null
        }
        Insert: {
          ano: number
          seq?: number
          updated_at?: string | null
        }
        Update: {
          ano?: number
          seq?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      pedidos_venda: {
        Row: {
          ajuste_data: string | null
          ajuste_motivo: string | null
          ajuste_valor: number | null
          arquivo_url: string
          atencao_a: string | null
          bairro: string | null
          bairro_entrega: string | null
          cep: string | null
          cep_entrega: string | null
          checklist_compras: Json | null
          cidade: string | null
          cidade_entrega: string | null
          cliente: string | null
          cpf_cnpj: string | null
          created_at: string | null
          data_entrega: string
          data_entrega_manual: string | null
          data_pagamento: string | null
          data_primeiro_contato: string | null
          data_venda: string
          descricao_equipamento: string | null
          dias_uteis: number
          endereco: string | null
          endereco_entrega: string | null
          endereco_entrega_diferente: boolean | null
          equipamentos_detalhados: Json | null
          equipamentos_json: Json
          estado: string | null
          estado_entrega: string | null
          fantasia: string | null
          fonte_origem: string | null
          forma_pagamento: string | null
          id: string
          inscricao_estadual: string | null
          motores_json: Json
          numero_endereco: string | null
          numero_orcamento: string
          payment_plan_json: Json | null
          pedido_numero: string | null
          responsavel_recebimento: string | null
          status: Database["public"]["Enums"]["pedido_status"] | null
          status_pagamento:
            | Database["public"]["Enums"]["status_pagamento"]
            | null
          telefone: string | null
          tensao: string | null
          tipo_prazo: string | null
          updated_at: string | null
          valor_pago: number | null
          valor_split_v1: number | null
          valor_split_v2: number | null
          valor_total: number | null
          vendedor: string
          vendedor_2: string | null
          voltagem: string | null
        }
        Insert: {
          ajuste_data?: string | null
          ajuste_motivo?: string | null
          ajuste_valor?: number | null
          arquivo_url: string
          atencao_a?: string | null
          bairro?: string | null
          bairro_entrega?: string | null
          cep?: string | null
          cep_entrega?: string | null
          checklist_compras?: Json | null
          cidade?: string | null
          cidade_entrega?: string | null
          cliente?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          data_entrega: string
          data_entrega_manual?: string | null
          data_pagamento?: string | null
          data_primeiro_contato?: string | null
          data_venda: string
          descricao_equipamento?: string | null
          dias_uteis: number
          endereco?: string | null
          endereco_entrega?: string | null
          endereco_entrega_diferente?: boolean | null
          equipamentos_detalhados?: Json | null
          equipamentos_json: Json
          estado?: string | null
          estado_entrega?: string | null
          fantasia?: string | null
          fonte_origem?: string | null
          forma_pagamento?: string | null
          id?: string
          inscricao_estadual?: string | null
          motores_json: Json
          numero_endereco?: string | null
          numero_orcamento: string
          payment_plan_json?: Json | null
          pedido_numero?: string | null
          responsavel_recebimento?: string | null
          status?: Database["public"]["Enums"]["pedido_status"] | null
          status_pagamento?:
            | Database["public"]["Enums"]["status_pagamento"]
            | null
          telefone?: string | null
          tensao?: string | null
          tipo_prazo?: string | null
          updated_at?: string | null
          valor_pago?: number | null
          valor_split_v1?: number | null
          valor_split_v2?: number | null
          valor_total?: number | null
          vendedor: string
          vendedor_2?: string | null
          voltagem?: string | null
        }
        Update: {
          ajuste_data?: string | null
          ajuste_motivo?: string | null
          ajuste_valor?: number | null
          arquivo_url?: string
          atencao_a?: string | null
          bairro?: string | null
          bairro_entrega?: string | null
          cep?: string | null
          cep_entrega?: string | null
          checklist_compras?: Json | null
          cidade?: string | null
          cidade_entrega?: string | null
          cliente?: string | null
          cpf_cnpj?: string | null
          created_at?: string | null
          data_entrega?: string
          data_entrega_manual?: string | null
          data_pagamento?: string | null
          data_primeiro_contato?: string | null
          data_venda?: string
          descricao_equipamento?: string | null
          dias_uteis?: number
          endereco?: string | null
          endereco_entrega?: string | null
          endereco_entrega_diferente?: boolean | null
          equipamentos_detalhados?: Json | null
          equipamentos_json?: Json
          estado?: string | null
          estado_entrega?: string | null
          fantasia?: string | null
          fonte_origem?: string | null
          forma_pagamento?: string | null
          id?: string
          inscricao_estadual?: string | null
          motores_json?: Json
          numero_endereco?: string | null
          numero_orcamento?: string
          payment_plan_json?: Json | null
          pedido_numero?: string | null
          responsavel_recebimento?: string | null
          status?: Database["public"]["Enums"]["pedido_status"] | null
          status_pagamento?:
            | Database["public"]["Enums"]["status_pagamento"]
            | null
          telefone?: string | null
          tensao?: string | null
          tipo_prazo?: string | null
          updated_at?: string | null
          valor_pago?: number | null
          valor_split_v1?: number | null
          valor_split_v2?: number | null
          valor_total?: number | null
          vendedor?: string
          vendedor_2?: string | null
          voltagem?: string | null
        }
        Relationships: []
      }
      precos_branorte: {
        Row: {
          ativo: boolean
          categoria: string
          created_at: string
          descricao: string | null
          id: string
          imagem_url: string | null
          modelo: string
          nome: string
          preco_base: number
          preco_promocional: number | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          categoria: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          modelo: string
          nome: string
          preco_base: number
          preco_promocional?: number | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          categoria?: string
          created_at?: string
          descricao?: string | null
          id?: string
          imagem_url?: string | null
          modelo?: string
          nome?: string
          preco_base?: number
          preco_promocional?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      producao_estagios: {
        Row: {
          ativo: boolean | null
          cor: string | null
          created_at: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number
          responsavel_padrao: string | null
        }
        Insert: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem: number
          responsavel_padrao?: string | null
        }
        Update: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          responsavel_padrao?: string | null
        }
        Relationships: []
      }
      producao_historico: {
        Row: {
          created_at: string | null
          estagio_anterior: string | null
          estagio_novo: string | null
          id: string
          movido_por: string | null
          observacao: string | null
          pedido_id: string | null
        }
        Insert: {
          created_at?: string | null
          estagio_anterior?: string | null
          estagio_novo?: string | null
          id?: string
          movido_por?: string | null
          observacao?: string | null
          pedido_id?: string | null
        }
        Update: {
          created_at?: string | null
          estagio_anterior?: string | null
          estagio_novo?: string | null
          id?: string
          movido_por?: string | null
          observacao?: string | null
          pedido_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producao_historico_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_itens_checklist: {
        Row: {
          concluido: boolean | null
          concluido_em: string | null
          concluido_por: string | null
          created_at: string | null
          id: string
          item_index: number
          observacao: string | null
          producao_pedido_id: string | null
          tipo: string
        }
        Insert: {
          concluido?: boolean | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string | null
          id?: string
          item_index: number
          observacao?: string | null
          producao_pedido_id?: string | null
          tipo: string
        }
        Update: {
          concluido?: boolean | null
          concluido_em?: string | null
          concluido_por?: string | null
          created_at?: string | null
          id?: string
          item_index?: number
          observacao?: string | null
          producao_pedido_id?: string | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "producao_itens_checklist_producao_pedido_id_fkey"
            columns: ["producao_pedido_id"]
            isOneToOne: false
            referencedRelation: "producao_pedidos"
            referencedColumns: ["id"]
          },
        ]
      }
      producao_pedidos: {
        Row: {
          arquivo_fabrica_url: string | null
          created_at: string | null
          data_entrada: string | null
          data_movimentacao: string | null
          estagio_id: string | null
          id: string
          observacoes: string | null
          pedido_id: string | null
          prioridade: number | null
          responsavel: string | null
          updated_at: string | null
        }
        Insert: {
          arquivo_fabrica_url?: string | null
          created_at?: string | null
          data_entrada?: string | null
          data_movimentacao?: string | null
          estagio_id?: string | null
          id?: string
          observacoes?: string | null
          pedido_id?: string | null
          prioridade?: number | null
          responsavel?: string | null
          updated_at?: string | null
        }
        Update: {
          arquivo_fabrica_url?: string | null
          created_at?: string | null
          data_entrada?: string | null
          data_movimentacao?: string | null
          estagio_id?: string | null
          id?: string
          observacoes?: string | null
          pedido_id?: string | null
          prioridade?: number | null
          responsavel?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "producao_pedidos_estagio_id_fkey"
            columns: ["estagio_id"]
            isOneToOne: false
            referencedRelation: "producao_estagios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "producao_pedidos_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: true
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_name: string | null
          endpoint: string
          id: string
          p256dh: string
          updated_at: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_name?: string | null
          endpoint: string
          id?: string
          p256dh: string
          updated_at?: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_name?: string | null
          endpoint?: string
          id?: string
          p256dh?: string
          updated_at?: string
        }
        Relationships: []
      }
      receipts: {
        Row: {
          amount: number
          created_at: string | null
          created_by: string | null
          id: string
          installment_id: string | null
          installment_no: number | null
          notes: string | null
          order_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_url: string | null
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          installment_id?: string | null
          installment_no?: number | null
          notes?: string | null
          order_id: string
          paid_at: string
          payment_method: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          created_by?: string | null
          id?: string
          installment_id?: string | null
          installment_no?: number | null
          notes?: string | null
          order_id?: string
          paid_at?: string
          payment_method?: Database["public"]["Enums"]["payment_method"]
          receipt_url?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "order_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "v_installments_summary"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_label_mapping: {
        Row: {
          created_at: string | null
          id: string
          label_name: string | null
          labelid: string
          owner: string
          type: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          label_name?: string | null
          labelid: string
          owner: string
          type: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          label_name?: string | null
          labelid?: string
          owner?: string
          type?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      sketch_project_exports: {
        Row: {
          created_at: string | null
          export_type: string
          file_url: string
          id: string
          project_id: string
        }
        Insert: {
          created_at?: string | null
          export_type: string
          file_url: string
          id?: string
          project_id: string
        }
        Update: {
          created_at?: string | null
          export_type?: string
          file_url?: string
          id?: string
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sketch_project_exports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sketch_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sketch_project_versions: {
        Row: {
          created_at: string | null
          data_json: Json
          id: string
          project_id: string
          version_number: number
        }
        Insert: {
          created_at?: string | null
          data_json?: Json
          id?: string
          project_id: string
          version_number?: number
        }
        Update: {
          created_at?: string | null
          data_json?: Json
          id?: string
          project_id?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "sketch_project_versions_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "sketch_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      sketch_projects: {
        Row: {
          client_name: string | null
          client_phone: string | null
          created_at: string | null
          grid_size: number
          id: string
          is_shared: boolean
          name: string
          notes: string | null
          owner_user_id: string
          paper_orientation: string
          paper_size: string
          scale: string
          share_token: string | null
          unit: string
          updated_at: string | null
        }
        Insert: {
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          grid_size?: number
          id?: string
          is_shared?: boolean
          name: string
          notes?: string | null
          owner_user_id: string
          paper_orientation?: string
          paper_size?: string
          scale?: string
          share_token?: string | null
          unit?: string
          updated_at?: string | null
        }
        Update: {
          client_name?: string | null
          client_phone?: string | null
          created_at?: string | null
          grid_size?: number
          id?: string
          is_shared?: boolean
          name?: string
          notes?: string | null
          owner_user_id?: string
          paper_orientation?: string
          paper_size?: string
          scale?: string
          share_token?: string | null
          unit?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sketch_projects_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      system_settings: {
        Row: {
          created_at: string | null
          id: string
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          id?: string
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      transferencias_atendimento: {
        Row: {
          contact_id: string | null
          conversa_id: string | null
          created_at: string | null
          de_vendedor: string
          id: string
          motivo: string | null
          para_vendedor: string
          transferido_por: string
        }
        Insert: {
          contact_id?: string | null
          conversa_id?: string | null
          created_at?: string | null
          de_vendedor: string
          id?: string
          motivo?: string | null
          para_vendedor: string
          transferido_por: string
        }
        Update: {
          contact_id?: string | null
          conversa_id?: string | null
          created_at?: string | null
          de_vendedor?: string
          id?: string
          motivo?: string | null
          para_vendedor?: string
          transferido_por?: string
        }
        Relationships: [
          {
            foreignKeyName: "transferencias_atendimento_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transferencias_atendimento_conversa_id_fkey"
            columns: ["conversa_id"]
            isOneToOne: false
            referencedRelation: "conversas"
            referencedColumns: ["id"]
          },
        ]
      }
      user_accounts: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          created_at: string | null
          email: string
          id: string
          motivo_rejeicao: string | null
          nome_completo: string
          role: string | null
          senha_hash: string
          status: string | null
          ultimo_login: string | null
          updated_at: string | null
          vendedor_id: string | null
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string | null
          email: string
          id?: string
          motivo_rejeicao?: string | null
          nome_completo: string
          role?: string | null
          senha_hash: string
          status?: string | null
          ultimo_login?: string | null
          updated_at?: string | null
          vendedor_id?: string | null
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          created_at?: string | null
          email?: string
          id?: string
          motivo_rejeicao?: string | null
          nome_completo?: string
          role?: string | null
          senha_hash?: string
          status?: string | null
          ultimo_login?: string | null
          updated_at?: string | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_accounts_vendedor_id_fkey"
            columns: ["vendedor_id"]
            isOneToOne: false
            referencedRelation: "vendedores"
            referencedColumns: ["id"]
          },
        ]
      }
      user_permissions: {
        Row: {
          created_at: string | null
          id: string
          permission_key: Database["public"]["Enums"]["permission_key"]
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          permission_key: Database["public"]["Enums"]["permission_key"]
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          permission_key?: Database["public"]["Enums"]["permission_key"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      vapid_keys: {
        Row: {
          created_at: string
          id: string
          private_key: string
          public_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          private_key: string
          public_key: string
        }
        Update: {
          created_at?: string
          id?: string
          private_key?: string
          public_key?: string
        }
        Relationships: []
      }
      vendedores: {
        Row: {
          ativo: boolean | null
          comissao_percentual: number | null
          created_at: string | null
          foto_url: string | null
          id: string
          instance_token: string | null
          nome: string
          salario_base: number | null
          updated_at: string | null
          wa_number: string | null
        }
        Insert: {
          ativo?: boolean | null
          comissao_percentual?: number | null
          created_at?: string | null
          foto_url?: string | null
          id?: string
          instance_token?: string | null
          nome: string
          salario_base?: number | null
          updated_at?: string | null
          wa_number?: string | null
        }
        Update: {
          ativo?: boolean | null
          comissao_percentual?: number | null
          created_at?: string | null
          foto_url?: string | null
          id?: string
          instance_token?: string | null
          nome?: string
          salario_base?: number | null
          updated_at?: string | null
          wa_number?: string | null
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          contact_id: string | null
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          payload: Json
          response: Json | null
          status: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          payload: Json
          response?: Json | null
          status: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          payload?: Json
          response?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_label_application_logs: {
        Row: {
          client_phone: string
          contact_id: string | null
          created_at: string | null
          error_message: string | null
          field_changed: string
          id: string
          instance_token: string | null
          label_context: string
          labelid_applied: string
          new_value: string
          previous_value: string | null
          raw_response: Json | null
          request_body: Json | null
          request_url: string | null
          seller_name: string
          seller_wa_number: string
          status: string
        }
        Insert: {
          client_phone: string
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          field_changed: string
          id?: string
          instance_token?: string | null
          label_context: string
          labelid_applied: string
          new_value: string
          previous_value?: string | null
          raw_response?: Json | null
          request_body?: Json | null
          request_url?: string | null
          seller_name: string
          seller_wa_number: string
          status: string
        }
        Update: {
          client_phone?: string
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          field_changed?: string
          id?: string
          instance_token?: string | null
          label_context?: string
          labelid_applied?: string
          new_value?: string
          previous_value?: string | null
          raw_response?: Json | null
          request_body?: Json | null
          request_url?: string | null
          seller_name?: string
          seller_wa_number?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_label_application_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_labels_config: {
        Row: {
          created_at: string | null
          id: string
          label_name: string | null
          label_type: string
          labelid: string
          logical_value: string
          seller_name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          label_name?: string | null
          label_type: string
          labelid: string
          logical_value: string
          seller_name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          label_name?: string | null
          label_type?: string
          labelid?: string
          logical_value?: string
          seller_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      whatsapp_read_status_logs: {
        Row: {
          client_phone: string
          contact_id: string | null
          created_at: string | null
          error_message: string | null
          id: string
          operation: string
          raw_response: Json | null
          request_body: Json | null
          seller_name: string
          status_code: number | null
          success: boolean | null
        }
        Insert: {
          client_phone: string
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation: string
          raw_response?: Json | null
          request_body?: Json | null
          seller_name: string
          status_code?: number | null
          success?: boolean | null
        }
        Update: {
          client_phone?: string
          contact_id?: string | null
          created_at?: string | null
          error_message?: string | null
          id?: string
          operation?: string
          raw_response?: Json | null
          request_body?: Json | null
          seller_name?: string
          status_code?: number | null
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_read_status_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contatos"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      v_call_by_seller: {
        Row: {
          atendidas: number | null
          duracao_media_s: number | null
          feitas: number | null
          recusadas_ou_perdidas: number | null
          vendedor: string | null
        }
        Relationships: []
      }
      v_call_kpis: {
        Row: {
          atendidas: number | null
          dia: string | null
          duracao_media_ms: number | null
          ligacoes_fechadas: number | null
          ligacoes_recebidas: number | null
          nao_atendidas: number | null
        }
        Relationships: []
      }
      v_installments_summary: {
        Row: {
          amount: number | null
          balance: number | null
          boleto_enviado: boolean | null
          boleto_enviado_em: string | null
          canceled: boolean | null
          canceled_at: string | null
          cancellation_reason: string | null
          cliente: string | null
          description: string | null
          due_date: string | null
          forma_pagamento: string | null
          id: string | null
          installment_no: number | null
          order_id: string | null
          paid_amount: number | null
          pedido_numero: string | null
          status: Database["public"]["Enums"]["installment_status"] | null
          total_installments: number | null
          vendedor: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_installments_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "pedidos_venda"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      calculate_installment_status: {
        Args: { p_installment_id: string }
        Returns: Database["public"]["Enums"]["installment_status"]
      }
      gerar_pedido_numero: { Args: { p_data: string }; Returns: string }
      has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["permission_key"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      installment_status:
        | "PENDENTE"
        | "PARCIAL"
        | "PAGO"
        | "VENCIDO"
        | "BOLETO_ENVIADO"
      payment_method:
        | "PIX"
        | "BOLETO"
        | "CARTAO"
        | "TRANSFERENCIA"
        | "DINHEIRO"
        | "OUTRO"
      pedido_status: "ABERTO" | "FECHADO" | "CANCELADO"
      permission_key:
        | "dashboard"
        | "meu_perfil"
        | "novo_pedido"
        | "pedido_simples"
        | "pedidos"
        | "orcamentos"
        | "lista_precos"
        | "corrida_vendas"
        | "controle_financeiro"
        | "controle_vendas"
        | "comissoes"
        | "metas_vendas"
        | "relatorio_executivo"
        | "contatos"
        | "central_conversas"
        | "ligacoes"
        | "biblioteca_midia"
        | "automacoes_whatsapp"
        | "notificacoes"
        | "configuracoes_campos"
        | "mapeamento_etiquetas"
        | "configurador_fabrica"
        | "limpeza_documentos"
        | "gerenciar_usuarios"
        | "ver_todos_pedidos"
        | "controle_producao"
        | "simulador_pagamento"
        | "mapa_vendas"
        | "desenho_tecnico"
      status_pagamento: "PENDENTE" | "PAGO" | "PARCIAL"
      user_role: "admin" | "user" | "mapa"
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
      installment_status: [
        "PENDENTE",
        "PARCIAL",
        "PAGO",
        "VENCIDO",
        "BOLETO_ENVIADO",
      ],
      payment_method: [
        "PIX",
        "BOLETO",
        "CARTAO",
        "TRANSFERENCIA",
        "DINHEIRO",
        "OUTRO",
      ],
      pedido_status: ["ABERTO", "FECHADO", "CANCELADO"],
      permission_key: [
        "dashboard",
        "meu_perfil",
        "novo_pedido",
        "pedido_simples",
        "pedidos",
        "orcamentos",
        "lista_precos",
        "corrida_vendas",
        "controle_financeiro",
        "controle_vendas",
        "comissoes",
        "metas_vendas",
        "relatorio_executivo",
        "contatos",
        "central_conversas",
        "ligacoes",
        "biblioteca_midia",
        "automacoes_whatsapp",
        "notificacoes",
        "configuracoes_campos",
        "mapeamento_etiquetas",
        "configurador_fabrica",
        "limpeza_documentos",
        "gerenciar_usuarios",
        "ver_todos_pedidos",
        "controle_producao",
        "simulador_pagamento",
        "mapa_vendas",
        "desenho_tecnico",
      ],
      status_pagamento: ["PENDENTE", "PAGO", "PARCIAL"],
      user_role: ["admin", "user", "mapa"],
    },
  },
} as const
