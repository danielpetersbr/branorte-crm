-- Apresentacao navegavel dentro de /reunioes. O manifesto contem os caminhos
-- privados dos slides, videos e arquivo original; o Storage guarda os bytes.
alter table public.reunioes
  add column apresentacao_manifesto jsonb;

alter table public.reunioes
  add constraint reunioes_apresentacao_manifesto_objeto
  check (apresentacao_manifesto is null or jsonb_typeof(apresentacao_manifesto) = 'object');

comment on column public.reunioes.apresentacao_manifesto is
  'Manifesto da apresentacao: slides, videos e arquivos privados no bucket reunioes-apresentacoes.';

-- O limite e por objeto. Um PDF ou PPTX grande precisa ser reduzido antes do upload.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reunioes-apresentacoes',
  'reunioes-apresentacoes',
  false,
  20 * 1024 * 1024,
  array[
    'image/png',
    'video/mp4',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]::text[]
);

-- O unico nivel de pasta e o UUID de uma reuniao existente. A leitura do
-- arquivo segue a RLS atual de reunioes (autenticado, exceto papel restrito).
create policy reunioes_apresentacoes_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'reunioes-apresentacoes'
    and not public.papel_restrito()
    and cardinality(storage.foldername(name)) = 1
    and exists (
      select 1 from public.reunioes r
      where r.id::text = (storage.foldername(name))[1]
    )
  );

create policy reunioes_apresentacoes_insert
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'reunioes-apresentacoes'
    and not public.papel_restrito()
    and public.is_admin()
    and cardinality(storage.foldername(name)) = 1
    and exists (
      select 1 from public.reunioes r
      where r.id::text = (storage.foldername(name))[1]
    )
  );

-- Somente admin/owner envia arquivos. Cada upload usa um nome novo (sem
-- upsert), para preservar arquivos ja apresentados. Nao ha politica de UPDATE
-- nem de DELETE neste bucket.
