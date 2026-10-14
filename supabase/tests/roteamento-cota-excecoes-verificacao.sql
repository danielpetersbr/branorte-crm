-- Verificação pós-migration: leitura + parâmetros de sessão com rollback.
-- NÃO chama a RPC de alteração com usuário autorizado e não modifica vendedores.
begin;
set local statement_timeout = '10s';

select set_config('request.jwt.claim.sub', (
  select id::text from public.user_profiles where role in ('admin','owner')
  order by id limit 1
), true);
set local role authenticated;

select vendedor_nome, ignorar_parados, expira_em, temporario
from public.roteamento_cota_excecoes()
order by vendedor_nome;

reset role;

do $$
begin
  if has_function_privilege('anon', 'public.roteamento_cota_excecoes()', 'EXECUTE')
     or has_function_privilege('anon', 'public.roteamento_cota_definir(text,boolean)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.roteamento_cota_excecoes()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.roteamento_cota_definir(text,boolean)', 'EXECUTE') then
    raise exception 'As novas RPCs não podem estar liberadas para anon/service_role';
  end if;
  if has_table_privilege('authenticated', 'private.outbound_cota_excecoes', 'SELECT')
     or has_table_privilege('authenticated', 'private.outbound_cota_excecoes', 'INSERT')
     or has_table_privilege('authenticated', 'private.outbound_cota_excecoes', 'UPDATE')
     or has_table_privilege('authenticated', 'private.outbound_cota_excecoes', 'DELETE') then
    raise exception 'A tabela de exceções não deve ter acesso direto para authenticated';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
set local role authenticated;
do $$
begin
  begin
    perform public.roteamento_cota_excecoes();
    raise exception 'Falha: leitura sem auth.uid foi aceita';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.roteamento_cota_definir('INEXISTENTE_TESTE', true);
    raise exception 'Falha: alteração sem auth.uid foi aceita';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select jsonb_build_object(
  'validacao', 'admin lê; anônimo, serviço e chamada sem usuário não podem alterar; tabela privada fechada',
  'excecoes', (select jsonb_agg(jsonb_build_object(
    'vendedor_nome', e.vendedor_nome,
    'inicio_em', e.inicio_em,
    'expira_em', case when isfinite(e.expira_em) then e.expira_em else null end,
    'sem_prazo', not isfinite(e.expira_em)
  )) from private.outbound_cota_excecoes e)
) as verificacao;

rollback;
