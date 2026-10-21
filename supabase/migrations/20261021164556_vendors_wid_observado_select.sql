-- Seletor de conta do /whatsapp mostra o final do número que a extensão viu conectado.
-- Mesmo tipo de dado de vendors.telefone, que authenticated já lê; wascript_token segue fechado.
grant select (wid_observado) on public.vendors to authenticated;
