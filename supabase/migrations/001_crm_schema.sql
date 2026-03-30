-- ============================================================
-- Branorte CRM -- Contact Management Schema
-- ============================================================

create extension if not exists "pg_trgm";

-- VENDORS
create table vendors (
  id          uuid primary key,
  name        text not null unique,
  email       text unique,
  role        text not null default 'vendor' check (role in ('vendor','admin')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- CONTACTS
create table contacts (
  id          bigint generated always as identity primary key,
  nome        text not null default '',
  telefone    text not null,
  estado      text default '',
  fonte       text default '',
  vendor_id   uuid references vendors(id),
  status      text not null default 'novo' check (status in ('novo','qualificado','negociando','fechado','perdido','descartado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index idx_contacts_vendor on contacts(vendor_id);
create index idx_contacts_estado on contacts(estado);
create index idx_contacts_status on contacts(status);
create index idx_contacts_telefone on contacts(telefone);
create index idx_contacts_nome_trgm on contacts using gin (nome gin_trgm_ops);
create index idx_contacts_created on contacts(created_at desc);

-- NOTES
create table notes (
  id          bigint generated always as identity primary key,
  contact_id  bigint not null references contacts(id) on delete cascade,
  vendor_id   uuid not null references vendors(id),
  content     text not null,
  created_at  timestamptz not null default now()
);

create index idx_notes_contact on notes(contact_id);

-- ACTIVITY LOG
create table activity_log (
  id          bigint generated always as identity primary key,
  contact_id  bigint not null references contacts(id) on delete cascade,
  vendor_id   uuid references vendors(id),
  action      text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create index idx_activity_contact on activity_log(contact_id);

-- VIEWS
create or replace view contact_stats as
select
  count(*) as total_contacts,
  count(*) filter (where vendor_id is null) as unassigned,
  count(*) filter (where vendor_id is not null) as assigned,
  count(distinct estado) filter (where estado != '') as total_states,
  count(distinct vendor_id) as active_vendors
from contacts;

create or replace view contacts_by_state as
select
  estado,
  count(*) as total,
  count(*) filter (where vendor_id is null) as unassigned,
  count(*) filter (where vendor_id is not null) as assigned
from contacts
where estado is not null and estado != ''
group by estado
order by total desc;

create or replace view contacts_by_vendor as
select
  v.name as vendor_name,
  v.id as vendor_id,
  count(c.id) as total_contacts,
  count(c.id) filter (where c.status = 'novo') as novos,
  count(c.id) filter (where c.status = 'qualificado') as qualificados,
  count(c.id) filter (where c.status = 'negociando') as negociando,
  count(c.id) filter (where c.status = 'fechado') as fechados
from vendors v
left join contacts c on c.vendor_id = v.id
group by v.id, v.name
order by total_contacts desc;

-- FUNCTION: Bulk assign
create or replace function bulk_assign_contacts(
  p_contact_ids bigint[],
  p_vendor_id uuid,
  p_assigner_id uuid
) returns int as $$
declare
  affected int;
begin
  update contacts
  set vendor_id = p_vendor_id, updated_at = now()
  where id = any(p_contact_ids);
  get diagnostics affected = row_count;
  insert into activity_log (contact_id, vendor_id, action, details)
  select unnest(p_contact_ids), p_assigner_id, 'assigned',
    jsonb_build_object('to_vendor', p_vendor_id);
  return affected;
end;
$$ language plpgsql security definer;

-- RLS
alter table contacts enable row level security;
alter table notes enable row level security;
alter table activity_log enable row level security;

create policy "all_contacts_read" on contacts for select using (true);
create policy "all_contacts_update" on contacts for update using (true);
create policy "all_contacts_insert" on contacts for insert with check (true);
create policy "all_notes_read" on notes for select using (true);
create policy "all_notes_insert" on notes for insert with check (true);
create policy "all_activity_read" on activity_log for select using (true);
create policy "all_activity_insert" on activity_log for insert with check (true);
