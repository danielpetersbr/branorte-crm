-- Preserva identidade de vendas importadas e nomes anteriores do cadastro.
-- IDs espelhados com orçamento, nome e telefone diferentes não substituem
-- uma venda histórica. Cancelamentos continuam excluídos.
set local enable_nestloop=off;
set local jit=off;
drop materialized view public.mv_mapa_conversoes;
create materialized view public.mv_mapa_conversoes as
with propostas as materialized (
  select o.numero,private.mapa_numero(o.numero) as nz,o.data_emissao,o.total_proposta as total,private.mapa_nome(o.cliente_nome) as nome,
    private.mapa_fones(coalesce(nullif(o.cliente_dados->>'fone',''),c.fone)) as fones,
    regexp_replace(coalesce(nullif(o.cliente_dados->>'cnpj',''),nullif(o.cliente_dados->>'cpf',''),c.cnpj,''),'\D','','g') as doc
  from public.orcamentos_gerados o left join public.orcamento_clientes c on c.id=o.cliente_id
  union all
  select l.numero,private.mapa_numero(l.numero),l.data_emissao,l.total_proposta,private.mapa_nome(l.cliente_nome),
    private.mapa_fones(l.fone),regexp_replace(coalesce(l.cpf,''),'\D','','g')
  from public.orcamentos_legado l
), vendas_raw as materialized (
  select 'P:'||p.id as id,p.numero_orcamento as numero,p.cliente as nome,p.cidade,p.estado as uf,
    p.raw->>'telefone' as telefone,p.raw->>'cpf_cnpj' as doc,
    coalesce(nullif((p.payment_plan_json->>'total')::numeric,0),p.valor_total) as valor
  from public.mirror_pedidos_venda p
  where upper(coalesce(p.status,''))<>'CANCELADO'
    and lower(btrim(coalesce(p.raw->>'fonte_origem','')))<>'garantia'
  union all
  select 'V:'||v.id,v.numero_orcamento,v.nome_cliente,v.cidade,v.estado,v.telefone,null,v.valor
  from public.vendas_mapa v
  -- Pedido espelhado é a fonte vigente, inclusive para excluir cancelamentos.
  where not exists(select 1 from public.mirror_pedidos_venda p where p.id::text=v.pedido_id::text
    and (upper(coalesce(p.status,''))='CANCELADO'
      or private.mapa_numero(v.numero_orcamento) is null or private.mapa_numero(p.numero_orcamento) is null
      or private.mapa_numero(v.numero_orcamento)=private.mapa_numero(p.numero_orcamento)
      or private.mapa_nome(v.nome_cliente)=private.mapa_nome(p.cliente)
      or private.mapa_fones(v.telefone)&&private.mapa_fones(p.raw->>'telefone')))
    and not (v.pedido_id is null and private.mapa_numero(v.numero_orcamento) is not null
      and exists(select 1 from public.mirror_pedidos_venda p where private.mapa_numero(p.numero_orcamento)=private.mapa_numero(v.numero_orcamento)))
), vendas as materialized (
  select v.id,private.mapa_numero(v.numero) as nz,private.mapa_nome(v.nome) as nome,
    private.mapa_nome(v.cidade) as cidade,upper(btrim(coalesce(v.uf,''))) as uf,
    private.mapa_fones(v.telefone) as fones,regexp_replace(coalesce(v.doc,''),'\D','','g') as doc,v.valor,regexp_replace(coalesce(v.telefone,''),'\D','','g') as fone_local
  from vendas_raw v
), lids as materialized (
  select distinct split_part(chat_id,'@',1) as lid from public.wa_chat_labels where chat_id like '%@lid'
), lid_fones as materialized (
  select split_part(l.chat_id,'@',1) as lid,private.mapa_nome(l.vendedor_nome) as vendedor,array_agg(distinct f.fc) as fones
  from public.wa_chat_labels l,unnest(private.mapa_fones(l.phone)) f(fc)
  where l.chat_id like '%@lid' and regexp_replace(coalesce(l.phone,''),'\D','','g')<>split_part(l.chat_id,'@',1)
  group by split_part(l.chat_id,'@',1),private.mapa_nome(l.vendedor_nome) having count(distinct f.fc)=1
), entidades_raw as materialized (
  select 'cliente'::text as tipo,p.cli_key as chave,p.cliente as nome,p.cidade,p.uf,
    string_to_array(p.numeros,',') as numeros,
    private.mapa_fones(p.telefone)||private.mapa_fones(p.fone) as fones,p.total
  from public.mv_mapa_orcamentos p
  union all
  select 'orcamento',coalesce(l.numero,'')||'|'||private.mapa_nome(l.cliente)||'|'||private.mapa_nome(l.cidade)||'|'||upper(btrim(coalesce(l.uf,''))),l.cliente,l.cidade,l.uf,array[l.numero],'{}'::text[],l.total
  from public.mv_lista_orcamentos_mapa l
  union all
  select 'visita',v.id::text,v.nome,v.cidade,v.estado,'{}'::text[],
    case when lids.lid is not null then coalesce(lf.fones,'{}'::text[]) else private.mapa_fones(v.telefone) end,v.valor_negociando
  from public.cliente_dados_visita v
  left join lids on lids.lid=regexp_replace(coalesce(v.telefone,''),'\D','','g')
  left join lid_fones lf on lf.lid=lids.lid and lf.vendedor=private.mapa_nome(v.vendedor_nome)
), entidades as materialized (
  select distinct on(e.tipo,e.chave) e.tipo,e.chave,private.mapa_nome(e.nome) as nome,private.mapa_nome(e.cidade) as cidade,
    upper(btrim(coalesce(e.uf,''))) as uf,e.fones,
    array(select distinct private.mapa_numero(n) from unnest(e.numeros) n where private.mapa_numero(n) is not null) as numeros,e.total
  from entidades_raw e
), ep as materialized (
  select e.tipo,e.chave,p.* from entidades e,unnest(e.numeros) n join propostas p on p.nz=n
), ef as (
  select tipo,chave,array_agg(distinct fc) as fones from ep,unnest(ep.fones) fc group by tipo,chave
), ea as (
  select tipo,chave,array_agg(distinct nome) filter(where nome<>'') as nomes from ep group by tipo,chave
), ed as (
  select tipo,chave,array_agg(distinct doc) as docs from ep where length(doc) in (11,14) and doc !~ '^0+$' group by tipo,chave
), el as (
  select distinct on(tipo,chave) tipo,chave,total from ep order by tipo,chave,data_emissao desc nulls last,numero desc
), cadastro_base as materialized (
  select e.tipo,e.chave,e.nome,e.cidade,e.uf,e.numeros,
    array[e.nome]||coalesce(ea.nomes,'{}'::text[]) as nomes,
    e.fones||coalesce(ef.fones,'{}'::text[]) as fones,coalesce(ed.docs,'{}'::text[]) as docs,
    case when e.tipo='cliente' then coalesce(el.total,e.total) else e.total end as total
  from entidades e
  left join ef using(tipo,chave) left join ea using(tipo,chave) left join ed using(tipo,chave) left join el using(tipo,chave)
), pino_numero as materialized (
  select n,min(p.chave) as chave from cadastro_base p,unnest(p.numeros) n
  where p.tipo='cliente' group by n having count(distinct p.chave)=1
), heranca as materialized (
  select e.chave,min(p.chave) as pino from cadastro_base e cross join lateral unnest(e.numeros) u(nz)
  join pino_numero pn on pn.n=u.nz join cadastro_base p on p.tipo='cliente' and p.chave=pn.chave
  where e.tipo='orcamento' and cardinality(p.docs)<=1
    and (cardinality(e.docs)=0 or cardinality(p.docs)=0 or e.docs&&p.docs)
  group by e.chave having count(distinct p.chave)=1
), cadastro as materialized (
  select e.tipo,e.chave,e.nome,e.cidade,e.uf,e.numeros||coalesce(p.numeros,'{}'::text[]) as numeros,
    e.nomes||coalesce(p.nomes,'{}'::text[]) as nomes,
    e.fones||coalesce(p.fones,'{}'::text[]) as fones,e.docs||coalesce(p.docs,'{}'::text[]) as docs,e.total
  from cadastro_base e left join heranca h on e.tipo='orcamento' and h.chave=e.chave
  left join cadastro_base p on p.tipo='cliente' and p.chave=h.pino
), pf as (
  select nz,array_agg(distinct fc) as fones from propostas p,unnest(p.fones) fc group by nz
), pd as (
  select nz,array_agg(distinct doc) as docs from propostas where length(doc) in (11,14) and doc !~ '^0+$' group by nz
), venda_cadastro as materialized (
  select v.*,v.fones||coalesce(pf.fones,'{}'::text[]) as todos_fones,
    (case when length(v.doc) in (11,14) and v.doc !~ '^0+$' then array[v.doc] else '{}'::text[] end)||coalesce(pd.docs,'{}'::text[]) as docs
  from vendas v
  left join pf on pf.nz=v.nz left join pd on pd.nz=v.nz
), nomes_ambiguos as materialized (
  select n||'|'||cidade||'|'||uf as token from cadastro e,unnest(e.nomes) u(n)
  where tipo='cliente' group by n,cidade,uf having count(distinct chave)>1
), et as materialized (
  select e.tipo,e.chave,'numero' as via,n as token from cadastro e,unnest(e.numeros) n
  union select e.tipo,e.chave,'fone',f from cadastro e,unnest(e.fones) f
  union select e.tipo,e.chave,'doc',d from cadastro e,unnest(e.docs) d
  union select e.tipo,e.chave,'nome',n||'|'||e.cidade||'|'||e.uf from cadastro e,unnest(e.nomes) u(n)
    where position(' ' in n)>0 and e.cidade<>'' and e.uf<>''
  union select e.tipo,e.chave,'local',e.nome||'|'||e.cidade||'|'||e.uf||'|'||regexp_replace(r.fones_raw,'\D','','g')
    from cadastro e join (select 'cliente'::text tipo,p.cli_key chave,coalesce(p.telefone,p.fone) fones_raw from public.mv_mapa_orcamentos p) r using(tipo,chave)
    where e.cidade<>'' and e.uf<>'' and length(regexp_replace(r.fones_raw,'\D','','g'))=8
), vt as materialized (
  select v.id,'numero' as via,v.nz as token from venda_cadastro v where v.nz is not null
  union select v.id,'fone',f from venda_cadastro v,unnest(v.todos_fones) f
  union select v.id,'doc',d from venda_cadastro v,unnest(v.docs) d
  union select v.id,'nome',v.nome||'|'||v.cidade||'|'||v.uf from venda_cadastro v
    where position(' ' in v.nome)>0 and v.cidade<>'' and v.uf<>''
  union select v.id,'local',v.nome||'|'||v.cidade||'|'||v.uf||'|'||v.fone_local from venda_cadastro v
    where v.cidade<>'' and v.uf<>'' and length(v.fone_local)=8
), casamentos as materialized (
  select distinct e.tipo,e.chave,v.id
  from et join vt on vt.via=et.via and vt.token=et.token
  join cadastro e on e.tipo=et.tipo and e.chave=et.chave
  join venda_cadastro v on v.id=vt.id
  where (et.via='numero' or cardinality(e.docs)=0 or cardinality(v.docs)=0 or e.docs&&v.docs)
    and (et.via<>'nome' or (
    not exists(select 1 from nomes_ambiguos a where a.token=et.token)
    and cardinality(e.docs)<=1
    and (cardinality(e.fones)=0 or cardinality(v.todos_fones)=0 or e.fones&&v.todos_fones
      -- Importações antigas de empresas têm o telefone fixo anterior ao cadastro.
      or (v.id like 'V:%' and v.nz is null and cardinality(v.docs)=0
        and v.nome ~ '(LTDA|S/?A[.]?|EIRELI|EPP|ME)$'))
  ))
)
select e.tipo,e.chave,e.uf,count(v.id)>0 as vendido,count(v.id)::integer as n_vendas,
  case when e.tipo='cliente' and count(v.id)>0 then coalesce(nullif(sum(v.valor),0),e.total) else e.total end as total
from cadastro e left join casamentos c on c.tipo=e.tipo and c.chave=e.chave
left join vendas v on v.id=c.id group by e.tipo,e.chave,e.uf,e.total;
create unique index mv_mapa_conversoes_key on public.mv_mapa_conversoes(tipo,chave);
revoke all on public.mv_mapa_conversoes from public, anon, authenticated;
