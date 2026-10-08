-- Conta exclusiva de leitura do mapa visual. O perfil é provisionado separado,
-- sem credenciais nem dados pessoais nesta migration.
alter table public.user_profiles drop constraint user_profiles_role_check;
alter table public.user_profiles add constraint user_profiles_role_check check (
  role in ('admin','financeiro','vendor','marketing','visualizador','mapa',
    'mapa_visual','consultor','representante','pending','rejected')
);

-- A negação vale para o papel mesmo se sua aprovação for revogada.
create function private.papel_mapa_visual()
returns boolean language sql stable security definer set search_path=''
as $function$
  select coalesce((select p.role='mapa_visual'
    from public.user_profiles p where p.id=(select auth.uid())),false)
$function$;

-- Só um perfil aprovado recebe as visitas marcadas e seus status de conversão.
create function private.leitor_mapa_visual_aprovado()
returns boolean language sql stable security definer set search_path=''
as $function$
  select coalesce((select p.role='mapa_visual' and p.approved_at is not null
    from public.user_profiles p where p.id=(select auth.uid())),false)
$function$;

revoke all on function private.papel_mapa_visual() from public,anon;
revoke all on function private.leitor_mapa_visual_aprovado() from public,anon;
grant execute on function private.papel_mapa_visual() to authenticated,service_role;
grant execute on function private.leitor_mapa_visual_aprovado() to authenticated,service_role;

-- Definições atuais preservadas: aprovado não retira a restrição do novo papel;
-- conta sem perfil permanece fechada, enquanto o comportamento anon é o anterior.
create or replace function public.papel_restrito()
returns boolean language sql stable security definer set search_path='public'
as $function$
  select case when auth.uid() is null then false else coalesce(
    (select role in ('mapa','mapa_visual','consultor','representante','pending','rejected')
      or approved_at is null from public.user_profiles where id=auth.uid()),true) end
$function$;

create or replace function public.papel_restrito_viagens()
returns boolean language sql stable security definer set search_path='public'
as $function$
  select coalesce((select role in ('consultor','representante','mapa_visual')
    from public.user_profiles where id=auth.uid()),false)
$function$;

-- Manter a leitura normal e do papel mapa. O leitor novo vê somente marcadas,
-- respeitando uma eventual lista de UFs do próprio usuário.
alter policy bloqueia_papel_restrito_leitura on public.cliente_dados_visita
using (
  not public.papel_restrito() or (
    visitar is true and (
      public.papel_mapa() or (
        (select private.leitor_mapa_visual_aprovado()) and (
          (select public.ufs_visiveis()) is null
          or upper(coalesce(estado,''))=any((select public.ufs_visiveis())::text[])
        )
      )
    )
  )
);

