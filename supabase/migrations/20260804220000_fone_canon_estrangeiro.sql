-- TELEFONE ESTRANGEIRO FABRICAVA UM CANÔNICO QUE COLIDE COM BRASILEIRO
--
-- `fone_canon` reduz o telefone a DDD(2)+8 dígitos: é a chave que casa o
-- orçamento com o lead do WhatsApp. A última linha da conta é
-- `if length(n) > 10 then n := right(n,10)`, que trunca QUALQUER número longo
-- pelos últimos 10 dígitos — sem nunca perguntar de que país ele é.
--
-- Resultado: o DDI vira DDD.
--   +1 555 123 4567    (EUA)          -> 5551234567 = (55) 5123-4567 Santa Maria/RS
--   +54 9 11 1234 5678 (Buenos Aires) -> 1112345678 = DDD 11, São Paulo
--   +351 912 345 678   (Portugal)     -> 1912345678 = DDD 19, Campinas
--   +49 151 12345678   (Alemanha)     -> 5112345678 = DDD 51, Porto Alegre
-- Medido: 10 dos 16 DDIs conhecidos viram DDD brasileiro válido.
--
-- Isso não era alcançável até agora porque o campo de telefone do orçamento
-- aplicava máscara brasileira em cima de tudo — não dava pra registrar cliente
-- de fora. O seletor de DDI abriu a porta, então a trava entra JUNTO com ele.
-- Na base já há 6.191 telefones internacionais em `contacts`.
--
-- O SINAL é o "+" com DDI diferente de 55, que é como o CRM passou a gravar
-- internacional. Sem prefixo explícito não há como distinguir: "(917) 555-1234"
-- dos EUA e um celular brasileiro são os mesmos 10 dígitos — nesse caso o
-- benefício da dúvida fica com o Brasil, senão o CRM inteiro quebra.
--
-- CUSTO ZERO NO HISTÓRICO, medido antes de aplicar: dos 982 orçamentos com
-- telefone, 981 têm canônico e 16 começam com "+" — TODOS +55. Nenhum canônico
-- existente muda.
--
-- A função está espelhada em src/lib/fone-canon.ts (com teste). Se mexer aqui,
-- mexa lá — e vice-versa.

create or replace function public.fone_canon(p text)
returns text language plpgsql immutable as $function$
declare d text; n text;
begin
  d := regexp_replace(coalesce(p,''), '\D', '', 'g');
  if d is null or length(d) < 10 then return null; end if;

  -- Estrangeiro não tem lead brasileiro pra casar: sem canônico.
  if left(btrim(coalesce(p,'')),1) = '+' and left(d,2) <> '55' then
    return null;
  end if;

  if length(d) >= 12 and left(d,2) = '55' then n := substr(d,3); else n := d; end if;
  if length(n) = 11 and substr(n,3,1) = '9' then n := substr(n,1,2) || substr(n,4); end if;
  if length(n) > 10 then n := right(n,10); end if;
  if length(n) = 10 then return n; else return null; end if;
end; $function$;

-- VERIFICADO em produção depois de aplicar:
--   fone_canon('+1 555 123 4567')   -> null   (era 5551234567)
--   fone_canon('+595 981 123456')   -> null
--   fone_canon('(55) 5123-4567')    -> 5551234567   intacto
--   fone_canon('+55 48 99999-9999') -> 4899999999   intacto
--   fone_canon('5548999999999')     -> 4899999999   intacto
--
-- ────────────────────────────────────────────────────────────────────────────
-- FICA EM ABERTO, e é decisão de negócio, não de código:
--
-- A regra do 9º dígito (`substr(n,3,1) = '9'` → tira o 9) funde um FIXO com um
-- CELULAR quando o fixo começa com 9. Achei UM caso real hoje em
-- `orcamentos_gerados`:
--   canônico 6392117663 junta (63) 9211-7663 e (63) 99211-7663
--   -> "RAIMUNDO NONATO CABRAL" e "EDER VAGNER OLIVEIRA", R$ 106.877,18
-- A RPC faz array_agg ordenado por created_at desc, então o CRM pendura o
-- orçamento de um no lead do outro.
--
-- Não mexi: a regra existe porque o Brasil ADICIONOU o 9º dígito aos celulares,
-- e tirá-la faria o mesmo cliente parar de casar entre o cadastro velho e o
-- novo — quebra que atinge a base inteira pra consertar um caso. Os outros 4
-- canônicos com nomes diferentes que a varredura achou são a mesma pessoa ou
-- empresa escrita de dois jeitos (acento, apelido, sigla), não fusão indevida.
