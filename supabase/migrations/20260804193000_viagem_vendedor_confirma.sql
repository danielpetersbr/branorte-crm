-- O VENDEDOR PRECISA CONFIRMAR A VIAGEM QUE ELE NÃO CRIOU
--
-- O quadro "Organização de viagem" existe pra isto: alguém monta o roteiro,
-- e o VENDEDOR de cada cliente volta com (a) pode visitar nessa data? e (b) a
-- localização real da propriedade.
--
-- Só que a RLS de `viagens` era: SELECT pra quem criou (ou quem tem
-- `viagens.ver_todas`), UPDATE só pra quem criou ou admin. Ou seja: o vendedor
-- não enxergava a viagem montada pelo escritório, e não teria como confirmar
-- nada. O fluxo inteiro morria na porta do banco.
--
-- O QUE ESTE ARQUIVO ABRE, E O QUE NÃO ABRE:
--   ABRE  → vendedor VÊ a viagem que tem parada dele, e mexe NA PARADA DELE
--   NÃO ABRE → renomear/apagar viagem, mexer em parada de outro vendedor,
--              trocar a rota, ou qualquer coisa em `viagens` além de ler.
--
-- A escrita NÃO passa por policy de tabela: passa por duas funções SECURITY
-- DEFINER que só tocam as colunas de confirmação e localização. Policy de
-- UPDATE não sabe restringir COLUNA — abrir a tabela deixaria o vendedor
-- reescrever dia, ordem e coordenada de qualquer parada da viagem.
--
-- POR QUE CASAR POR PRIMEIRO NOME. `viagem_paradas.vendedor` é TEXTO vindo do
-- cadastro do cliente, e está sujo: "RAMON FERNANDES" convive com "RAMON",
-- "PEDRO DELA GIUSTINA " tem espaço no fim e convive com "PEDRO", e há
-- "IGOR ZANELATO" contra `vendors.name = 'IGOR'`. MEDIDO nos dados reais: o
-- primeiro nome em maiúsculo resolve 14 de 14 grafias distintas, sem colisão
-- entre pessoas diferentes. Se um dia entrar um segundo vendedor com o mesmo
-- primeiro nome, ISTO AQUI QUEBRA — e a correção é passar a gravar vendor_id na
-- parada, não remendar o nome.

-- ── quem sou eu, como vendedor ──────────────────────────────────────────────
create or replace function public.meu_primeiro_nome_vendedor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select upper(split_part(trim(v.name), ' ', 1))
  from public.user_profiles up
  join public.vendors v on v.id = up.vendor_id
  where up.id = auth.uid()
    and up.role = 'vendor'
    and up.approved_at is not null
  limit 1
$$;

revoke execute on function public.meu_primeiro_nome_vendedor() from anon;
grant execute on function public.meu_primeiro_nome_vendedor() to authenticated;

-- ── a viagem tem parada minha? ──────────────────────────────────────────────
create or replace function public.viagem_tem_parada_minha(p_viagem uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.viagem_paradas vp
    where vp.viagem_id = p_viagem
      and vp.vendedor is not null
      and public.meu_primeiro_nome_vendedor() is not null
      and upper(split_part(trim(vp.vendedor), ' ', 1)) = public.meu_primeiro_nome_vendedor()
  )
$$;

revoke execute on function public.viagem_tem_parada_minha(uuid) from anon;
grant execute on function public.viagem_tem_parada_minha(uuid) to authenticated;

-- ── LEITURA: o vendedor passa a ver a viagem que tem parada dele ────────────
-- Continua sendo só LEITURA. E a policy RESTRITIVA `bloqueia_papel_restrito`
-- segue ANDada por cima, então `mapa`/`consultor` permanecem fora.
drop policy if exists viagens_sel on public.viagens;
create policy viagens_sel on public.viagens
  for select to authenticated
  using (
    criado_por = auth.uid()
    or viagens_ve_todas()
    or public.viagem_tem_parada_minha(id)
  );

drop policy if exists viagem_paradas_sel on public.viagem_paradas;
create policy viagem_paradas_sel on public.viagem_paradas
  for select to authenticated
  using (
    exists (
      select 1 from public.viagens v
      where v.id = viagem_paradas.viagem_id
        and (v.criado_por = auth.uid()
             or viagens_ve_todas()
             or public.viagem_tem_parada_minha(v.id))
    )
  );

-- ── ESCRITA: só pelas funções, e só nas colunas do fluxo ────────────────────

