-- Executar em transação; nenhum teste envia mensagem nem altera a carteira real.
-- Regra testada: a conversa segue o repasse da Ana (private.crm_chat_owner_from_ana_label) e o dono do
-- contato só vai pra conversa quando ele muda ou quando ela não tem responsável (private.crm_chat_contact_owner).
begin;
do $$
declare
  a public.vendors; b public.vendors;
  ct_dono public.contacts; ct_dono2 public.contacts; ct_livre public.contacts; ct_livre2 public.contacts;
  adm uuid;
  c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); c3 uuid:=gen_random_uuid(); c4 uuid:=gen_random_uuid();
  c7 uuid:=gen_random_uuid(); c8 uuid:=gen_random_uuid(); c9 uuid:=gen_random_uuid(); c10 uuid:=gen_random_uuid();
  v uuid; k uuid; dono_antes uuid;
begin
  select * into a from public.vendors x where x.ativo
    and (select count(*) from public.vendors y where y.ativo and upper(y.name)=upper(x.name))=1 order by x.name limit 1;
  select * into b from public.vendors x where x.ativo and x.id<>a.id
    and (select count(*) from public.vendors y where y.ativo and upper(y.name)=upper(x.name))=1 order by x.name limit 1;
  select id into adm from public.user_profiles where role='admin' and approved_at is not null limit 1;
  select * into ct_dono from public.contacts c where c.vendor_id is not null and c.vendor_id not in (a.id,b.id)
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id) limit 1;
  select * into ct_dono2 from public.contacts c where c.vendor_id is not null and c.vendor_id not in (a.id,b.id) and c.id<>ct_dono.id
    and public.fone_canon(c.phone) is not null
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id or public.fone_canon(k.phone)=public.fone_canon(c.phone)) limit 1;
  select * into ct_livre from public.contacts c where c.vendor_id is null
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id)
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id is null and public.fone_canon(k.phone)=public.fone_canon(c.phone)) limit 1;
  select * into ct_livre2 from public.contacts c where c.vendor_id is null and c.id<>ct_livre.id and public.fone_canon(c.phone) is not null
    and not exists(select 1 from public.crm_chat_conversations k where k.contact_id=c.id or public.fone_canon(k.phone)=public.fone_canon(c.phone)) limit 1;
  if a.id is null or b.id is null or adm is null or ct_dono.id is null or ct_dono2.id is null or ct_livre.id is null or ct_livre2.id is null then raise exception 'Dados de teste indisponíveis'; end if;

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

  -- 5) A Ana troca o vendedor: a conversa acompanha.
  update public.crm_chat_conversations set ana_tags=array[b.name] where id=c1;
  select vendor_id into v from public.crm_chat_conversations where id=c1;
  if v is distinct from b.id then raise exception 'FAIL 5: não acompanhou a troca de etiqueta'; end if;

  -- 6) Etiqueta removida: o vendedor não perde o acesso.
  update public.crm_chat_conversations set ana_tags='{}' where id=c1;
  select vendor_id into v from public.crm_chat_conversations where id=c1;
  if v is distinct from b.id then raise exception 'FAIL 6: perdeu o responsável ao remover a etiqueta'; end if;

  -- 7) Transferência manual vence a etiqueta, sobrevive a updates comuns e à troca de OUTRAS etiquetas.
  update public.crm_chat_conversations set vendor_id=b.id where id=c2;
  update public.crm_chat_conversations set last_message_at=now(),updated_at=now() where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from b.id then raise exception 'FAIL 7: etiqueta passou por cima da transferência'; end if;
  update public.crm_chat_conversations set ana_tags=array[lower(a.name),'ORÇAMENTO','FECHADO'] where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from b.id then raise exception 'FAIL 7b: outra etiqueta desfez a transferência'; end if;

  -- 8) Responsável e etiqueta mudam no mesmo UPDATE: vale o responsável informado.
  update public.crm_chat_conversations set vendor_id=a.id,ana_tags=array[b.name] where id=c2;
  select vendor_id into v from public.crm_chat_conversations where id=c2;
  if v is distinct from a.id then raise exception 'FAIL 8: etiqueta venceu o responsável informado no mesmo UPDATE'; end if;

  -- 9) Contato COM dono antigo: etiqueta comum não mexe; o repasse da Ana leva a conversa pro vendedor
  --    que recebeu, sem tocar no dono do contato; atualizar o cadastro não devolve pro dono antigo.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,contact_id,vendor_id) values(c4,'crm-test-'||c4||'@c.us','test','TESTE ROLLBACK',ct_dono.id,ct_dono.vendor_id);
  update public.crm_chat_conversations set ana_tags=array['PROSPECÇÃO'] where id=c4;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from ct_dono.vendor_id then raise exception 'FAIL 9a: etiqueta comum tirou a conversa do dono'; end if;
  update public.crm_chat_conversations set ana_tags=array['PROSPECÇÃO',a.name] where id=c4;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from a.id then raise exception 'FAIL 9b: repasse não levou a conversa'; end if;
  update public.contacts set name=name where id=ct_dono.id;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from a.id then raise exception 'FAIL 9c: atualizar o cadastro devolveu pro dono antigo'; end if;
  select vendor_id into dono_antes from public.contacts where id=ct_dono.id;
  if dono_antes is distinct from ct_dono.vendor_id then raise exception 'FAIL 9d: a regra mexeu no dono do contato'; end if;
  -- Transferência pelo admin na tela: vale (e muda o dono do contato, como sempre foi).
  perform set_config('request.jwt.claim.sub',adm::text,true);
  perform public.crm_chat('assign',jsonb_build_object('id',c4,'vendor',b.id));
  perform set_config('request.jwt.claim.sub','',true);
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from b.id then raise exception 'FAIL 9e: transferência do admin não valeu'; end if;
  update public.crm_chat_conversations set last_message_at=now(),updated_at=now(),ana_tags=array['ORÇAMENTO',a.name] where id=c4;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from b.id then raise exception 'FAIL 9f: etiqueta antiga desfez a transferência do admin'; end if;
  -- Transferência em Contatos (o dono do contato muda): a conversa acompanha.
  update public.contacts set vendor_id=ct_dono.vendor_id where id=ct_dono.id;
  select vendor_id into v from public.crm_chat_conversations where id=c4;
  if v is distinct from ct_dono.vendor_id then raise exception 'FAIL 9g: troca de dono do contato não chegou na conversa'; end if;

  -- 11) Contato SEM dono: atualizar o cadastro não derruba o responsável.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,contact_id,ana_tags) values(c7,'crm-test-'||c7||'@c.us','test','TESTE ROLLBACK',ct_livre.id,array[a.name]);
  update public.contacts set name=name where id=ct_livre.id;
  select vendor_id into v from public.crm_chat_conversations where id=c7;
  if v is distinct from a.id then raise exception 'FAIL 11: atualização do contato derrubou o responsável'; end if;

  -- 12) Conversa ainda sem contato (casa por telefone): ligar o contato não derruba o repasse.
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name,ana_tags) values(c8,'crm-test-'||c8||'@c.us',ct_dono2.phone,'TESTE ROLLBACK',array[a.name]);
  update public.contacts set name=name where id=ct_dono2.id;
  select vendor_id, contact_id into v, k from public.crm_chat_conversations where id=c8;
  if k is distinct from ct_dono2.id then raise exception 'FAIL 12a: não ligou o contato'; end if;
  if v is distinct from a.id then raise exception 'FAIL 12b: ligar o contato devolveu pro dono antigo'; end if;

  -- 13) Conversa sem responsável e sem etiqueta: ao ligar o contato, vale o dono dele (carteira de sempre).
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name) values(c9,'crm-test-'||c9||'@c.us',ct_livre2.phone,'TESTE ROLLBACK');
  update public.contacts set name=name where id=ct_livre2.id;
  select vendor_id, contact_id into v, k from public.crm_chat_conversations where id=c9;
  if k is distinct from ct_livre2.id or v is not null then raise exception 'FAIL 13a: contato sem dono deu responsável à conversa'; end if;
  delete from public.crm_chat_conversations where id=c8;
  insert into public.crm_chat_conversations(id,wa_chat_id,phone,name) values(c10,'crm-test-'||c10||'@c.us',ct_dono2.phone,'TESTE ROLLBACK');
  update public.contacts set name=name where id=ct_dono2.id;
  select vendor_id into v from public.crm_chat_conversations where id=c10;
  if v is distinct from ct_dono2.vendor_id then raise exception 'FAIL 13b: conversa sem responsável não recebeu o dono do contato'; end if;
end $$;
rollback;
select 'PASS: a conversa segue o repasse da Ana; transferência manual e troca de dono do contato valem; tudo rollback' as resultado;
