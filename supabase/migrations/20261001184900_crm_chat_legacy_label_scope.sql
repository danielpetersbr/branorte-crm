alter policy crm_ana_labels_scope on public.wa_chat_labels using(
 vendedor_nome<>'ANA' or not(select private.crm_chat_is_vendor()) or chat_id=any((select private.crm_chat_allowed_wa())::text[])
);
