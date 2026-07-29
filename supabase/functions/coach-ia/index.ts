import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026';
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type'
};
const jsonResp = (o, status = 200)=>new Response(JSON.stringify(o), {
    status,
    headers: {
      ...CORS,
      'content-type': 'application/json'
    }
  });
const PROMPT_BASE_BRANORTE = `
=========================================================
│ EMPRESA: BRANORTE — conhecimento de produto + venda
=========================================================
Metalúrgica brasileira de equipamentos pra FÁBRICA DE RAÇÃO e ARMAZENAGEM DE GRÃOS. Venda B2B consultiva, ticket alto (médio ~R$45k, deals R$96k+), ciclo longo. 93% das vendas pelo WhatsApp.
SÓ ração FARELADA (não extrusada/peletizada). NÃO fabrica: extrusora, peletizadora, ração pet/peixe pronta, ensiladeira. Material: chapa galvanizada (padrão) ou aço inox (~2,5x). Painel elétrico NÃO vem incluso nas fábricas.
LINHAS: Fábricas Compactas (kg/h = CV do moinho x 100; faixas 300 a 5.000 kg/h; 01 básica / 02 +caçamba+balança / 03 industrial; PADRÃO=misturador vertical p/ aves-suínos, MASTER=horizontal quando há SAL/bovino). Misturadores, Moinho de martelo (3-100CV, motor 2 polos), Silos (farelo de soja exige funil 60°), Transportadores (chupim/rosca/TH/elevador), Ensacadeira, Pré-limpeza, Caçamba de pesagem.
MOTOR incluso: TH calha, elevador, misturador horizontal, caçamba, pré-limpeza, esteira, ensacadeira. Motor AVULSO: chupim, misturador vertical, moinho de martelo.
CONSUMO (kg/dia/cabeça): bovino confinamento 8-12 / semi 4-6 / proteinado 0,3-1,0 / sal 0,05-0,12; ave poedeira ~0,115 / corte ~0,107; suíno ciclo ~2. A FORMULAÇÃO muda a fábrica 15-20x -> SEMPRE perguntar.
Funil: PROSPECÇÃO -> 2A TENTATIVA -> NOVO LEAD -> FOLLOW UP -> INTERESSE FUTURO -> VENDIDO.
ROI: ração comprada ~R$2,80/kg vs própria ~R$1,80/kg = 30-40% economia; payback Compacta JR ~8-14 meses. Financiamento: Pronaf Mais Alimentos, BNDES Finame. NUNCA citar % ou parcela exata sem confirmar.
Regras: garantia 1 ano, frete por conta do cliente. Vendedores: Daniel, Pedro, Eder, Ramon, Jardel, Gustavo, Alvaro, Edilson Jr. Frete=Jardel; Compras=Edilson.
TOM: consultivo, direto, caloroso do interior (produtor rural). ZERO gíria urbana (bora/no corre/curtiu). Emoji pontual.
`;
const REGRA_ANTI_ALUCINACAO = `
=========================================================
│ REGRA INVIOLÁVEL: ANTI-ALUCINAÇÃO
=========================================================
Você recebe PRODUTO_DETECTADO e SEGMENTO_DETECTADO. Se = "NÃO ESPECIFICADO": use linguagem NEUTRA ("sua proposta", "o equipamento", "sua operação") e NUNCA cite produto Branorte específico (JR/Compacta/Master/Misturador/Moinho/Silo) nem segmento (leitão/postura/corte/tilápia).
NUNCA invente cidade, estado, modelo, capacidade, preço, quantidade de animais ou condição que o cliente não informou.
NUNCA afirme como FATO que "orçamento foi enviado", "boleto foi enviado" ou "cliente aprovou" sem uma mensagem-evidência clara (um documento/PDF na conversa ou o vendedor dizendo explicitamente que enviou). Sem evidência, isso é INFORMAÇÃO FALTANTE, não fato.
Áudio sem transcrição = conteúdo DESCONHECIDO. Nunca suponha o que foi dito; liste como informação faltante e reduza a confiança.
A MEMÓRIA DO CLIENTE (se vier) é contexto de conversas passadas: use pra dar continuidade, mas se a conversa atual contradiz, a conversa ATUAL vale mais.
Se a BASE DE CONHECIMENTO OFICIAL contradisser este texto, a BASE OFICIAL vence (ela é auditada).
`;
const PROMPT_CONTRATO_JSON = `
=========================================================
│ SAÍDA OBRIGATÓRIA: SOMENTE UM OBJETO JSON VÁLIDO
=========================================================
Não escreva NADA fora do JSON (sem markdown, sem comentário). O JSON tem EXATAMENTE estas chaves:

{
  "resumo": "2 a 4 frases sobre em que pé está a negociação, só com o que está na conversa",
  "etapa": { "valor": "<uma_das_etapas>", "confianca": "ALTA|MEDIA|BAIXA", "evidencias": ["<msg_id>", ...] },
  "temperatura": "QUENTE|MORNO|FRIO|PERDIDO",
  "fatos": [ { "texto": "afirmação comprovada", "msg_id": "<id_existente_na_conversa>", "confianca": "ALTA|MEDIA|BAIXA" } ],
  "interpretacoes": [ { "texto": "hipótese provável", "base": "por que você infere isso", "confianca": "ALTA|MEDIA|BAIXA" } ],
  "informacoesFaltantes": [ { "item": "o que falta saber", "motivo": "por que importa", "acao": "como descobrir" } ],
  "objecoes": [ { "tipo": "preco|prazo|concorrente|socio|frete|pensar|espaco|energia|outro", "texto": "trecho", "msg_id": "<id>" } ],
  "sinaisCompra": [ { "texto": "sinal de interesse/compra", "msg_id": "<id>" } ],
  "riscos": [ { "texto": "risco da negociação", "base": "evidência/tempo" } ],
  "quemAguarda": "cliente|vendedor|indefinido",
  "proximaAcao": { "tipo": "<um_dos_tipos>", "motivo": "1 frase objetiva" },
  "mensagemSugerida": "texto pronto pra enviar (curto, WhatsApp, máx 3-4 linhas, 1a pessoa do cliente) OU string vazia se a pergunta não pede mensagem",
  "perfilSugerido": { "interesse": "1 linha (máx 90 chars) do que o cliente QUER + a necessidade dele (ex: 'Fábrica compacta 500kg/h p/ gado de corte'); SÓ com o que ele disse; string vazia se não dá pra saber" }
}

ETAPAS válidas: novo_lead, primeira_abordagem, qualificacao, descoberta_necessidade, dimensionamento, apresentacao_solucao, orcamento_solicitado, orcamento_enviado, follow_up, negociacao, aguardando_decisao, aguardando_dados, aguardando_pagamento, fechamento, vendido, interesse_futuro, nao_respondeu, sem_interesse, fora_orcamento, comprou_concorrente, nao_fabricamos, encerrado.
TIPOS de proximaAcao: primeira_abordagem, qualificar, descobrir_finalidade, perguntar_animal, perguntar_quantidade, perguntar_consumo, perguntar_espaco, perguntar_energia, entender_prazo, recomendar_equipamento, explicar_funcionamento, demonstrar_economia, enviar_catalogo, enviar_video, solicitar_orcamento, enviar_orcamento, follow_up, responder_objecao, negociar_condicao, pedir_dados, enviar_pagamento, confirmar_fechamento, agendar_contato, reativar, encerrar.

REGRAS DO JSON:
- TODO item de "fatos" DEVE ter um "msg_id" que aparece na conversa (a conversa vem com [id=...] em cada linha). Se você não consegue apontar a mensagem, NÃO é fato: mova pra "interpretacoes".
- "etapa.evidencias" deve conter msg_id(s) reais que sustentam a etapa.
- Para marcar etapa=orcamento_enviado, PRECISA de evidência (documento/PDF na conversa OU vendedor dizendo que enviou). Sem isso, use a etapa anterior e ponha "orçamento ainda não consta como enviado" em informacoesFaltantes.
- Se houver áudio SEM transcrição, adicione um item em informacoesFaltantes e rebaixe etapa.confianca.
- "perfilSugerido.interesse": resuma em 1 linha o que o cliente quer e precisa, com base SÓ na conversa. Se não houver informação suficiente, use string vazia. NUNCA invente equipamento/segmento que o cliente não mencionou.
- A "mensagemSugerida" deve ser coerente com a "proximaAcao", respeitar a BASE DE CONHECIMENTO OFICIAL (fatos, anti-loop, nunca prometer prazo/preço sem confirmação) e NUNCA prometer algo sem evidência.
`;
function detectarProduto(s) {
  const t = String(s || '').toLowerCase();
  if (!t.trim()) return null;
  if (/\bjr ?pro\b/.test(t)) return 'Fábrica Compacta JR Pro';
  if (/\b(compacta|jr|master)\b/.test(t)) return 'Fábrica Compacta';
  if (/\b(misturador|mistur)\b/.test(t)) return 'Misturador';
  if (/\b(moinho|martelo)\b/.test(t)) return 'Moinho Martelo';
  if (/\b(silo)\b/.test(t)) return 'Silo';
  if (/\b(esteira)\b/.test(t)) return 'Esteira';
  if (/\b(ensacadeira|ensacar)\b/.test(t)) return 'Ensacadeira';
  return null;
}
function detectarSegmento(s) {
  const t = String(s || '').toLowerCase();
  if (!t.trim()) return null;
  if (/\b(su[íi]no|porco|leitao|leitão)\b/.test(t)) return 'suínos';
  if (/\b(gado|boi|bovin|nelore|leite)\b/.test(t)) return 'gado';
  if (/\b(ave|frango|galinha|poedeira)\b/.test(t)) return 'aves';
  if (/\b(peixe|piscicultura|tilapia)\b/.test(t)) return 'peixes';
  return null;
}
function extrairTextoTotal(m) {
  if (!Array.isArray(m)) return '';
  return m.map((x)=>`${x.body || ''} ${x.transcricao || ''} ${x.caption || ''}`).join(' ');
}
const SUB_AGENTS = {
  DISCOVERY: 'Foco: qualificação (SPIN) e descoberta. Faça 1 pergunta por vez, linguagem do produtor (quantas cabeças, qual ração, cria ou engorda). A mensagemSugerida confirma algo que o cliente disse e termina com 1 pergunta.',
  CLOSER: 'Foco: apresentar solução e fechar. Se o cliente perguntou prazo/pagamento/garantia/frete/PIX ou disse manda boleto, NÃO faça pergunta extra: conduza ao fechamento com próximo passo concreto (2 opções, compromisso explícito). Evite desconto não pedido.',
  REANIMADOR: 'Cliente FRIO/parado 3-15 dias. mensagemSugerida leve, sem cobrança, traz valor novo, pergunta aberta sobre a situação atual. Máx 2 linhas. Nunca culpa (nada de "sumiu né").',
  QUEBRA_OBJECAO: 'Cliente com objeção. Método: reconhece -> reenquadra pro custo de NÃO investir/ROI -> oferece caminho (Pronaf/parcela) -> reconfirma. NUNCA dá desconto sem contrapartida. Se "vou pensar", agenda dia específico.',
  AGREGADO: 'Pergunta sobre a carteira. Priorize ações e diga qual cliente atacar primeiro e por quê.'
};
function roteadorSubAgente(pergunta, msgs) {
  const p = String(pergunta || '').toLowerCase();
  if (/quem (esta|está|tá)|funil|carteira|todos|ranking|fechar hoje/i.test(p)) return 'AGREGADO';
  if (/objeç|caro|concorrente|pensar|sócio|esposa|frete|sem dinheiro/i.test(p)) return 'QUEBRA_OBJECAO';
  if (/reanim|parado|sumiu|esfriou|reativar|frio/i.test(p)) return 'REANIMADOR';
  if (/fechar|fecha|boleto|pix|pagamento|garantia|prazo|instalaç/i.test(p)) return 'CLOSER';
  if (Array.isArray(msgs) && msgs.length < 5) return 'DISCOVERY';
  return 'CLOSER';
}
function montarSystemPrompt(subAgent, kb) {
  const esp = SUB_AGENTS[subAgent] ?? SUB_AGENTS.CLOSER;
  const blocoKb = kb ? `\n=========================================================\n│ BASE DE CONHECIMENTO OFICIAL (Ana/Branorte — fonte de verdade auditável)\n=========================================================\n${kb}\n` : '';
  return `Você é o COPILOTO COMERCIAL da Branorte (sub-agente ${subAgent}). Você NÃO é um gerador de mensagens: primeiro ENTENDE a conversa por EVIDÊNCIA, separa FATO de HIPÓTESE, descobre o que falta, e SÓ ENTÃO sugere a próxima ação e a mensagem.

ORIENTAÇÃO DO SUB-AGENTE: ${esp}

${PROMPT_BASE_BRANORTE}
${blocoKb}
${REGRA_ANTI_ALUCINACAO}
${PROMPT_CONTRATO_JSON}`;
}
// Base de conhecimento configurável (ia_conhecimento): empresa + overlay do vendedor.
async function carregarConhecimento(supa, vendedor) {
  if (!supa) return '';
  try {
    const { data } = await supa.from('ia_conhecimento').select('titulo, conteudo, escopo, vendedor_nome, ordem').eq('ativo', true).order('ordem', {
      ascending: true
    });
    if (!Array.isArray(data) || !data.length) return '';
    const rel = data.filter((r)=>r.escopo === 'empresa' || String(r.vendedor_nome || '').toUpperCase() === String(vendedor || '').toUpperCase());
    let out = '';
    for (const r of rel){
      const bloco = `\n## ${r.titulo}\n${r.conteudo}\n`;
      if (out.length + bloco.length > 7000) break;
      out += bloco;
    }
    return out;
  } catch  {
    return '';
  }
}
function formatarMensagens(mensagens, nomeContato, vendedor) {
  if (!Array.isArray(mensagens) || mensagens.length === 0) return '(sem histórico)';
  const ord = [
    ...mensagens
  ].sort((a, b)=>(a.t ?? 0) - (b.t ?? 0));
  const linhas = [];
  for (const m of ord){
    const id = String(m.id || m.msg_id || '');
    const tag = m.fromMe ? `EU/VENDEDOR (${vendedor})` : `CLIENTE (${nomeContato})`;
    let c = '';
    if (m.type === 'chat' || m.type === 'text') c = m.body ?? '';
    else if (m.type === 'audio' || m.type === 'ptt') {
      const dur = m.duration ? `${Math.round(m.duration)}s` : '';
      c = m.transcricao && String(m.transcricao).trim() ? `[ÁUDIO ${dur}] transcrito: "${String(m.transcricao).trim()}"` : `[ÁUDIO ${dur} — SEM TRANSCRIÇÃO: conteúdo desconhecido]`;
    } else if (m.type === 'image') c = `[IMAGEM${m.caption ? ': "' + m.caption + '"' : ''}]`;
    else if (m.type === 'video') c = `[VÍDEO${m.caption ? ': "' + m.caption + '"' : ''}]`;
    else if (m.type === 'document') c = `[DOCUMENTO: ${m.filename ?? '?'}]`;
    else if (m.type === 'sticker') c = '[FIGURINHA]';
    else c = `[${m.type}]`;
    if (c.length > 600) c = c.slice(0, 597) + '...';
    const ts = m.t ? new Date(m.t * 1000).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }) : '';
    linhas.push(`[id=${id}] [${ts}] ${tag}: ${c}`);
  }
  return linhas.join('\n');
}
function quemAguardaHeuristico(mensagens) {
  if (!Array.isArray(mensagens) || !mensagens.length) return 'indefinido';
  let ult = null;
  for (const m of mensagens){
    if (!ult || (m.t ?? 0) > (ult.t ?? 0)) ult = m;
  }
  if (!ult) return 'indefinido';
  return ult.fromMe ? 'vendedor' : 'cliente';
}
function mapTemperaturaSaude(t) {
  const s = String(t || '').toUpperCase();
  if (s.includes('QUENTE')) return 'QUENTE 🔥';
  if (s.includes('MORNO')) return 'MORNO ♨️';
  if (s.includes('FRIO')) return 'FRIO ❄️';
  if (s.includes('PERDIDO')) return 'PERDIDO ⚰️';
  return null;
}
function arr(x) {
  return Array.isArray(x) ? x : [];
}
function normalizarEstrutura(est, idsValidos, quemAguardaHeur, audiosPendentes) {
  const out = {
    resumo: String(est?.resumo || '').slice(0, 800),
    etapa: {
      valor: String(est?.etapa?.valor || 'novo_lead'),
      confianca: String(est?.etapa?.confianca || 'BAIXA').toUpperCase(),
      evidencias: arr(est?.etapa?.evidencias).map(String).filter((id)=>idsValidos.has(id))
    },
    temperatura: String(est?.temperatura || 'FRIO').toUpperCase().replace(/[^A-Z]/g, '') || 'FRIO',
    fatos: [],
    interpretacoes: arr(est?.interpretacoes),
    informacoesFaltantes: arr(est?.informacoesFaltantes),
    objecoes: arr(est?.objecoes),
    sinaisCompra: arr(est?.sinaisCompra),
    riscos: arr(est?.riscos),
    quemAguarda: String(est?.quemAguarda || '').toLowerCase(),
    proximaAcao: {
      tipo: String(est?.proximaAcao?.tipo || 'qualificar'),
      motivo: String(est?.proximaAcao?.motivo || '')
    },
    mensagemSugerida: String(est?.mensagemSugerida || '').trim(),
    perfilSugerido: {
      interesse: String(est?.perfilSugerido?.interesse || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    }
  };
  for (const f of arr(est?.fatos)){
    const mid = String(f?.msg_id || '');
    if (mid && idsValidos.has(mid)) out.fatos.push({
      texto: String(f?.texto || ''),
      msg_id: mid,
      confianca: String(f?.confianca || 'MEDIA').toUpperCase()
    });
    else if (f?.texto) out.interpretacoes.push({
      texto: String(f.texto),
      base: 'sem evidência rastreável na conversa',
      confianca: 'BAIXA'
    });
  }
  out.quemAguarda = quemAguardaHeur !== 'indefinido' ? quemAguardaHeur : [
    'cliente',
    'vendedor'
  ].includes(out.quemAguarda) ? out.quemAguarda : 'indefinido';
  if (audiosPendentes > 0) {
    const jaTem = out.informacoesFaltantes.some((i)=>/áudio|audio|transcri/i.test(JSON.stringify(i)));
    if (!jaTem) out.informacoesFaltantes.unshift({
      item: `${audiosPendentes} áudio(s) do cliente sem transcrição`,
      motivo: 'o conteúdo pode conter specs/preço/decisão',
      acao: 'transcrever antes de afirmar qualquer coisa sobre esses áudios'
    });
    if (out.etapa.confianca === 'ALTA') out.etapa.confianca = 'MEDIA';
  }
  return out;
}
function construirRespostaMarkdown(n) {
  const L = [];
  if (n.resumo) L.push('## 🔍 Diagnóstico', n.resumo, '');
  const tempTxt = mapTemperaturaSaude(n.temperatura) || n.temperatura;
  L.push(`**Etapa:** ${n.etapa.valor} (${n.etapa.confianca})  ·  **Temperatura:** ${tempTxt}  ·  **Quem aguarda:** ${n.quemAguarda}`, '');
  if (n.fatos.length) {
    L.push('**✅ Fatos (com evidência):**');
    for (const f of n.fatos)L.push(`- ${f.texto}`);
    L.push('');
  }
  if (n.interpretacoes.length) {
    L.push('**🤔 Interpretações (a confirmar):**');
    for (const i of n.interpretacoes)L.push(`- ${i.texto}`);
    L.push('');
  }
  if (n.informacoesFaltantes.length) {
    L.push('**❓ Falta descobrir:**');
    for (const i of n.informacoesFaltantes)L.push(`- ${i.item}`);
    L.push('');
  }
  if (n.objecoes.length) {
    L.push('**🛡️ Objeções:**');
    for (const o of n.objecoes)L.push(`- ${o.tipo}: ${o.texto}`);
    L.push('');
  }
  L.push(`**🎯 Próxima ação:** ${n.proximaAcao.tipo}${n.proximaAcao.motivo ? ' — ' + n.proximaAcao.motivo : ''}`);
  return L.join('\n').trim();
}
function calcularForecast(args) {
  const { mensagens, estagio, saude } = args;
  const m = Array.isArray(mensagens) ? mensagens : [];
  const agora = Date.now() / 1000;
  const ult = m.length ? Math.max(...m.map((x)=>x.t ?? 0)) : 0;
  const diasParado = ult ? (agora - ult) / 86400 : 999;
  const totalCli = m.filter((x)=>!x.fromMe).length;
  const totalEu = m.filter((x)=>x.fromMe).length;
  const textoCli = m.filter((x)=>!x.fromMe).map((x)=>x.body || x.transcricao || '').join(' ').toLowerCase();
  const sinaisFechamento = /\b(boleto|pix|prazo|garantia|frete|instalaç|quando posso|fechar|manda)\b/.test(textoCli);
  const sinaisInteresse = /\b(quanto|preço|preco|valor|orçamento|orcamento|disponível|disponivel)\b/.test(textoCli);
  const sinaisRecusa = /\b(não tenho|nao tenho|sem dinheiro|caro demais|outra hora|nao agora)\b/.test(textoCli);
  const e = String(estagio || '').toLowerCase();
  let prob = 5;
  if (/fecha|venda|vendido|pagamento/.test(e)) prob = 75;
  else if (/negocia|decisao|dados/.test(e)) prob = 55;
  else if (/orcamento_enviado|follow/.test(e)) prob = 45;
  else if (/apresenta|dimension|solicitad/.test(e)) prob = 35;
  else if (/descoberta|qualif/.test(e)) prob = 20;
  else if (/lead|abordagem/.test(e)) prob = 8;
  else if (/perdido|sem_interesse|concorrente|nao_fabric|encerrado/.test(e)) prob = 2;
  const s = String(saude || '').toLowerCase();
  if (/quente|🔥/.test(s)) prob += 15;
  else if (/morno|♨/.test(s)) prob += 5;
  else if (/frio|❄/.test(s)) prob -= 10;
  else if (/perdido|⚰/.test(s)) prob = Math.min(prob, 3);
  if (sinaisFechamento) prob += 15;
  if (sinaisInteresse) prob += 5;
  if (sinaisRecusa) prob -= 15;
  if (totalCli >= 5 && totalEu >= 3) prob += 5;
  if (diasParado > 7) prob -= 15;
  else if (diasParado > 3) prob -= 8;
  else if (diasParado < 1) prob += 5;
  prob = Math.max(0, Math.min(99, Math.round(prob)));
  const mot = [];
  if (sinaisFechamento) mot.push('cliente perguntou sobre boleto/prazo/PIX');
  else if (sinaisInteresse) mot.push('cliente pediu preço/orçamento');
  else if (sinaisRecusa) mot.push('cliente sinalizou recusa');
  if (diasParado > 7) mot.push(`${Math.round(diasParado)}d parado`);
  else if (diasParado < 1) mot.push('respondendo agora');
  return {
    prob,
    motivo: mot.length ? mot.join(' + ') : `estágio ${estagio || 'indefinido'}`,
    features: {
      estagio,
      saude,
      diasParado: Math.round(diasParado * 10) / 10,
      totalCli,
      totalEu
    }
  };
}
async function buscarGoldenExamples(supa, situacao) {
  if (!OPENAI_KEY || !supa) return [];
  try {
    const er = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: situacao.slice(0, 1500)
      })
    });
    if (!er.ok) return [];
    const ej = await er.json();
    const emb = ej.data?.[0]?.embedding;
    if (!emb) return [];
    const { data } = await supa.rpc('match_golden_examples', {
      query_embedding: emb,
      match_estagio: null,
      match_count: 2,
      match_threshold: 0.65
    });
    return Array.isArray(data) ? data : [];
  } catch  {
    return [];
  }
}
async function resolverPromptVersion(supa) {
  if (!supa) return null;
  try {
    const { data } = await supa.from('prompt_versions').select('id, version').eq('slug', 'coach-ia').eq('is_active', true).order('version', {
      ascending: false
    }).limit(1).maybeSingle();
    return data ? {
      id: data.id,
      version: data.version
    } : null;
  } catch  {
    return null;
  }
}
async function corrigirTexto(texto) {
  const sys = 'Você é um corretor de texto em português do Brasil. Corrija APENAS ortografia, gramática, pontuação e capitalização da mensagem, mantendo 100% o tom original (informal/formal), gírias, emojis e estilo. NÃO reescreva, NÃO adicione conteúdo, NÃO remova informação, NÃO traduza. Responda SOMENTE com o texto corrigido, sem aspas e sem explicação.';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_KEY}`
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: sys
        },
        {
          role: 'user',
          content: texto
        }
      ]
    })
  });
  if (!r.ok) throw new Error('openai ' + r.status + ' ' + (await r.text()).slice(0, 160));
  const jr = await r.json();
  return String(jr.choices?.[0]?.message?.content ?? texto).trim();
}
async function resolverMemoria(supa, chat_id) {
  if (!supa || !chat_id) return null;
  try {
    const { data } = await supa.from('customer_memories').select('*').eq('chat_id', chat_id).maybeSingle();
    return data || null;
  } catch  {
    return null;
  }
}
async function gravarMemoria(supa, chat_id, phone, vendedor_nome, nome_contato, n, produto, segmento, existente) {
  if (!supa || !chat_id) return;
  if (existente && existente.updated_by === 'vendedor') return;
  try {
    await supa.from('customer_memories').upsert({
      chat_id,
      phone: phone || null,
      vendedor_nome: vendedor_nome || null,
      nome_contato: nome_contato || null,
      estagio_conhecido: n.etapa?.valor || null,
      temperatura: n.temperatura || null,
      objecoes_abertas: n.objecoes || [],
      proximo_passo_combinado: n.proximaAcao ? `${n.proximaAcao.tipo}: ${n.proximaAcao.motivo}` : null,
      fatos_confirmados: n.fatos || [],
      produto_interesse: produto || null,
      segmento: segmento || null,
      updated_at: new Date().toISOString(),
      updated_by: 'ia'
    }, {
      onConflict: 'chat_id'
    });
  } catch (_) {}
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  if (req.method !== 'POST') return new Response('method not allowed', {
    status: 405,
    headers: CORS
  });
  const auth = req.headers.get('authorization') ?? '';
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) return jsonResp({
    error: 'unauthorized'
  }, 401);
  if (!OPENAI_KEY) return jsonResp({
    error: 'OPENAI_API_KEY nao configurada'
  }, 500);
  let body;
  try {
    body = await req.json();
  } catch  {
    return jsonResp({
      error: 'invalid json'
    }, 400);
  }
  if (body && body.mode === 'corrigir') {
    const texto = String(body.texto || body.pergunta || '').trim();
    if (!texto) return jsonResp({
      ok: false,
      error: 'texto vazio',
      resposta: ''
    }, 400);
    try {
      return jsonResp({
        ok: true,
        mode: 'corrigir',
        resposta: await corrigirTexto(texto)
      });
    } catch (e) {
      return jsonResp({
        ok: false,
        error: String(e?.message || e).slice(0, 200)
      }, 500);
    }
  }
  const { vendedor_nome, pergunta, contexto, historico, mensagens_chat, nome_contato, chat_id, imagens_url, forcar_agente, notas_vendedor, diagnostico_anterior } = body;
  if (!pergunta || !vendedor_nome) return jsonResp({
    error: 'vendedor_nome e pergunta sao obrigatorios'
  }, 400);
  const supa = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY) : null;
  const [memoriaCliente, kb] = await Promise.all([
    resolverMemoria(supa, chat_id),
    carregarConhecimento(supa, vendedor_nome)
  ]);
  const subAgent = typeof forcar_agente === 'string' && SUB_AGENTS[forcar_agente] ? forcar_agente : roteadorSubAgente(pergunta, mensagens_chat);
  const systemPrompt = montarSystemPrompt(subAgent, kb);
  const msgs = Array.isArray(mensagens_chat) ? mensagens_chat : [];
  const idsValidos = new Set(msgs.map((m)=>String(m.id || m.msg_id || '')).filter(Boolean));
  const quemAguardaHeur = quemAguardaHeuristico(msgs);
  const audiosPendentes = msgs.filter((m)=>(m.type === 'audio' || m.type === 'ptt') && !m.transcricao).length;
  const textoTotal = extrairTextoTotal(msgs) + ' ' + (contexto ? JSON.stringify(contexto) : '') + ' ' + (notas_vendedor || '') + ' ' + (memoriaCliente ? `${memoriaCliente.produto_interesse || ''} ${memoriaCliente.segmento || ''}` : '');
  const produto_detectado = detectarProduto(textoTotal);
  const segmento_detectado = detectarSegmento(textoTotal);
  let userPrompt = `VENDEDOR (eu): ${vendedor_nome}\nCLIENTE: ${nome_contato || 'desconhecido'}\n`;
  if (chat_id) userPrompt += `chat_id: ${chat_id}\n`;
  userPrompt += `PRODUTO_DETECTADO: ${produto_detectado || 'NÃO ESPECIFICADO — NÃO INVENTAR PRODUTO'}\n`;
  userPrompt += `SEGMENTO_DETECTADO: ${segmento_detectado || 'NÃO ESPECIFICADO — NÃO INVENTAR SEGMENTO'}\n`;
  userPrompt += `QUEM_AGUARDA (fato do servidor pela última mensagem, use este valor): ${quemAguardaHeur}\n`;
  if (audiosPendentes > 0) userPrompt += `ATENÇÃO: ${audiosPendentes} áudio(s) do cliente SEM transcrição — trate como conteúdo desconhecido.\n`;
  if (memoriaCliente) userPrompt += `\nMEMÓRIA DO CLIENTE (do sistema, de conversas anteriores — use pra continuidade, confirme se mudou):\n${JSON.stringify({
    estagio: memoriaCliente.estagio_conhecido,
    temperatura: memoriaCliente.temperatura,
    objecoes: memoriaCliente.objecoes_abertas,
    proximo_passo: memoriaCliente.proximo_passo_combinado,
    produto: memoriaCliente.produto_interesse,
    segmento: memoriaCliente.segmento,
    atualizada_em: memoriaCliente.updated_at
  }).slice(0, 900)}\n`;
  if (notas_vendedor) userPrompt += `\nNOTAS DO VENDEDOR (contexto que ele anotou):\n${String(notas_vendedor).slice(0, 1500)}\n`;
  if (diagnostico_anterior) userPrompt += `\nDIAGNÓSTICO ANTERIOR (do sistema): ${JSON.stringify(diagnostico_anterior).slice(0, 800)}\n`;
  if (contexto) userPrompt += `\nDADOS DO CRM: ${typeof contexto === 'string' ? contexto : JSON.stringify(contexto)}\n`;
  userPrompt += `\n=== CONVERSA (cada linha começa com [id=...]; use esses ids como msg_id de evidência) ===\n${formatarMensagens(msgs, nome_contato || 'CLIENTE', vendedor_nome)}\n=== FIM ===\n`;
  const situacao = `${pergunta} | sub:${subAgent} | cliente:${nome_contato || ''}`.slice(0, 500);
  const golden = supa ? await buscarGoldenExamples(supa, situacao) : [];
  if (golden.length) {
    userPrompt += `\n=== EXEMPLOS DE MENSAGEM APROVADOS PELO VENDEDOR (só pra estilo da mensagemSugerida) ===\n`;
    for (const g of golden)userPrompt += `Situação: ${g.situacao_resumo}\nResposta aprovada: ${String(g.resposta_aprovada).slice(0, 600)}\n---\n`;
  }
  userPrompt += `\nPERGUNTA/PEDIDO DO VENDEDOR: ${pergunta}\n\nResponda SOMENTE com o objeto JSON do contrato.`;
  const useVision = Array.isArray(imagens_url) && imagens_url.length > 0;
  const userContent = useVision ? [
    {
      type: 'text',
      text: userPrompt
    },
    ...imagens_url.slice(0, 4).map((url)=>({
        type: 'image_url',
        image_url: {
          url
        }
      }))
  ] : userPrompt;
  const messages = [
    {
      role: 'system',
      content: systemPrompt
    },
    ...Array.isArray(historico) ? historico.slice(-4) : [],
    {
      role: 'user',
      content: userContent
    }
  ];
  const modelos = useVision ? [
    'gpt-4o'
  ] : [
    'gpt-5.4-mini',
    'gpt-4o-mini'
  ];
  let raw = null, modelUsado = null, usage = {}, lastErr = '';
  for (const model of modelos){
    try {
      const payload: any = {
        model,
        messages,
        response_format: {
          type: 'json_object'
        }
      };
      if (model.startsWith('gpt-5')) payload.max_completion_tokens = 1800;
      else {
        payload.temperature = 0.3;
        payload.max_tokens = 1800;
      }
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        lastErr = `${model}:${r.status}:${(await r.text()).slice(0, 160)}`;
        continue;
      }
      const jj = await r.json();
      raw = jj.choices?.[0]?.message?.content ?? null;
      usage = jj.usage ?? {};
      modelUsado = model;
      if (raw) break;
    } catch (e) {
      lastErr = `${model}:${String(e).slice(0, 160)}`;
      continue;
    }
  }
  if (!raw) return jsonResp({
    error: 'openai_failed',
    detail: lastErr
  }, 500);
  let est = {};
  try {
    est = JSON.parse(raw);
  } catch  {
    const mm = raw.match(/\{[\s\S]*\}/);
    if (mm) {
      try {
        est = JSON.parse(mm[0]);
      } catch  {}
    }
  }
  const n = normalizarEstrutura(est, idsValidos, quemAguardaHeur, audiosPendentes);
  const estagio = n.etapa.valor;
  const saude = mapTemperaturaSaude(n.temperatura);
  const mensagem_sugerida = n.mensagemSugerida ? [
    n.mensagemSugerida
  ] : [];
  const resposta = construirRespostaMarkdown(n);
  const forecast = calcularForecast({
    mensagens: msgs,
    estagio,
    saude: saude || ''
  });
  const pv = await resolverPromptVersion(supa);
  if (supa && chat_id) {
    try {
      await supa.from('coach_forecasts').upsert({
        vendedor_nome,
        chat_id,
        nome_contato: nome_contato || null,
        probabilidade: forecast.prob,
        estagio,
        saude: saude || null,
        features: forecast.features,
        motivo: forecast.motivo,
        data_ref: new Date().toISOString().slice(0, 10),
        prompt_version_id: pv?.id ?? null
      }, {
        onConflict: 'chat_id,data_ref'
      });
    } catch (_) {}
    try {
      const ph = String(chat_id).split('@')[0].replace(/\D/g, '');
      await gravarMemoria(supa, chat_id, ph, vendedor_nome, nome_contato || '', n, produto_detectado, segmento_detectado, memoriaCliente);
    } catch (_) {}
  }
  let action_id = null;
  if (supa && n.proximaAcao?.tipo) {
    try {
      const { data } = await supa.from('coach_actions').insert({
        vendedor_nome,
        chat_id: chat_id || null,
        nome_contato: nome_contato || null,
        action_type: n.proximaAcao.tipo,
        payload: n.proximaAcao,
        motivo_ia: n.proximaAcao.motivo || null,
        pergunta_origem: String(pergunta).slice(0, 500),
        prompt_version_id: pv?.id ?? null
      }).select('id').maybeSingle();
      action_id = data?.id ?? null;
    } catch (_) {}
  }
  return jsonResp({
    ok: true,
    resumo: n.resumo,
    etapa: n.etapa,
    temperatura: n.temperatura,
    fatos: n.fatos,
    interpretacoes: n.interpretacoes,
    informacoesFaltantes: n.informacoesFaltantes,
    objecoes: n.objecoes,
    sinaisCompra: n.sinaisCompra,
    riscos: n.riscos,
    quemAguarda: n.quemAguarda,
    proximaAcao: n.proximaAcao,
    action_id,
    memoria_carregada: !!memoriaCliente,
    kb_carregada: !!kb,
    perfilSugerido: n.perfilSugerido,
    resposta,
    mensagem_sugerida,
    estagio,
    saude,
    forecast: {
      probabilidade: forecast.prob,
      motivo: forecast.motivo
    },
    sub_agent: subAgent,
    prompt_version: pv?.version ?? 22,
    model: modelUsado,
    produto_detectado,
    segmento_detectado,
    vision_used: useVision,
    usage
  });
});
