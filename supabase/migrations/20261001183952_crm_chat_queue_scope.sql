-- A fila manual não fica acessível pelos endpoints legados do navegador.
create policy crm_manual_queue_select on public.wa_scheduled_messages as restrictive for select to authenticated using (
  crm_request_id is null or exists(select 1 from public.crm_chat_outbox o where o.id=crm_request_id and private.crm_chat_can(o.conversation_id))
);
create policy crm_manual_queue_insert on public.wa_scheduled_messages as restrictive for insert to authenticated with check(crm_request_id is null);
create policy crm_manual_queue_update on public.wa_scheduled_messages as restrictive for update to authenticated using(crm_request_id is null) with check(crm_request_id is null);
create policy crm_manual_queue_delete on public.wa_scheduled_messages as restrictive for delete to authenticated using(crm_request_id is null);
