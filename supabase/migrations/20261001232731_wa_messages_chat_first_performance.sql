-- Chat-wide supervision intentionally examines all vendors. Vendor-first
-- history indexes cannot bound that scan or supply its cross-vendor ordering.
-- Live rollout: this index was prebuilt with CREATE INDEX CONCURRENTLY before
-- recording this transactional migration. IF NOT EXISTS is a no-op there.
-- On a fresh database this creates the index with the rest of the schema.
-- Does not change query semantics, policies, grants, or business schedules.
create index if not exists wa_chat_messages_chat_timeline_idx
  on public.wa_chat_messages (chat_id, data_msg desc, msg_id desc)
  include (from_me, vendedor_nome);

do $$
begin
  if not exists (
    select 1 from pg_index
    where indexrelid = 'public.wa_chat_messages_chat_timeline_idx'::regclass
      and indisvalid and indisready and indislive
  ) then
    raise exception 'wa_chat_messages_chat_timeline_idx must be valid and ready';
  end if;
end $$;
