
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.50.2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WhatsAppWebhookPayload {
  entry: Array<{
    changes: Array<{
      value: {
        contacts: Array<{
          profile: {
            name: string;
          };
          wa_id: string;
        }>;
        messages?: Array<{
          from: string;
          text?: {
            body: string;
          };
        }>;
        statuses?: Array<{
          recipient_id: string;
          status: string;
        }>;
      };
      field: string;
    }>;
  }>;
}

interface TagChangePayload {
  contact_id: string;
  contact_name: string;
  phone: string;
  tag: string;
  action: 'added' | 'removed';
  timestamp: string;
  vendor: string;
  origin?: string;
}

serve(async (req) => {
  console.log('WhatsApp webhook recebido:', req.method, new Date().toISOString());

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Verificação do webhook do WhatsApp
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    console.log('Verificação do webhook:', { mode, token, challenge });

    const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') || 'your_verify_token';
    
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verificado com sucesso');
      return new Response(challenge, { status: 200 });
    } else {
      console.log('Falha na verificação do webhook');
      return new Response('Verification failed', { status: 403 });
    }
  }

  if (req.method === 'POST') {
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );

      const payload = await req.json();
      console.log('Payload recebido:', JSON.stringify(payload, null, 2));

      // Processar payload customizado para mudanças de etiquetas
      if (payload.type === 'tag_change') {
        const tagData = payload as TagChangePayload;
        const success = await processTagChange(supabase, tagData);
        
        return new Response(JSON.stringify({ 
          success, 
          message: success ? 'Etiqueta processada com sucesso' : 'Erro ao processar etiqueta',
          timestamp: new Date().toISOString()
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Processar payload padrão do WhatsApp Business API
      const webhookData = payload as WhatsAppWebhookPayload;
      
      if (webhookData.entry) {
        for (const entry of webhookData.entry) {
          for (const change of entry.changes) {
            if (change.field === 'messages' && change.value.contacts) {
              for (const contact of change.value.contacts) {
                await processNewContact(supabase, contact);
              }
            }
          }
        }
      }

      return new Response(JSON.stringify({ 
        success: true,
        timestamp: new Date().toISOString()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (error) {
      console.error('Erro ao processar webhook:', error);
      return new Response(JSON.stringify({ 
        error: error.message,
        timestamp: new Date().toISOString()
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  return new Response('Method not allowed', { status: 405 });
});

async function processTagChange(supabase: any, tagData: TagChangePayload): Promise<boolean> {
  console.log('Processando mudança de etiqueta:', tagData);

  // Aceitar todas as etiquetas, não apenas as do funil
  const validTags = [
    // Funil
    'PROSPECÇÃO', 'NOVO LEAD', 'FOLLOW UP', 'VENDIDOS',
    // Qualidade
    'QUENTE', 'MORNO', 'FRIO',
    // Status de Lead
    'ABERTO', 'RESPONDEU', 'NÃO RESPONDEU', 'NÃO TEM INTERESSE', 'OUTROS ASSUNTOS',
    // Atendimento
    'PRIMEIRA INTERAÇÃO', 'EM ATENDIMENTO', 'AGUARDANDO RESPOSTA', 'FECHADO',
    // Classificação
    'INTERESSADO', 'MUITO INTERESSADO', 'POUCO INTERESSADO', 'SEM INTERESSE',
    // Orçamentos
    'ORÇAMENTO ENVIADO', 'ORÇAMENTO APROVADO', 'ORÇAMENTO REJEITADO', 'AGUARDANDO ORÇAMENTO'
  ];
  
  // Se não for uma tag válida, processar mesmo assim (permite tags customizadas)
  console.log(`Processando etiqueta: ${tagData.tag} (action: ${tagData.action})`);

  try {
    // Buscar ou criar vendedor
    let vendedor = await findOrCreateVendedor(supabase, tagData.vendor);
    if (!vendedor) {
      console.error('Não foi possível criar/encontrar vendedor:', tagData.vendor);
      return false;
    }

    const phoneNormalized = normalizePhone(tagData.phone);

    if (tagData.action === 'added') {
      // Verificar se a etiqueta já existe para evitar duplicatas
      const { data: existing } = await supabase
        .from('etiquetas_leads')
        .select('id')
        .eq('telefone', phoneNormalized)
        .eq('etiqueta', tagData.tag)
        .eq('vendedor_id', vendedor.id)
        .maybeSingle();

      if (existing) {
        console.log('Etiqueta já existe, ignorando duplicata');
        return true;
      }

      // Inserir nova etiqueta
      const { data, error: insertError } = await supabase
        .from('etiquetas_leads')
        .insert([{
          telefone: phoneNormalized,
          etiqueta: tagData.tag,
          data_aplicada: tagData.timestamp,
          vendedor_id: vendedor.id
        }])
        .select()
        .single();

      if (insertError) {
        console.error('Erro ao inserir etiqueta:', insertError);
        return false;
      }

      console.log('Etiqueta inserida com sucesso:', data);
      return true;

    } else if (tagData.action === 'removed') {
      // Remover etiqueta
      const { error: deleteError } = await supabase
        .from('etiquetas_leads')
        .delete()
        .eq('telefone', phoneNormalized)
        .eq('etiqueta', tagData.tag)
        .eq('vendedor_id', vendedor.id);

      if (deleteError) {
        console.error('Erro ao remover etiqueta:', deleteError);
        return false;
      }

      console.log('Etiqueta removida com sucesso');
      return true;
    }

    return false;
  } catch (error) {
    console.error('Erro no processamento da tag:', error);
    return false;
  }
}

async function findOrCreateVendedor(supabase: any, nomeVendedor: string) {
  try {
    // Buscar vendedor existente
    const { data: vendedor, error: searchError } = await supabase
      .from('perfis_usuarios')
      .select('*')
      .eq('nome', nomeVendedor)
      .maybeSingle();

    if (searchError) {
      console.error('Erro ao buscar vendedor:', searchError);
      return null;
    }

    if (vendedor) {
      console.log('Vendedor encontrado:', vendedor.nome);
      return vendedor;
    }

    // Criar novo vendedor se não existir
    const { data: novoVendedor, error: createError } = await supabase
      .from('perfis_usuarios')
      .insert([{
        nome: nomeVendedor,
        email: `${nomeVendedor.toLowerCase().replace(/\s+/g, '.')}@temp.com`,
        tipo: 'vendedor'
      }])
      .select()
      .single();

    if (createError) {
      console.error('Erro ao criar vendedor:', createError);
      return null;
    }

    console.log('Vendedor criado:', novoVendedor);
    return novoVendedor;
  } catch (error) {
    console.error('Erro ao buscar/criar vendedor:', error);
    return null;
  }
}

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  return cleaned.startsWith('55') ? cleaned : `55${cleaned}`;
}

async function processNewContact(supabase: any, contact: any) {
  console.log('Processando novo contato:', contact);
  // Implementar lógica para novos contatos se necessário
}
