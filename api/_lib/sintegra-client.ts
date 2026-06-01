// Cliente de consulta de Inscrição Estadual / Sintegra (cadastro de contribuinte).
//
// Dois provedores, ambos via fetch (sem dependência nova):
//   - CNPJá       (CNPJ -> IE/situação)   GET  https://api.cnpja.com/office/{cnpj}?registrations=BR
//   - Infosimples (CNPJ/CPF/IE -> dados)  POST https://api.infosimples.com/api/v2/consultas/sintegra/unificada
//
// Os tokens vêm do handler (env CNPJA_TOKEN / INFOSIMPLES_TOKEN) — nunca no frontend.
//
// IMPORTANTE: os nomes de campo da resposta foram mapeados a partir da documentação
// oficial (verificada na pesquisa de jun/2026), mas NÃO foram testados contra a API
// ao vivo (sem token). O parsing é defensivo (optional chaining + múltiplas chaves);
// se algum campo vier vazio em produção, ajuste o mapeamento aqui.

export interface SintegraResult {
  fonte: 'cnpja' | 'infosimples' | 'mock'
  razao_social: string | null
  ie: string | null
  ie_uf: string | null
  situacao: string | null // Ativa / Baixada / Suspensa / etc.
  situacao_data: string | null
  endereco: string | null // logradouro + número (quando vier)
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
}

function so(v: unknown): string | null {
  const s = (v == null ? '' : String(v)).trim()
  return s || null
}

// ---------- CNPJá ----------
// Aceita CNPJ. registrations=BR traz as IEs de todas as UFs no array `registrations`.
export async function consultarCnpja(
  cnpj: string,
  opts: { token: string; uf?: string | null },
): Promise<SintegraResult | null> {
  const d = cnpj.replace(/\D/g, '')
  if (d.length !== 14) return null

  const res = await fetch(`https://api.cnpja.com/office/${d}?registrations=BR`, {
    headers: { Authorization: opts.token },
  })
  if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!data) return null

  const regs: any[] = Array.isArray(data.registrations) ? data.registrations : []
  // Prefere a UF informada; senão a primeira habilitada; senão a primeira.
  const reg =
    (opts.uf && regs.find((r) => so(r.state)?.toUpperCase() === opts.uf!.toUpperCase())) ||
    regs.find((r) => r.enabled) ||
    regs[0] ||
    null

  if (!reg && !data.company) return null
  const addr = (data.address || {}) as Record<string, any>

  return {
    fonte: 'cnpja',
    razao_social: so(data.company?.name) || so(data.alias) || so(data.name),
    ie: so(reg?.number),
    ie_uf: so(reg?.state),
    situacao:
      so(reg?.status?.text) ||
      (reg?.enabled === false ? 'Inativa' : reg?.enabled === true ? 'Ativa' : null),
    situacao_data: so(reg?.statusDate),
    endereco: so([so(addr.street), so(addr.number)].filter(Boolean).join(', ')),
    bairro: so(addr.district),
    municipio: so(addr.city),
    uf: so(addr.state) || so(reg?.state),
    cep: so(addr.zip),
  }
}

// ---------- Infosimples ----------
// Aceita CNPJ, CPF (produtor rural) ou IE como entrada. Exige UF. code 200 = sucesso (e só aí cobra).
export async function consultarInfosimples(opts: {
  token: string
  uf: string
  cnpj?: string
  cpf?: string
  ie?: string
}): Promise<SintegraResult | null> {
  const body: Record<string, unknown> = { token: opts.token, uf: opts.uf, timeout: 600 }
  if (opts.cnpj) body.cnpj = opts.cnpj.replace(/\D/g, '')
  if (opts.cpf) body.cpf = opts.cpf.replace(/\D/g, '')
  if (opts.ie) body.inscricao_estadual = opts.ie.replace(/\D/g, '')

  const res = await fetch('https://api.infosimples.com/api/v2/consultas/sintegra/unificada', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return null
  const json = (await res.json().catch(() => null)) as Record<string, any> | null
  if (!json || json.code !== 200) return null

  const d = (Array.isArray(json.data) ? json.data[0] : json.data) as Record<string, any> | undefined
  if (!d) return null

  const ender =
    so(d.endereco) || so([so(d.endereco_logradouro), so(d.endereco_numero)].filter(Boolean).join(', '))

  return {
    fonte: 'infosimples',
    razao_social: so(d.razao_social) || so(d.nome) || so(d.nome_empresarial),
    ie: so(d.inscricao_estadual) || so(d.ie),
    ie_uf: so(d.uf) || so(opts.uf),
    situacao: so(d.situacao_cadastral) || so(d.situacao),
    situacao_data: so(d.situacao_data) || so(d.data_situacao_cadastral),
    endereco: ender,
    bairro: so(d.endereco_bairro) || so(d.bairro),
    municipio: so(d.endereco_municipio) || so(d.municipio) || so(d.cidade),
    uf: so(d.endereco_uf) || so(d.uf) || so(opts.uf),
    cep: so(d.endereco_cep) || so(d.cep),
  }
}

export function mockSintegra(input: { cnpj?: string; cpf?: string; ie?: string; uf?: string }): SintegraResult {
  return {
    fonte: 'mock',
    razao_social: 'EMPRESA TESTE LTDA (MOCK)',
    ie: input.ie || '123456789',
    ie_uf: input.uf || 'RO',
    situacao: 'Ativa',
    situacao_data: '2020-01-01',
    endereco: 'Rua Exemplo, 100',
    bairro: 'Centro',
    municipio: 'Porto Velho',
    uf: input.uf || 'RO',
    cep: '76800-000',
  }
}
