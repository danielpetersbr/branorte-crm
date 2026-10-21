-- Documentos (PDF de orçamento etc.) das conversas do FUNIL dos vendedores, pro espelho do /whatsapp.
-- Bucket PRIVADO: só o admin abre, por link assinado (o espelho dos vendedores é só do Daniel).
-- Escrita só pela edge wa-sync-messages v20 (service role). Mesmo teto de 6 MB da foto/áudio dos vendedores.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wa-documentos', 'wa-documentos', false, 6000000, array[
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv','application/zip'])
on conflict (id) do nothing;

create policy wa_documentos_admin_le on storage.objects
  for select to authenticated
  using (bucket_id = 'wa-documentos' and (select public.is_admin()));

-- nome do arquivo no espelho (documento aparece com o nome, não "Documento")
create or replace view public.wa_chat_messages_espelho_todas with (security_invoker = true) as
  select msg_id, vendedor_nome, chat_id, from_me, tipo, body, duracao_seg, media_url, data_msg, transcricao, transcricao_em, 'funil'::text as origem, filename
    from public.wa_chat_messages
  union all
  select msg_id, vendedor_nome, chat_id, from_me, tipo, body, duracao_seg, null::text, data_msg, null::text, null::timestamptz, 'espelho'::text, filename
    from public.wa_chat_messages_espelho;
revoke all on public.wa_chat_messages_espelho_todas from anon, authenticated;
grant select on public.wa_chat_messages_espelho_todas to authenticated;
