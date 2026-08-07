-- A view somava num numero so o que o sistema SABE e o que ele CHUTA.
--
-- `conversas` contava todo matched_at, sem olhar match_via. O card do painel
-- mostrava esse numero em verde, como fato. Medido em 05-07/08/2026: dos 10
-- casamentos, 3 eram reais (selo invisivel) e 7 eram conversas de OUTRA origem
-- adotadas pela janela de 60 min -- Instagram, Facebook, quiz, e um fornecedor
-- prospectando a Branorte. O painel dizia 10.
--
-- A tabela de detalhe ja distinguia "conversou" de "provavel". Quem le o numero
-- grande nunca chegava na tabela de detalhe.
--
-- `conversas` fica (compatibilidade), mas agora acompanhada das duas partes.
-- 'texto' entra em conversas_certas junto com 'codigo': e o grau que o conserto
-- do casamento vai carimbar, e ele nasce confiavel por construcao.
--
-- ⚠️ security_invoker=true PRESERVADO. Sem ele a view passa a rodar com os
-- direitos do dono e fura o RLS de link_rota / link_rota_click.

create or replace view public.link_rota_resumo
with (security_invoker = true) as
 select l.id,
    l.slug,
    l.nome,
    l.origem,
    l.ativo,
    count(c.id) as cliques,
    count(c.id) filter (where c.matched_at is not null) as conversas,
    count(c.id) filter (where c.created_at > (now() - '7 days'::interval)) as cliques_7d,
    max(c.created_at) as ultimo_clique,
    count(c.id) filter (where c.match_via in ('codigo','texto'))  as conversas_certas,
    count(c.id) filter (where c.match_via = 'janela')             as conversas_provaveis
   from link_rota l
     left join link_rota_click c on c.link_id = l.id
  group by l.id;

comment on view public.link_rota_resumo is
  'Resumo por link. conversas_certas = casamento provado (selo ou texto). conversas_provaveis = janela de tempo, que ja adotou lead de outra origem — nao tratar como fato.';
