// Edge Function: parse-cliente-ia
// Recebe texto bagunçado com dados de cliente e usa Google Gemini Flash
// pra extrair em JSON estruturado (ClienteDados shape).
//
// Usa o secret GEMINI_API_KEY já configurado nos Edge Function Secrets.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const SYSTEM_PROMPT = `Você extrai dados de cliente brasileiro de textos bagunçados e retorna SEMPRE em JSON estruturado.

Campos a extrair (deixe null se não tiver):
- cliente_nome: nome da empresa/fazenda/razão social OU nome da pessoa
- ac: A/C (aos cuidados de) — nome do proprietário/responsável/contato
- fone: telefone formatado "(DD) NNNNN-NNNN" (mantém o 9 inicial dos celulares!)
- cidade: nome da cidade (SEM o estado)
- bairro: bairro (ex: "Centro", "Zona Rural", "Jardim Botânico")
- endereco: rua/avenida + número + complemento (linha completa, sem cidade/bairro/CEP)
- cep: CEP formatado "XXXXX-XXX"
- cnpj: CNPJ "XX.XXX.XXX/XXXX-XX" OU CPF "XXX.XXX.XXX-XX" (mesmo campo)
- ie: inscrição estadual (mantém formato original)
- email: email válido

REGRAS:
- Não invente dados. Se não tem, retorne null.
- Formate telefone, CNPJ, CEP, CPF nos padrões brasileiros.
- Telefone com 9 dígitos (celular) mantém o 9: "77 998382244" → "(77) 99838-2244".
- Se texto tem EMPRESA/FAZENDA + nome de pessoa (ex: "FAZENDA SUSSUARANA\\nRógeris Pedrazzi"):
  → cliente_nome = nome da fazenda/empresa
  → ac = nome da pessoa
- Endereço pode ser longo com vírgulas (ex: "Rodovia TO 118, em direção a Aurora, 4km..."): pegue a linha INTEIRA até onde aparecer bairro/cidade/CEP.
- Padrão "Bairro - Cidade/UF" no endereço: extraia bairro e cidade separados.
- Não chute bairro se não houver indicação clara.

Retorne APENAS o JSON, sem markdown, sem comentários.`

interface ParseResult {
  cliente_nome: string | null
  ac: string | null
  fone: string | null
  cidade: string | null
  bairro: string | null
  endereco: string | null
  cep: string | null
  cnpj: string | null
  ie: string | null
  email: string | null
}

// Schema pro responseSchema do Gemini (structured output garantido).
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    cliente_nome: { type: 'string', nullable: true },
    ac:           { type: 'string', nullable: true },
    fone:         { type: 'string', nullable: true },
    cidade:       { type: 'string', nullable: true },
    bairro:       { type: 'string', nullable: true },
    endereco:     { type: 'string', nullable: true },
    cep:          { type: 'string', nullable: true },
    cnpj:         { type: 'string', nullable: true },
    ie:           { type: 'string', nullable: true },
    email:        { type: 'string', nullable: true },
  },
  required: ['cliente_nome','ac','fone','cidade','bairro','endereco','cep','cnpj','ie','email'],
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY não configurada' }), {
      status: 500, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  let texto: string
  try {
    const body = await req.json()
    texto = (body.texto ?? body.text ?? '').toString().trim()
    if (!texto) throw new Error('campo "texto" vazio')
    if (texto.length > 4000) texto = texto.slice(0, 4000)
  } catch (e) {
    return new Response(JSON.stringify({ error: 'JSON inválido: ' + (e as Error).message }), {
      status: 400, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }

  try {
    // Gemini Flash latest — barato + rápido. Structured output via responseSchema.
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`
    const geminiResp = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          { role: 'user', parts: [{ text: `Texto:\n\n${texto}` }] },
        ],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    })

    if (!geminiResp.ok) {
      const errBody = await geminiResp.text()
      return new Response(JSON.stringify({ error: 'Gemini erro ' + geminiResp.status, detail: errBody.slice(0, 500) }), {
        status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }

    const ai = await geminiResp.json()
    const content = ai.candidates?.[0]?.content?.parts?.[0]?.text
    if (!content) {
      return new Response(JSON.stringify({ error: 'resposta vazia do Gemini', raw: ai }), {
        status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }

    let parsed: ParseResult
    try {
      parsed = JSON.parse(content)
    } catch {
      return new Response(JSON.stringify({ error: 'JSON inválido da IA', raw: content.slice(0, 300) }), {
        status: 502, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true, parsed, usage: ai.usageMetadata }), {
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  } catch (e) {
    return new Response(JSON.stringify({ error: 'falha interna: ' + (e as Error).message }), {
      status: 500, headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    })
  }
})
