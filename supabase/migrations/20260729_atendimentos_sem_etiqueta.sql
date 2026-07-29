-- Filtro "Sem etiqueta" na tela /atendimentos.
--
-- Contexto: a etiqueta do WhatsApp NAO e uma coluna da view
-- auditoria.atendimentos_por_cliente. Ela mora em public.wa_chat_labels
-- (label_ids por telefone+vendedor). Logo "sem etiqueta" = AUSENCIA de linha
-- em wa_chat_labels (ou label_ids vazio), nao um NULL em coluna nenhuma.
--
-- Por que a RPC recebe a janela de data: o front usa o padrao
-- "RPC devolve telefones -> .in('telefone_norm', lista)". Como a lista e
-- truncada por p_limit, truncar SEM considerar a data devolveria telefones
-- antigos que a query principal (que filtra created_at) descartaria depois,
-- e a tela apareceria vazia mesmo tendo resultado. Aplicando a mesma janela
-- aqui, o recorte e o mesmo dos dois lados.
--
-- Teto: 700 por chamada, igual a atendimentos_telefones_por_etiqueta (valor ja
-- comprovado em producao para o tamanho de URL do .in()). Ordena por ultima_msg
-- desc, entao o que sobra sao os mais recentes -- que e o que interessa para
-- triagem e para chamar o cliente. O front avisa quando bate no teto.
-- Dimensao em 2026-07-29: 3.502 sem etiqueta na base inteira, 528 em 30d,
-- 362 em 7d. Com qualquer preset de data real nao trunca.

create or replace function public.atendimentos_telefones_sem_etiqueta(
  p_desde timestamptz default null,
  p_ate   timestamptz default null,
  p_limit int         default 700
)
returns text[]
language sql
stable
security definer
set search_path to 'auditoria', 'public'
as $$
  select coalesce(array_agg(tn), '{}')
  from (
    select apc.telefone_norm as tn, max(apc.ultima_msg) as ord
    from auditoria.atendimentos_por_cliente apc
    where apc.is_internal = false
      and apc.telefone_norm is not null
      and apc.telefone_norm <> ''
      and (p_desde is null or apc.created_at >= p_desde)
      and (p_ate   is null or apc.created_at <= p_ate)
      and not exists (
        select 1
        from public.wa_chat_labels wcl
        where auditoria.wa_phone_strip9(wcl.phone) = auditoria.wa_phone_strip9(apc.telefone)
          and coalesce(array_length(wcl.label_ids::int[], 1), 0) > 0
      )
    group by apc.telefone_norm
    order by ord desc nulls last
    limit greatest(1, least(coalesce(p_limit, 700), 2000))
  ) x;
$$;

comment on function public.atendimentos_telefones_sem_etiqueta(timestamptz, timestamptz, int) is
  'Telefones (telefone_norm) de atendimentos SEM nenhuma etiqueta do WhatsApp, dentro da janela de created_at. Ordenado por ultima_msg desc, truncado em p_limit (default 700).';

-- Mesmo padrao de grant das RPCs irmas: authenticated apenas, nunca anon.
revoke all on function public.atendimentos_telefones_sem_etiqueta(timestamptz, timestamptz, int) from public;
revoke all on function public.atendimentos_telefones_sem_etiqueta(timestamptz, timestamptz, int) from anon;
grant execute on function public.atendimentos_telefones_sem_etiqueta(timestamptz, timestamptz, int) to authenticated;
grant execute on function public.atendimentos_telefones_sem_etiqueta(timestamptz, timestamptz, int) to service_role;