-- As outras telas liberadas para o antigo papel mapa não fazem parte deste
-- acesso. Policies RESTRICTIVE mantêm o comportamento dos demais perfis.
do $policies$
declare tabela text;
begin
  foreach tabela in array array['representante_territorios','venda_racao_config',
    'venda_racao_formulas','venda_racao_ingredientes','venda_racao_simulacoes'] loop
    execute format('create policy mapa_visual_sem_acesso on public.%I
      as restrictive for all to authenticated
      using (not (select private.papel_mapa_visual()))
      with check (not (select private.papel_mapa_visual()))',tabela);
  end loop;
end
$policies$;

-- O perfil precisa continuar legível para o login; este usuário não pode
-- alterar seu papel/aprovação ou apagar o perfil.
create policy mapa_visual_perfil_insert on public.user_profiles
as restrictive for insert to authenticated
with check (not (select private.papel_mapa_visual()));
create policy mapa_visual_perfil_update on public.user_profiles
as restrictive for update to authenticated
using (not (select private.papel_mapa_visual()))
with check (not (select private.papel_mapa_visual()));
create policy mapa_visual_perfil_delete on public.user_profiles
as restrictive for delete to authenticated
using (not (select private.papel_mapa_visual()));

-- A nova permissão fica no auxiliar estreito do mapa visual. papel_mapa()
-- permanece intacto e não libera gestão de outros mapas para este leitor.
create or replace function private.mapa_visual_conversoes_visitas(p_ids text[])
returns table(chave text,vendido boolean,n_vendas integer)
language sql stable security definer set search_path=''
as $function$
  with acesso as materialized (
    select auth.uid() as uid,public.papel_restrito() as restrito,
      public.papel_mapa() as mapa,private.leitor_mapa_visual_aprovado() as visual,
      public.ufs_visiveis() as ufs
  )
  select c.chave,c.vendido,c.n_vendas
  from public.mv_mapa_conversoes c cross join acesso a
  where c.tipo='visita' and c.chave=any(p_ids) and a.uid is not null
    and (not a.restrito or ((a.mapa or a.visual) and exists(
      select 1 from public.cliente_dados_visita v where v.id::text=c.chave and v.visitar is true)))
    and (a.ufs is null or c.uf=any(a.ufs))
$function$;

-- Revogar a aprovação também fecha os RPCs SECURITY DEFINER de pontos.
-- O novo gate é calculado uma vez e preserva os perfis legados e service_role.
create or replace function public.mapa_orcamentos_v2()
returns table (
  cliente text, telefone text, fone text, numeros text, cidade text, uf text,
  total numeric, n_orcamentos integer, data_recente date, vendedor text,
  vendido boolean, n_vendas integer, lat double precision, lng double precision,
  cli_key text, precisao text, vendedor_fonte text, equipamento text
)
language sql stable security definer set search_path='public' as $function$
  with vis as materialized (
    select public.ufs_visiveis() as ufs,
      not exists(select 1 from public.user_profiles p
        where p.id=auth.uid() and p.role='mapa_visual' and p.approved_at is null) as visual_liberado
  )
  select f.cliente, f.telefone, f.fone, f.numeros, f.cidade, f.uf,
         coalesce(c.total,f.total) as total, f.n_orcamentos, f.data_recente,
         coalesce(f.vendedor,w.vend_wa) as vendedor,
         coalesce(c.vendido,f.vendido) as vendido,
         coalesce(c.n_vendas,f.n_vendas) as n_vendas,
         coalesce(o.lat,f.lat), coalesce(o.lng,f.lng), f.cli_key,
         case when o.cli_key is not null then o.precisao else f.precisao_base end,
         case when f.vendedor is not null then 'orcamento'
              when w.vend_wa is not null then 'whatsapp' end as vendedor_fonte,
         c.equipamento
  from public.mv_mapa_orcamentos f
  left join public.mv_mapa_conversoes c on c.tipo='cliente' and c.chave=f.cli_key
  cross join vis
  left join public.cliente_localizacao o on o.cli_key=f.cli_key
  left join lateral (
    select l.vendedor_nome as vend_wa
    from public.wa_chat_labels l
    where f.vendedor is null
      and public.fone_canon(l.phone) in (public.fone_canon(f.telefone),public.fone_canon(f.fone))
    order by (upper(btrim(l.vendedor_nome)) <> 'DANIEL') desc,
             (coalesce(array_length(l.label_ids,1),0) > 0) desc,
             l.last_message_at desc nulls last
    limit 1
  ) w on true
  where vis.visual_liberado
    and (vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs))
$function$;

create or replace function private.mapa_visual_contagem_pontos()
returns table(vendidos integer,orcados integer)
language sql stable security definer set search_path=''
as $function$
with vis as materialized (
  select public.ufs_visiveis() ufs,auth.uid() uid,current_setting('role',true) caller_role,
    not exists(select 1 from public.user_profiles p
      where p.id=auth.uid() and p.role='mapa_visual' and p.approved_at is null) visual_liberado
),
convertidos as materialized (
  select c.chave,c.vendido,c.n_vendas
  from public.mv_mapa_conversoes c where c.tipo='cliente'
)
select count(*) filter(where vendido)::integer vendidos,count(*) filter(where not vendido)::integer orcados
from (
  select coalesce(c.vendido,f.vendido,false) or coalesce(c.n_vendas,f.n_vendas,0)>0 vendido
  from public.mv_mapa_orcamentos f
  left join convertidos c on c.chave=f.cli_key
  left join public.cliente_localizacao l on l.cli_key=f.cli_key
  cross join vis
  where (vis.uid is not null or vis.caller_role='service_role')
    and vis.visual_liberado
    and (vis.ufs is null or upper(coalesce(f.uf,''))=any(vis.ufs))
    and coalesce(l.lat,f.lat) between -90 and 90
    and coalesce(l.lng,f.lng) between -180 and 180
) pontos
$function$;

notify pgrst, 'reload schema';
