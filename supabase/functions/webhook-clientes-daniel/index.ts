
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 🟩 Funil de Venda - Pode ter múltiplas etiquetas simultaneamente
const ETIQUETAS_FUNIL = ['PROSPECÇÃO', 'NOVO LEAD', 'FOLLOW UP', 'VENDIDOS'];

// 🟨 Status do Lead - Apenas 1 por vez (exclusividade)
const ETIQUETAS_STATUS_LEAD = [
  'INTERESSE FUTURO', 'NÃO RESPONDEU MAIS', 'NÃO TEM INTERESSE', 
  'COMPROU DO CONCORRENTE', 'SÓ BASE DE PREÇO', 'FORA DO ORÇAMENTO',
  'NUNCA RESPONDEU', 'OUTROS ASSUNTOS', 'NÃO FABRICAMOS',
  'ORÇAMENTO ENVIADO', 'ORÇAMENTO NO BANCO'
];

// 🟧 Status de Atendimento - Apenas 1 por vez (exclusividade)
const STATUS_ATENDIMENTO = ['ABERTO', 'FECHADO'];

// 🔴 Classificação do Lead - Apenas 1 por vez (exclusividade)
const CLASSIFICACAO_LEAD = ['LEAD FRIO', 'LEAD MORNO', 'LEAD QUENTE'];

// Função para normalizar etiquetas
function normalizarEtiqueta(etiqueta: string): string {
  const etiquetaUpper = etiqueta.toUpperCase().trim();
  
  // Normalizar variações comuns
  if (etiquetaUpper === 'QUENTE') return 'LEAD QUENTE';
  if (etiquetaUpper === 'MORNO') return 'LEAD MORNO';
  if (etiquetaUpper === 'FRIO') return 'LEAD FRIO';
  
  return etiquetaUpper;
}

