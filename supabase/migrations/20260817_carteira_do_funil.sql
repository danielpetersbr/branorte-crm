-- Carteira do vendedor = clientes DISTINTOS ainda em jogo no funil dele.
--
-- Por que existe (17/08/2026, pedido do Daniel): a coluna "Carteira" do Resumo
-- por vendedor vinha de wa_sync_debug.total_chats — a contagem BRUTA de conversas
-- do WhatsApp do vendedor (heartbeat da extensão). Somava 8.141 no time enquanto
-- a tela /funil mostrava 1.095. Não era carteira, era caixa de entrada.
--
-- Regras desta função:
--  1. Fonte = wa_chat_labels + wascript_etiquetas, a MESMA da tela /funil
--     (useWaKanban). Assim o número do Dashboard e o do funil falam do mesmo mundo.
--  2. Conta CLIENTE DISTINTO, não etiqueta. Somar per_label inflava: cliente com
--     FOLLOW UP + ORÇAMENTO ENVIADO contava 2x (EDILSON +45, GUSTAVO +40).
--  3. VIVO = só as 5 etapas: PROSPECÇÃO, 2ª TENTATIVA, NOVO LEAD, FOLLOW UP e
--     LEAD QUENTE. ORÇAMENTO ENVIADO fora; INTERESSE FUTURO fora (era 31% da
--     coluna — 540 de 1.710 entravam SÓ por ela, gente que ninguém trabalha).
--     Mesma régua do Score, mas número diferente: o Score soma per_label do
--     heartbeat (duplica e não tira fechado). IGOR: 202 no Score, 159 aqui.
--  4. TERMINAL exclui: quem tem VENDIDO ou motivo de fechamento SAI, mesmo que a
--     etiqueta viva antiga tenha ficado pendurada. Sem isso a carteira premiava
--     quem não limpa etiqueta — eram 188 clientes, distribuídos de forma desigual
--     (EDILSON 57, GUSTAVO 45, IGOR 44 vs PEDRO 1, EDER 3).
--  5. Grupos (@g.us) fora.
--  6. 'COMCORRENTE' entra no regex junto com 'CONCORRENTE': o typo existe no
--     catálogo real e o front já colapsa os dois via ALIASES (src/lib/wa-funil.ts).
--     Sem isso, 2 clientes marcados como perdidos ficavam contando na carteira.
create or replace function public.escritorio_carteira_funil()
returns table(vendedor_nome text, carteira integer, atualizado_em timestamp with time zone)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with ch as (
    select l.vendedor_nome, l.chat_id, l.updated_at,
           unnest(coalesce(l.label_ids, '{}'))::text as id
    from public.wa_chat_labels l
    where l.chat_id is not null and l.chat_id not like '%@g.us'
  ),
  cat as (
    select e.vendedor_nome, e.etiqueta_id_wascript::text as id, e.etiqueta_nome as nome
    from public.wascript_etiquetas e
  ),
  por_chat as (
    select ch.vendedor_nome, ch.chat_id, max(ch.updated_at) as updated_at,
      bool_or(cat.nome ~* 'prospec|tentativa|novo[s]? lead|lead novo|f[ao]llow|quente') as vivo,
      bool_or(cat.nome ~* 'vendido|nunca respondeu|respondeu mais|tem interesse|fora do or.amento|fabricamos|co[nm]corren|base de pre')  as terminal
    from ch
    join cat on cat.vendedor_nome = ch.vendedor_nome and cat.id = ch.id
    group by 1, 2
  )
  select p.vendedor_nome, count(*)::int as carteira, max(p.updated_at) as atualizado_em
  from por_chat p
  where p.vivo and not p.terminal
  group by 1;
$function$;

revoke all on function public.escritorio_carteira_funil() from public, anon;
grant execute on function public.escritorio_carteira_funil() to authenticated, service_role;
