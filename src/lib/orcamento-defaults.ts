// Defaults compartilhados do orçamento Branorte.
// Mantidos num lib puro (sem React) pra serem usados tanto pela preview
// quanto pelo gerador de DOCX custom sem puxar dependências de componente.

// Seção "Observação — por conta do cliente": as 5 linhas históricas.
// Quando um orçamento não tem obs_por_conta salvo (null), cai nestas.
// Vendedor pode editar/adicionar/excluir por orçamento (persiste em
// orcamentos_gerados.obs_por_conta).
export const OBS_POR_CONTA_DEFAULT: string[] = [
  'Painel elétrico',
  'Montagem dos equipamentos orçados acima (se necessário)',
  'Muck (se necessário)',
  'Despesa com obras civil (se necessário)',
  'Instalação elétrica dos equipamentos (se necessário)',
]
