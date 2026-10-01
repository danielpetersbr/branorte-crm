create policy crm_ana_labels_scope on public.wa_chat_labels as restrictive for select to authenticated using(vendedor_nome<>'ANA' or private.crm_chat_can_wa(chat_id));
