-- Executar em transação; nenhum teste envia mensagem nem altera a carteira real.
-- Regra testada: private.crm_chat_owner_from_ana_label (o vendedor que recebeu o lead da Ana vê a conversa).
begin;
do $$
declare
  a public.vendors; b public.vendors; ina public.vendors;
  ct_dono public.contacts; ct_livre public.contacts;
  c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); c3 uuid:=gen_random_uuid();
  c4 uuid:=gen_random_uuid(); c6 uuid:=gen_random_uuid(); c7 uuid:=gen_random_uuid();
  v uuid;
begin
  select * into a from public.vendors x where x.ativo
    and (select count(*) from public.vendors y where y.ativo and upper(y.name)=upper(x.name))=1 order by x.name limit 1;
  select * into b from public.vendors x where x.ativo and x.id<>a.id
    and (select count(*) from public.vendors y where y.ativo and upper(y.name)=upper(x.name))=1 order by x.name limit 1;
  select * into ina from public.vendors x where not x.ativo
    and not exists(select 1 from public.vendors y where y.ativo and upper(y.name)=upper(x.name)) order by x.name limit 1;
  select * into ct_dono from public.contacts c where c.vendor_id is not null and c.vendor_id not in (a.id,b.id)
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id) limit 1;
  select * into ct_livre from public.contacts c where c.vendor_id is null
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id)
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id is null
                   and public.fone_canon(k.phone)=public.fone_canon(c.phone)) limit 1;
  if a.id is null or b.id is null or ct_dono.id is null or ct_livre.id is null then raise exception 'Dados de teste indisponíveis'; end if;

  -- 1) A Ana passou (uma etiqueta de vendedor ativo) e a conversa não tem contato: o vendedor recebe.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,ana_tags) values(c1,'crm-test-'||c1||'@c.us','test','TESTE ROLLBACK',array[a.name]);
  select vendor_id into v from public.crm_chat_conversations where id=c1;
  if v is distinct from a.id then raise exception 'FAIL 1: etiqueta de vendedor não virou responsável'; end if;

  -- 2) Etiqueta que não é de vendedor: continua sem responsável.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,ana_tags) values(c2,'crm-test-'||c2||'@c.us','test','TESTE ROLLBACK',array['PROSPECÇÃO','ORÇAMENTO']);
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is not null then raise exception 'FAIL 2: etiqueta comum virou responsável'; end if;

  -- 3) Duas etiquetas de vendedor: ambíguo, não escolhe.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,ana_tags) values(c3,'crm-test-'||c3||'@c.us','test','TESTE ROLLBACK',array[a.name,b.name]);
  select vendor_id into v from public.crm_chat_conversations where id=c3;
  if v is not null then raise exception 'FAIL 3: escolheu um vendedor com duas etiquetas'; end if;

  -- 4) A etiqueta chega depois da conversa, em minúsculas.
  update public.crm_chat_conversations set ana_tags=array[lower(a.name),'PROSPECÇÃO'] where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from a.id then raise exception 'FAIL 4: etiqueta posterior não preencheu o responsável'; end if;

  -- 5) A Ana troca o vendedor: a conversa acompanha (contato sem dono).
  update public.crm_chat_conversations set ana_tags=array[b.name] where id=c1;
  select vendor_id into v from public.crm_chat_conversations where id=c1;
  if v is distinct from b.id then raise exception 'FAIL 5: não acompanhou a troca de etiqueta'; end if;

  -- 6) Etiqueta removida: o vendedor não perde o acesso.
  update public.crm_chat_conversations set ana_tags='{}' where id=c1;
  select vendor_id into v from public.crm_chat_conversations where id=c1;
  if v is distinct from b.id then raise exception 'FAIL 6: perdeu o responsável ao remover a etiqueta'; end if;

  -- 7) Transferência manual vence a etiqueta e sobrevive a updates comuns (mensagem nova).
  update public.crm_chat_conversations set vendor_id=b.id where id=c2;
  update public.crm_chat_conversations set last_message_at=now(),updated_at=now() where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from b.id then raise exception 'FAIL 7: etiqueta passou por cima da transferência'; end if;

  -- 8) Responsável e etiqueta mudam no mesmo UPDATE: vale o responsável informado.
  update public.crm_chat_conversations set vendor_id=a.id,ana_tags=array[b.name] where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from a.id then raise exception 'FAIL 8: etiqueta venceu o responsável informado no mesmo UPDATE'; end if;

  -- 9) Contato COM dono no CRM manda: a etiqueta não troca nem preenche.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,contact_id,vendor_id) values(c4,'crm-test-'||c4||'@c.us','test','TESTE ROLLBACK',ct_dono.id,ct_dono.vendor_id);
  update public.crm_chat_conversations set ana_tags=array[a.name] where id=c4;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from ct_dono.vendor_id then raise exception 'FAIL 9a: etiqueta tirou a conversa do dono do contato'; end if;
  update public.crm_chat_conversations set vendor_id=null where id=c4;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is not null then raise exception 'FAIL 9b: etiqueta preencheu conversa de contato que tem dono'; end if;

  -- 10) Etiqueta com nome de vendedor inativo não atribui.
  if ina.id is not null then
    insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,ana_tags) values(c6,'crm-test-'||c6||'@c.us','test','TESTE ROLLBACK',array[ina.name]);
    select vendor_id into v from public.crm_chat_conversations where id=c6;
    if v is not null then raise exception 'FAIL 10: vendedor inativo virou responsável'; end if;
  end if;

  -- 11) Contato SEM dono: atualizar o cadastro (crm_chat_contact_owner regrava vendor_id vazio) não derruba o responsável.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,contact_id,ana_tags) values(c7,'crm-test-'||c7||'@c.us','test','TESTE ROLLBACK',ct_livre.id,array[a.name]);
  select vendor_id into v from public.crm_chat_conversations where id=c7;
  if v is distinct from a.id then raise exception 'FAIL 11a: contato sem dono não recebeu o vendedor da etiqueta'; end if;
  update public.contacts set name=name where id=ct_livre.id;
  select vendor_id into v from public.crm_chat_conversations where id=c7;
  if v is distinct from a.id then raise exception 'FAIL 11b: atualização do contato derrubou o responsável'; end if;
end $$;
rollback;
select 'PASS: responsável pela etiqueta da Ana (preenche, acompanha, não sobrepõe transferência nem dono do contato); tudo rollback' as resultado;