serve(async (req) => {
  console.log('Webhook Clientes Daniel - Requisição recebida:', req.method, new Date().toISOString());

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    console.log('Payload recebido:', JSON.stringify(body, null, 2));

    // Novo formato: { vendedor: "JARDEL", clientes: [...] }
    const { vendedor: nomeVendedor, clientes } = body;
    
    if (!nomeVendedor || !clientes || !Array.isArray(clientes)) {
      return new Response(JSON.stringify({
        success: false,
        message: 'Formato inválido: esperado { vendedor, clientes }'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Buscar vendedor pelo nome (case-insensitive) ou ID
    let vendedor = null;
    
    // Primeiro, tentar buscar por ID se parece com UUID
    if (nomeVendedor.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      const { data } = await supabase
        .from('perfis_usuarios')
        .select('id, nome')
        .eq('id', nomeVendedor)
        .eq('tipo', 'vendedor')
        .single();
      vendedor = data;
    }
    
    // Se não encontrou por ID, buscar por nome (case-insensitive)
    if (!vendedor) {
      const { data } = await supabase
        .from('perfis_usuarios')
        .select('id, nome')
        .ilike('nome', nomeVendedor)
        .eq('tipo', 'vendedor')
        .single();
      vendedor = data;
    }

    if (!vendedor) {
      console.error(`Vendedor '${nomeVendedor}' não encontrado`);
      return new Response(JSON.stringify({
        success: false,
        message: `Vendedor '${nomeVendedor}' não encontrado`
      }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Vendedor encontrado: ${vendedor.nome} (ID: ${vendedor.id})`);

    let processados = 0;
    let erros = [];

    // Processar cada cliente
    for (const cliente of clientes) {
      try {
        const {
          nome,
          telefone,
          email,
          cidade,
          estado,
          origem,
          etiqueta,
          status_atendimento,
          criativo_facebook,
          qual_animal,
          quantos_animais,
          oque_precisa,
          qual_fabrica,
          botao_interesse,
          qualidade,
          respondeu_ia,
          vendedor_responsavel,
          lead_confirmou_chamada,
          respondeu_vendedor,
          avaliacao_cliente,
          passou_preco,
          desativa_ia,
          historico_conversa,
          // Mapeamento para campos com nomes diferentes
          'Qual Animal': qual_animal_alt,
          'Quantos animais': quantos_animais_alt,
          'Primeira Mensagem': primeira_mensagem,
          apoio_funil
        } = cliente;

        // Usar os valores alternativos se disponíveis
        const qual_animal_final = qual_animal || qual_animal_alt;
        const quantos_animais_final = quantos_animais || quantos_animais_alt;

        if (!nome || !telefone) {
          erros.push(`Cliente sem nome ou telefone: ${JSON.stringify(cliente)}`);
          continue;
        }

        // Normalizar telefone removendo o "+" para evitar duplicações
        const telefoneNormalizado = telefone.startsWith('+') ? telefone.substring(1) : telefone;

        // Criar observações detalhadas com todos os campos extras
        const observacoesCRM = [
          criativo_facebook && `Criativo FB: ${criativo_facebook}`,
          qual_animal_final && `Animal: ${qual_animal_final}`,
          quantos_animais_final && `Qtd Animais: ${quantos_animais_final}`,
          oque_precisa && `Necessidade: ${oque_precisa}`,
          qual_fabrica && `Fábrica: ${qual_fabrica}`,
          botao_interesse && `Interesse: ${botao_interesse}`,
          primeira_mensagem && `Primeira Mensagem: ${primeira_mensagem}`,
          apoio_funil && `Apoio Funil: ${apoio_funil}`,
          respondeu_ia && `Respondeu IA: ${respondeu_ia}`,
          vendedor_responsavel && `Vendedor Resp: ${vendedor_responsavel}`,
          lead_confirmou_chamada && `Confirmou Chamada: ${lead_confirmou_chamada}`,
          respondeu_vendedor && `Respondeu Vendedor: ${respondeu_vendedor}`,
          avaliacao_cliente && `Avaliação: ${avaliacao_cliente}`,
          passou_preco && `Passou Preço: ${passou_preco}`,
          desativa_ia && `Desativa IA: ${desativa_ia}`,
          historico_conversa && `Histórico: ${historico_conversa}`
        ].filter(Boolean).join(' | ');

        // 1. Processar etiqueta principal se existir
        if (etiqueta) {
          console.log(`Processando etiqueta principal: ${etiqueta} para ${telefoneNormalizado}`);
          await processarEtiqueta(supabase, telefoneNormalizado, etiqueta, vendedor.id);
        }

        // 2. Processar status de atendimento se existir
        if (status_atendimento) {
          console.log(`Processando status de atendimento: ${status_atendimento} para ${telefoneNormalizado}`);
          await processarEtiqueta(supabase, telefoneNormalizado, status_atendimento, vendedor.id);
        }

        // 3. Adicionar tag automática do vendedor SEMPRE
        console.log(`Adicionando tag de vendedor: ${vendedor.nome} para ${telefoneNormalizado}`);
        await adicionarEtiqueta(supabase, telefoneNormalizado, `VENDEDOR: ${vendedor.nome.toUpperCase()}`, vendedor.id);

        // 4. Verificar se já existe alguma etiqueta de funil para este contato
        const { data: etiquetasFunil } = await supabase
          .from('etiquetas_leads')
          .select('etiqueta')
          .eq('telefone', telefoneNormalizado)
          .eq('vendedor_id', vendedor.id)
          .in('etiqueta', ETIQUETAS_FUNIL);

        // 5. Se não tem etiqueta de funil e também não veio etiqueta no payload, adicionar PROSPECÇÃO como padrão
        if ((!etiquetasFunil || etiquetasFunil.length === 0) && (!etiqueta || !ETIQUETAS_FUNIL.includes(normalizarEtiqueta(etiqueta)))) {
          console.log(`Adicionando etiqueta padrão PROSPECÇÃO para novo lead: ${telefoneNormalizado}`);
          await adicionarEtiqueta(supabase, telefoneNormalizado, 'PROSPECÇÃO', vendedor.id);
        }

        // 6. Verificar se já existe etiqueta de status de atendimento
        const { data: etiquetasAtendimento } = await supabase
          .from('etiquetas_leads')
          .select('etiqueta')
          .eq('telefone', telefoneNormalizado)
          .eq('vendedor_id', vendedor.id)
          .in('etiqueta', STATUS_ATENDIMENTO);

        // 7. Se não tem etiqueta de atendimento, adicionar ABERTO como padrão
        if ((!etiquetasAtendimento || etiquetasAtendimento.length === 0) && (!status_atendimento || !STATUS_ATENDIMENTO.includes(normalizarEtiqueta(status_atendimento)))) {
          console.log(`Adicionando etiqueta padrão ABERTO para novo lead: ${telefoneNormalizado}`);
          await adicionarEtiqueta(supabase, telefoneNormalizado, 'ABERTO', vendedor.id);
        }

        // 8. Processar etiqueta de qualidade se existir  
        if (qualidade && qualidade.trim() !== '') {
          console.log(`Processando qualidade: ${qualidade} para ${telefoneNormalizado}`);
          await processarEtiqueta(supabase, telefoneNormalizado, qualidade, vendedor.id);
        }

        // 2. Buscar todas as etiquetas atuais do telefone
        const { data: todasEtiquetas } = await supabase
          .from('etiquetas_leads')
          .select('etiqueta, data_aplicada')
          .eq('telefone', telefoneNormalizado)
          .eq('vendedor_id', vendedor.id)
          .order('data_aplicada', { ascending: false });

        // 3. Criar observações completas
        const etiquetasStr = todasEtiquetas?.length 
          ? `Etiquetas: ${todasEtiquetas.map(e => e.etiqueta).join(', ')}`
          : qualidade ? `Etiqueta: ${qualidade}` : '';

        const observacoesFinais = [etiquetasStr, observacoesCRM]
          .filter(Boolean)
          .join(' | ');

        // 4. Verificar se o lead já existe para determinar se é atualização ou criação
        const { data: leadExistente } = await supabase
          .from('leads_webhook')
          .select('id')
          .eq('telefone', telefoneNormalizado)
          .eq('vendedor_id', vendedor.id)
          .single();

        console.log(`📞 Processando lead para telefone ${telefoneNormalizado} - ${leadExistente ? 'atualizando' : 'criando'}`);
        
        const { error: leadError } = await supabase
          .from("leads_webhook")
          .upsert({
            nome,
            telefone: telefoneNormalizado,
            // telefone_norm será preenchido automaticamente pelo trigger
            email: email || null,
            cidade: cidade || null,
            estado: estado || null,
            origem: origem || 'PLANILHA CRM',
            vendedor_id: vendedor.id,
            observacoes: observacoesFinais,
            // Novos campos da planilha CRM
            criativo_facebook: criativo_facebook || null,
            qual_animal: qual_animal_final || null,
            quantos_animais: quantos_animais_final || null,
            oque_precisa: oque_precisa || null,
            qual_fabrica: qual_fabrica || null,
            botao_interesse: botao_interesse || null,
            qualidade: qualidade || null,
            respondeu_ia: respondeu_ia || null,
            vendedor_responsavel: vendedor_responsavel || null,
            lead_confirmou_chamada: lead_confirmou_chamada || null,
            respondeu_vendedor: respondeu_vendedor || null,
            avaliacao_cliente: avaliacao_cliente || null,
            passou_preco: passou_preco || null,
            desativa_ia: desativa_ia || null,
            historico_conversa: historico_conversa || primeira_mensagem || null,
            updated_at: new Date().toISOString()
          }, { 
            onConflict: 'telefone_norm',
            ignoreDuplicates: false 
          });

        if (leadError) {
          console.error(`Erro ao inserir lead ${nome}:`, leadError);
          erros.push(`Erro no lead ${nome}: ${leadError.message}`);
          continue;
        }

        // Sincronizar na nova estrutura de contacts/contact_labels
        await sincronizarNovoSistema(supabase, telefoneNormalizado, vendedor.id, {
          nome,
          email: cliente.email,
          cidade: cliente.cidade || cidade,
          estado: cliente.estado || estado,
          origem,
          observacoesCRM,
          created_at: new Date().toISOString()
        });

        console.log(`✅ Lead processado: ${nome} - ${telefoneNormalizado} - ${qualidade || 'sem etiqueta'}`);
        processados++;

      } catch (error) {
        console.error(`Erro ao processar cliente:`, error);
        erros.push(`Erro no cliente ${cliente.nome || 'sem nome'}: ${error.message}`);
      }
    }

    return new Response(JSON.stringify({
      success: processados > 0,
      message: `${processados} leads processados com sucesso`,
      processados,
      total: clientes.length,
      erros: erros.length > 0 ? erros : undefined,
      vendedor: vendedor.nome,
      timestamp: new Date().toISOString()
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    return new Response(JSON.stringify({
      success: false,
      message: error.message || 'Erro interno do servidor'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processarEtiqueta(supabase: any, telefone: string, etiqueta: string, vendedorId: string) {
  if (!etiqueta || etiqueta.trim() === '') {
    console.log(`Etiqueta vazia ou inválida para ${telefone}`);
    return;
  }
  
  const etiquetaNormalizada = normalizarEtiqueta(etiqueta);
  console.log(`Processando etiqueta: "${etiqueta}" -> "${etiquetaNormalizada}" para ${telefone}`);
  
  if (ETIQUETAS_FUNIL.includes(etiquetaNormalizada)) {
    // 🟩 FUNIL - Pode ter múltiplas etiquetas simultaneamente
    console.log(`🟩 Adicionando etiqueta do funil: ${etiquetaNormalizada}`);
    await adicionarEtiqueta(supabase, telefone, etiquetaNormalizada, vendedorId);
    
  } else if (ETIQUETAS_STATUS_LEAD.includes(etiquetaNormalizada)) {
    // 🟨 STATUS DO LEAD - Apenas uma etiqueta por vez (exclusividade)
    console.log(`🟨 Substituindo status do lead: ${etiquetaNormalizada}`);
    await substituirEtiquetaCategoria(supabase, telefone, etiquetaNormalizada, vendedorId, ETIQUETAS_STATUS_LEAD);
    
  } else if (STATUS_ATENDIMENTO.includes(etiquetaNormalizada)) {
    // 🟧 STATUS DE ATENDIMENTO - Apenas um por vez (exclusividade)
    console.log(`🟧 Substituindo status de atendimento: ${etiquetaNormalizada}`);
    await substituirEtiquetaCategoria(supabase, telefone, etiquetaNormalizada, vendedorId, STATUS_ATENDIMENTO);
    
  } else if (CLASSIFICACAO_LEAD.includes(etiquetaNormalizada)) {
    // 🔴 CLASSIFICAÇÃO DO LEAD - Apenas uma por vez (exclusividade)
    console.log(`🔴 Substituindo classificação do lead: ${etiquetaNormalizada}`);
    await substituirEtiquetaCategoria(supabase, telefone, etiquetaNormalizada, vendedorId, CLASSIFICACAO_LEAD);
    
  } else {
    // Etiqueta não categorizada - adicionar como nova
    console.log(`Adicionando etiqueta não categorizada: ${etiquetaNormalizada}`);
    await adicionarEtiqueta(supabase, telefone, etiquetaNormalizada, vendedorId);
  }
}

async function adicionarEtiqueta(supabase: any, telefone: string, etiqueta: string, vendedorId: string) {
  // Verificar se a etiqueta já existe hoje para este telefone
  const { data: existeEtiqueta } = await supabase
    .from("etiquetas_leads")
    .select('id')
    .eq('telefone', telefone)
    .eq('etiqueta', etiqueta)
    .eq('vendedor_id', vendedorId)
    .gte('data_aplicada', new Date().toISOString().split('T')[0]) // hoje
    .single();

  if (existeEtiqueta) {
    console.log(`⚠️ Etiqueta ${etiqueta} já existe hoje para ${telefone} - pulando inserção`);
    return;
  }

  const { error } = await supabase.from("etiquetas_leads").insert([
    {
      telefone,
      etiqueta,
      vendedor_id: vendedorId,
      data_aplicada: new Date().toISOString()
    }
  ]);
  
  if (error) {
    console.error(`❌ Erro ao adicionar etiqueta ${etiqueta}:`, error);
    throw error;
  }
  
  console.log(`✅ Etiqueta adicionada: ${etiqueta} para ${telefone}`);
}

async function substituirEtiquetaCategoria(supabase: any, telefone: string, etiqueta: string, vendedorId: string, categoria: string[]) {
  console.log(`🔄 Removendo etiquetas da categoria [${categoria.join(', ')}] para ${telefone}`);
  
  // 1. Deletar etiquetas existentes da mesma categoria
  const { error: deleteError } = await supabase
    .from("etiquetas_leads")
    .delete()
    .eq('telefone', telefone)
    .eq('vendedor_id', vendedorId)
    .in('etiqueta', categoria);

  if (deleteError) {
    console.error(`❌ Erro ao deletar etiquetas da categoria:`, deleteError);
    throw deleteError;
  }

  // 2. Verificar se a nova etiqueta já existe hoje
  const { data: existeEtiqueta } = await supabase
    .from("etiquetas_leads")
    .select('id')
    .eq('telefone', telefone)
    .eq('etiqueta', etiqueta)
    .eq('vendedor_id', vendedorId)
    .gte('data_aplicada', new Date().toISOString().split('T')[0]) // hoje
    .single();

  if (existeEtiqueta) {
    console.log(`⚠️ Etiqueta ${etiqueta} já existe hoje para ${telefone} - não adicionando novamente`);
    return;
  }

  // 3. Inserir a nova etiqueta
  const { error: insertError } = await supabase.from("etiquetas_leads").insert([
    {
      telefone,
      etiqueta,
      vendedor_id: vendedorId,
      data_aplicada: new Date().toISOString()
    }
  ]);
  
  if (insertError) {
    console.error(`❌ Erro ao inserir nova etiqueta ${etiqueta}:`, insertError);
    throw insertError;
  }
  
  console.log(`✅ Etiqueta substituída: ${etiqueta} para ${telefone}`);
}

// Função para sincronizar dados na nova estrutura de contacts/labels
async function sincronizarNovoSistema(supabase: any, telefone: string, vendedorId: string, dadosLead: any) {
  try {
    // Inserir/atualizar na tabela contacts
    const { data: contactData, error: contactError } = await supabase
      .from('contacts')
      .upsert({
        phone: telefone,
        name: dadosLead.nome || 'Cliente sem nome',
        email: dadosLead.email,
        city: dadosLead.cidade,
        state: dadosLead.estado,
        origin: dadosLead.origem || 'WEBHOOK',
        notes: dadosLead.observacoesCRM,
        vendor_id: vendedorId,
        status: 'ABERTO',
        is_closed: false,
        created_at: dadosLead.created_at
      }, {
        onConflict: 'phone'
      })
      .select()
      .single();

    if (contactError) {
      console.log(`⚠️ Erro ao sincronizar contact para ${telefone}:`, contactError);
      return;
    }

    console.log(`📱 Contact sincronizado para ${telefone}`);
    
    // Buscar etiquetas aplicadas recentemente para este telefone
    const { data: etiquetasRecentes } = await supabase
      .from('etiquetas_leads')
      .select('etiqueta')
      .eq('telefone', telefone)
      .eq('vendedor_id', vendedorId)
      .gte('data_aplicada', new Date(Date.now() - 5 * 60 * 1000).toISOString()) // últimos 5 minutos
      .order('data_aplicada', { ascending: false });

    // Sincronizar etiquetas aplicadas recentemente
    for (const etiquetaObj of etiquetasRecentes || []) {
      const { data: labelData } = await supabase
        .from('labels')
        .select('id, label_group')
        .eq('name', etiquetaObj.etiqueta)
        .single();

      if (labelData && contactData) {
        // Primeiro, desativar outras etiquetas do mesmo grupo
        await supabase
          .from('contact_labels')
          .update({ active: false })
          .eq('contact_id', contactData.id)
          .eq('label_group', labelData.label_group);

        // Depois, inserir/ativar a nova etiqueta
        await supabase
          .from('contact_labels')
          .upsert({
            contact_id: contactData.id,
            label_id: labelData.id,
            active: true,
            source: 'webhook'
          }, {
            onConflict: 'contact_id,label_id'
          });

        console.log(`🏷️ Etiqueta ${etiquetaObj.etiqueta} sincronizada para contact ${contactData.id}`);
      }
    }

  } catch (error) {
    console.log(`⚠️ Erro na sincronização do novo sistema para ${telefone}:`, error);
  }
}
