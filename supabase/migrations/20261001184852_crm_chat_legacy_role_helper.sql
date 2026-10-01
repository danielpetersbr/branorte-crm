
-- Restringe vendedores sem remover a leitura administrativa e dos demais papéis legados.
create or replace function private.crm_chat_is_vendor() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles where id=auth.uid() and role='vendor');
$$;
revoke all on function private.crm_chat_is_vendor() from public,anon;
grant execute on function private.crm_chat_is_vendor() to authenticated;