/** Quem pode mexer NESTA parada: quem criou a viagem, admin, ou o vendedor dela. */
create or replace function public.posso_mexer_na_parada(p_parada uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.viagem_paradas vp
    join public.viagens v on v.id = vp.viagem_id
    where vp.id = p_parada
      and not public.papel_restrito()          -- defesa em profundidade
      and (
        v.criado_por = auth.uid()
        or public.is_admin()
        or (vp.vendedor is not null
            and public.meu_primeiro_nome_vendedor() is not null
            and upper(split_part(trim(vp.vendedor), ' ', 1)) = public.meu_primeiro_nome_vendedor())
      )
  )
$$;

revoke execute on function public.posso_mexer_na_parada(uuid) from anon;
grant execute on function public.posso_mexer_na_parada(uuid) to authenticated;

/** "Pode visitar nessa data?" — o vendedor responde por aqui. */
create or replace function public.viagem_confirmar_parada(
  p_parada uuid,
  p_confirmacao text,
  p_notas text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.posso_mexer_na_parada(p_parada) then
    raise exception 'Essa parada não é sua nem da sua viagem.' using errcode = '42501';
  end if;
  if p_confirmacao not in ('nao_solicitado','aguardando_vendedor','aguardando_cliente',
                           'localizacao_recebida','visita_confirmada','indisponivel') then
    raise exception 'Estado de confirmação inválido: %', p_confirmacao using errcode = '22023';
  end if;
  update public.viagem_paradas
     set confirmacao = p_confirmacao,
         notas = coalesce(p_notas, notas)
   where id = p_parada;
end $$;

revoke execute on function public.viagem_confirmar_parada(uuid, text, text) from anon;
grant execute on function public.viagem_confirmar_parada(uuid, text, text) to authenticated;

/**
 * "A propriedade fica aqui" — grava a localização real.
 *
 * Os dois destinos juntos de propósito: `cliente_localizacao` é do CLIENTE
 * (vale pra toda viagem futura), mas a parada já salva guarda a coordenada
 * antiga em colunas próprias. Gravar só o primeiro deixava o quadro mostrando
 * "aproximada" depois de o vendedor ter corrigido — parecia não ter salvado.
 */
create or replace function public.viagem_localizacao_parada(
  p_parada uuid,
  p_lat double precision,
  p_lng double precision,
  p_endereco text default null,
  p_fonte text default 'link_do_cliente'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  k text;
begin
  if not public.posso_mexer_na_parada(p_parada) then
    raise exception 'Essa parada não é sua nem da sua viagem.' using errcode = '42501';
  end if;
  -- Fora do Brasil é lixo colado, não propriedade. Marcar cliente no Atlântico é
  -- pior que não marcar: some da conta e ninguém vê o erro.
  if p_lat is null or p_lng is null
     or p_lat < -34.5 or p_lat > 6 or p_lng < -74.5 or p_lng > -32.5 then
    raise exception 'Coordenada fora do Brasil: %, %', p_lat, p_lng using errcode = '22023';
  end if;

  select cli_key, cli_keys into r from public.viagem_paradas where id = p_parada;

  foreach k in array coalesce(r.cli_keys, case when r.cli_key is null then '{}'::text[] else array[r.cli_key] end)
  loop
    insert into public.cliente_localizacao
      (cli_key, lat, lng, precisao, fonte, endereco, confirmado_por, confirmado_em, updated_at)
    values (k, p_lat, p_lng, 'confirmada', p_fonte, p_endereco, auth.uid(), now(), now())
    on conflict (cli_key) do update
      set lat = excluded.lat, lng = excluded.lng, precisao = excluded.precisao,
          fonte = excluded.fonte, endereco = excluded.endereco,
          confirmado_por = excluded.confirmado_por, confirmado_em = excluded.confirmado_em,
          updated_at = excluded.updated_at;
  end loop;

  update public.viagem_paradas
     set lat = p_lat, lng = p_lng, precisao = 'confirmada',
         endereco = coalesce(p_endereco, endereco),
         confirmacao = case when confirmacao = 'visita_confirmada'
                            then confirmacao          -- já confirmou: não regride
                            else 'localizacao_recebida' end
   where id = p_parada;
end $$;

revoke execute on function public.viagem_localizacao_parada(uuid, double precision, double precision, text, text) from anon;
grant execute on function public.viagem_localizacao_parada(uuid, double precision, double precision, text, text) to authenticated;
