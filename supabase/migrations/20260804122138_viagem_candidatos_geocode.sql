-- Clientes do mapa que têm endereço utilizável e AINDA não têm coordenada real.
-- Existe pro scripts/geocode-clientes.mjs não precisar de SQL cru com service_role.
--
-- Liga orcamentos_files ao cliente por DUAS chaves (número do orçamento e telefone)
-- e joga fora o lixo do parser de DOCX:
--   • CEP que aparece em 3+ clientes não é endereço, é o mesmo campo errado repetido
--     (o 03648162 apareceu em cliente de MT, PE e RS, sempre com "ução até: 10,0 ton./hora")
--   • endereço tem que começar com logradouro plausível e ter tamanho de endereço
--
-- O `numero` de orcamentos_files é só a sequência ('011') e o ano é coluna separada;
-- o mapa normaliza como ano+4 dígitos ('20120011'). Sem esse lpad o join dá ZERO.
create or replace function public.viagem_candidatos_geocode()
returns table (
  cli_key text, cep text, ender text,
  cliente text, cidade text, uf text,
  cid_lat double precision, cid_lng double precision
)
language sql stable security definer set search_path to 'public' as $$
  with mapa as (
    select cli_key, cliente, cidade, uf, lat, lng, numeros, telefone, fone
    from public.mapa_orcamentos_v2()
  ),
  mn as (
    select m.cli_key, regexp_replace(trim(n), '\D', '', 'g') nz
    from mapa m, unnest(string_to_array(coalesce(m.numeros, ''), ',')) n
    where regexp_replace(trim(n), '\D', '', 'g') <> ''
  ),
  mp as (
    select cli_key, nullif(regexp_replace(coalesce(telefone, fone, ''), '\D', '', 'g'), '') fd
    from mapa
  ),
  f as (
    select id, mtime_iso,
      ano::text || lpad(regexp_replace(coalesce(numero, ''), '\D', '', 'g'), 4, '0') chave,
      nullif(regexp_replace(coalesce(docx_phone_normalizado, docx_phone, ''), '\D', '', 'g'), '') fone_d,
      regexp_replace(coalesce(docx_cep, ''), '\D', '', 'g') cep,
      trim(coalesce(docx_endereco, '')) ender
    from public.orcamentos_files
  ),
  lig as (
    select mn.cli_key, f.* from f join mn on mn.nz = f.chave
    union
    select mp.cli_key, f.* from f join mp on mp.fd = f.fone_d and length(mp.fd) >= 10
  ),
  cep_suspeito as (
    select cep from lig where cep ~ '^\d{8}$' group by cep having count(distinct cli_key) >= 3
  ),
  util as (
    select l.*,
      (l.ender ~* '^(rua|r\.|av|avenida|rod|rodovia|estrada|linha|br[- ]|sitio|sítio|fazenda|chacara|chácara|gleba|lote|quadra|qd|condom)'
        and length(l.ender) between 8 and 120) end_ok,
      (l.cep ~ '^\d{8}$' and right(l.cep, 3) <> '000' and l.cep not in (select cep from cep_suspeito)) cep_ok
    from lig l
  ),
  melhor as (
    select distinct on (cli_key) cli_key, cep, ender, end_ok
    from util where end_ok
    order by cli_key, cep_ok desc, mtime_iso desc nulls last
  )
  select m.cli_key, m.cep, m.ender, x.cliente, x.cidade, x.uf, x.lat, x.lng
  from melhor m
  join mapa x on x.cli_key = m.cli_key
  left join public.cliente_localizacao cl on cl.cli_key = m.cli_key
  where cl.cli_key is null            -- nunca sobrescreve confirmação de vendedor
    and coalesce(x.cidade, '') <> ''
  order by x.cliente;
$$;

revoke all on function public.viagem_candidatos_geocode() from anon;
