-- Exercita o corpo REAL da RPC com fontes temporárias; nenhum cliente real é alterado.
begin;
create temporary table teste_funil_atend (
  telefone_norm text, telefone text, responsavel text, is_internal boolean default false
);
create temporary table teste_funil_labels (
  phone text, vendedor_nome text, label_ids text[]
);
create temporary table teste_funil_etiquetas (
  vendedor_nome text, etiqueta_id_wascript integer, etiqueta_nome_normalizado text
);
insert into teste_funil_etiquetas values
 ('ANA', 1, 'PROSPECCAO'), ('ANA', 2, '2O  TENTATIVA'),
 ('ANA', 3, 'NOVO LEAD'), ('ANA', 4, 'FALLOWUP'), ('ANA', 5, 'QUENTE'),
 ('ANA', 6, '3° TENTATIVA'), ('ANA', 7, 'NAO RESPONDEU MAIS'),
 ('ANA', 8, 'SO BASE DE PRECO'), ('ANA', 9, 'OUTROS ASSUNTOS'),
 ('ANA', 10, 'VENDIDO'), ('ANA', 11, 'NAO TEM INTERESSE'),
 ('ANA', 12, 'ORCAMENTO ENVIADO'), ('ANA', 13, 'INTERESSE FUTURO'),
 ('PEDRO', 1, 'PROSPECCAO');
insert into teste_funil_atend
 select '554899000' || lpad(i::text, 4, '0'), '+554899000' || lpad(i::text, 4, '0'),
        case when i = 16 then 'Pedro' else 'Ana' end, i = 17
 from generate_series(1, 17) i;
insert into teste_funil_labels
 select telefone, 'ANA', array[i::text]
 from teste_funil_atend a
 join generate_series(1, 13) i on a.telefone_norm = '554899000' || lpad(i::text, 4, '0');
-- 14 fica sem etiqueta; 15 tem etapa ativa e encerramento pendurado.
insert into teste_funil_labels values
 ('+5548990000015', 'ANA', array['1','7']),
 ('+5548990000016', 'ANA', array['11']),
 ('+5548990000016', 'PEDRO', array['1']),
 ('+5548990000017', 'ANA', array['1']);
-- Mesmo cliente, outra conta, outra grafia com/sem nono dígito: nunca duplica.
insert into teste_funil_labels values ('+554890000001', 'ANA', array['3']);

do $test$
declare definition text; r record;
begin
  definition := pg_get_functiondef('public.atendimentos_contagem_funil(text)'::regprocedure);
  definition := replace(definition, 'public.atendimentos_contagem_funil(', 'pg_temp.teste_contagem_funil(');
  definition := replace(definition, 'auditoria.atendimentos_por_cliente', 'pg_temp.teste_funil_atend');
  definition := replace(definition, 'public.wa_chat_labels', 'pg_temp.teste_funil_labels');
  definition := replace(definition, 'public.wascript_etiquetas', 'pg_temp.teste_funil_etiquetas');
  execute definition;
  select * into r from pg_temp.teste_contagem_funil(null);
  if r.total <> 16 or r.abertos <> 7 or r.sem_etiqueta <> 1 or r.com_etiqueta_aberta <> 7 or r.fechados <> 8 then
    raise exception 'Contagem incorreta: %', row_to_json(r);
  end if;
  select * into r from pg_temp.teste_contagem_funil('Ana');
  if r.total <> 15 or r.abertos <> 6 then
    raise exception 'Escopo do vendedor incorreto: %', row_to_json(r);
  end if;
end;
$test$;
rollback;
select 'ok: etapas, aliases, sem etiqueta, encerramentos, conflito, duplicação, dono e escopo' as resultado;
