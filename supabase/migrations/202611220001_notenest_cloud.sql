-- NoteNest Workspace cloud schema
-- Run the complete file in Supabase SQL Editor. Never place a service_role key in the browser.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'My workspace',
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id,user_id)
);
create index if not exists workspace_members_user_id_idx on public.workspace_members(user_id);

create or replace function private.is_workspace_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (
  select 1 from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
); $$;

create or replace function private.workspace_role(p_workspace_id uuid)
returns text language sql stable security definer set search_path = ''
as $$ select m.role from public.workspace_members m
  where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid()) limit 1; $$;

create or replace function private.can_edit_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.workspace_role(p_workspace_id) in ('owner','admin','editor'), false); $$;

create or replace function private.can_manage_workspace(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(private.workspace_role(p_workspace_id) in ('owner','admin'), false); $$;

create or replace function private.add_workspace_owner()
returns trigger language plpgsql security definer set search_path = ''
as $$ begin
  insert into public.workspace_members(workspace_id,user_id,role)
  values (new.id,new.owner_id,'owner')
  on conflict (workspace_id,user_id) do update set role='owner';
  return new;
end; $$;
drop trigger if exists workspaces_add_owner on public.workspaces;
create trigger workspaces_add_owner after insert on public.workspaces
for each row execute function private.add_workspace_owner();

create or replace function private.create_workspace(p_name text default 'My workspace')
returns uuid language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in is required'; end if;
  insert into public.workspaces(name,owner_id)
  values (left(coalesce(nullif(trim(p_name),''),'My workspace'),100),auth.uid())
  returning id into new_id;
  return new_id;
end; $$;

create table if not exists public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code_hash bytea not null unique,
  role text not null check (role in ('editor','viewer')),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz not null,
  uses_remaining integer not null default 1 check (uses_remaining between 1 and 100),
  created_at timestamptz not null default now()
);

create or replace function private.create_workspace_invite(
  p_workspace_id uuid, p_role text default 'editor', p_expires_hours integer default 168, p_uses integer default 5
)
returns text language plpgsql security definer set search_path = ''
as $$
declare raw_code text;
begin
  if not private.can_manage_workspace(p_workspace_id) then raise exception 'Workspace admin access required'; end if;
  if p_role not in ('editor','viewer') then raise exception 'Invite role must be editor or viewer'; end if;
  if p_expires_hours < 1 or p_expires_hours > 720 then raise exception 'Expiry must be between 1 and 720 hours'; end if;
  if p_uses < 1 or p_uses > 100 then raise exception 'Uses must be between 1 and 100'; end if;
  raw_code := encode(extensions.gen_random_bytes(24),'hex');
  insert into public.workspace_invites(workspace_id,code_hash,role,created_by,expires_at,uses_remaining)
  values (p_workspace_id,extensions.digest(raw_code,'sha256'),p_role,auth.uid(),now()+make_interval(hours=>p_expires_hours),p_uses);
  return raw_code;
end; $$;

create or replace function private.join_workspace_with_invite(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare invite_row public.workspace_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'Sign in before accepting a workspace invitation'; end if;
  if length(coalesce(p_code,'')) < 32 or length(p_code) > 128 then raise exception 'Invalid invitation code'; end if;
  select * into invite_row from public.workspace_invites
    where code_hash = extensions.digest(p_code,'sha256')
      and expires_at > now() and uses_remaining > 0
    for update;
  if not found then raise exception 'This invitation is invalid, expired or already used'; end if;
  insert into public.workspace_members(workspace_id,user_id,role)
  values (invite_row.workspace_id,auth.uid(),invite_row.role)
  on conflict (workspace_id,user_id) do nothing;
  update public.workspace_invites set uses_remaining=uses_remaining-1 where id=invite_row.id;
  return invite_row.workspace_id;
end; $$;

create table if not exists public.pages (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  parent_id uuid,
  title text not null default 'Untitled',
  icon text not null default '📄',
  blocks jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}',
  favorite boolean not null default false,
  trashed boolean not null default false,
  created_by uuid not null references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id),
  foreign key (workspace_id,parent_id) references public.pages(workspace_id,id) on delete cascade
);
create index if not exists pages_workspace_updated_idx on public.pages(workspace_id,updated_at desc);
create index if not exists pages_parent_idx on public.pages(parent_id);


create or replace function private.can_edit_page(p_workspace_id uuid,p_page_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select coalesce(
  private.can_edit_workspace(p_workspace_id)
  and exists(select 1 from public.pages p where p.workspace_id=p_workspace_id and p.id=p_page_id),
  false
); $$;

create table if not exists public.page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  snapshot jsonb not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists page_versions_page_date_idx on public.page_versions(page_id,created_at desc);

create or replace function private.capture_page_version()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if (old.title,old.icon,old.blocks,old.tags) is distinct from (new.title,new.icon,new.blocks,new.tags) then
    if not exists (
      select 1 from public.page_versions v
      where v.page_id=old.id and v.created_at > now()-interval '60 seconds'
    ) then
      insert into public.page_versions(page_id,workspace_id,snapshot,created_by)
      values(old.id,old.workspace_id,jsonb_build_object(
        'title',old.title,'icon',old.icon,'blocks',old.blocks,'tags',old.tags
      ),auth.uid());
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists pages_capture_version on public.pages;
create trigger pages_capture_version before update on public.pages
for each row execute function private.capture_page_version();

create or replace function public.set_updated_at()
returns trigger language plpgsql
as $$ begin new.updated_at=now(); return new; end; $$;
drop trigger if exists pages_set_updated_at on public.pages;
create trigger pages_set_updated_at before update on public.pages
for each row execute function public.set_updated_at();

create table if not exists public.workspace_databases (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'Untitled database',
  icon text not null default '▦',
  fields jsonb not null default '[]'::jsonb,
  view_type text not null default 'table' check(view_type in ('table','board','calendar','gallery')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id,id)
);
create index if not exists workspace_databases_workspace_idx on public.workspace_databases(workspace_id);

create table if not exists public.database_entries (
  id uuid primary key,
  database_id uuid not null,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null default 'Untitled',
  status text not null default 'Not started',
  due_date date,
  description text not null default '',
  cover_url text,
  data jsonb not null default '{}'::jsonb,
  position integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id,database_id) references public.workspace_databases(workspace_id,id) on delete cascade
);
create index if not exists database_entries_db_position_idx on public.database_entries(database_id,position,updated_at desc);

create table if not exists public.page_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_page_id uuid not null,
  target_page_id uuid not null,
  relation_type text not null default 'related',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(source_page_id,target_page_id),
  foreign key (workspace_id,source_page_id) references public.pages(workspace_id,id) on delete cascade,
  foreign key (workspace_id,target_page_id) references public.pages(workspace_id,id) on delete cascade,
  check(source_page_id <> target_page_id)
);
create index if not exists page_relations_target_idx on public.page_relations(target_page_id);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  page_id uuid not null references public.pages(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id,page_id) references public.pages(workspace_id,id) on delete cascade
);
create index if not exists attachments_page_idx on public.attachments(page_id,created_at desc);

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_invites enable row level security;
alter table public.pages enable row level security;
alter table public.page_versions enable row level security;
alter table public.workspace_databases enable row level security;
alter table public.database_entries enable row level security;
alter table public.page_relations enable row level security;
alter table public.attachments enable row level security;

drop policy if exists "workspace members can view workspaces" on public.workspaces;
create policy "workspace members can view workspaces" on public.workspaces for select to authenticated using(private.is_workspace_member(id));
drop policy if exists "workspace admins can update workspaces" on public.workspaces;
create policy "workspace admins can update workspaces" on public.workspaces for update to authenticated using(private.can_manage_workspace(id)) with check(private.can_manage_workspace(id));

drop policy if exists "members can view workspace members" on public.workspace_members;
create policy "members can view workspace members" on public.workspace_members for select to authenticated using(private.is_workspace_member(workspace_id));

drop policy if exists "members can view pages" on public.pages;
create policy "members can view pages" on public.pages for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists "editors can create pages" on public.pages;
create policy "editors can create pages" on public.pages for insert to authenticated with check(private.can_edit_workspace(workspace_id) and created_by=(select auth.uid()));
drop policy if exists "editors can update pages" on public.pages;
create policy "editors can update pages" on public.pages for update to authenticated using(private.can_edit_workspace(workspace_id)) with check(private.can_edit_workspace(workspace_id));
drop policy if exists "editors can delete pages" on public.pages;
create policy "editors can delete pages" on public.pages for delete to authenticated using(private.can_edit_workspace(workspace_id));

drop policy if exists "members can view versions" on public.page_versions;
create policy "members can view versions" on public.page_versions for select to authenticated using(private.is_workspace_member(workspace_id));

drop policy if exists "members can view databases" on public.workspace_databases;
create policy "members can view databases" on public.workspace_databases for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists "editors can create databases" on public.workspace_databases;
create policy "editors can create databases" on public.workspace_databases for insert to authenticated with check(private.can_edit_workspace(workspace_id) and created_by=(select auth.uid()));
drop policy if exists "editors can update databases" on public.workspace_databases;
create policy "editors can update databases" on public.workspace_databases for update to authenticated using(private.can_edit_workspace(workspace_id)) with check(private.can_edit_workspace(workspace_id));
drop policy if exists "editors can delete databases" on public.workspace_databases;
create policy "editors can delete databases" on public.workspace_databases for delete to authenticated using(private.can_edit_workspace(workspace_id));

drop policy if exists "members can view database entries" on public.database_entries;
create policy "members can view database entries" on public.database_entries for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists "editors can create database entries" on public.database_entries;
create policy "editors can create database entries" on public.database_entries for insert to authenticated with check(private.can_edit_workspace(workspace_id) and created_by=(select auth.uid()));
drop policy if exists "editors can update database entries" on public.database_entries;
create policy "editors can update database entries" on public.database_entries for update to authenticated using(private.can_edit_workspace(workspace_id)) with check(private.can_edit_workspace(workspace_id));
drop policy if exists "editors can delete database entries" on public.database_entries;
create policy "editors can delete database entries" on public.database_entries for delete to authenticated using(private.can_edit_workspace(workspace_id));

drop policy if exists "members can view page relations" on public.page_relations;
create policy "members can view page relations" on public.page_relations for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists "editors can create page relations" on public.page_relations;
create policy "editors can create page relations" on public.page_relations for insert to authenticated with check(private.can_edit_workspace(workspace_id) and created_by=(select auth.uid()));
drop policy if exists "editors can remove page relations" on public.page_relations;
create policy "editors can remove page relations" on public.page_relations for delete to authenticated using(private.can_edit_workspace(workspace_id));

drop policy if exists "members can view attachments" on public.attachments;
create policy "members can view attachments" on public.attachments for select to authenticated using(private.is_workspace_member(workspace_id));
drop policy if exists "editors can add attachments" on public.attachments;
create policy "editors can add attachments" on public.attachments for insert to authenticated with check(private.can_edit_workspace(workspace_id) and created_by=(select auth.uid()));
drop policy if exists "editors can remove attachments" on public.attachments;
create policy "editors can remove attachments" on public.attachments for delete to authenticated using(private.can_edit_workspace(workspace_id));


-- Public RPC endpoints are SECURITY INVOKER wrappers. Privileged work is done
-- by private-schema implementations with explicit auth.uid() checks.
create or replace function public.create_workspace(p_name text default 'My workspace')
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_workspace(p_name); $$;

create or replace function public.create_workspace_invite(
  p_workspace_id uuid, p_role text default 'editor', p_expires_hours integer default 168, p_uses integer default 5
)
returns text language sql security invoker set search_path = ''
as $$ select private.create_workspace_invite(p_workspace_id,p_role,p_expires_hours,p_uses); $$;

create or replace function public.join_workspace_with_invite(p_code text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.join_workspace_with_invite(p_code); $$;

revoke all on public.workspace_invites from anon, authenticated;
grant select, update on public.workspaces to authenticated;
grant select on public.workspace_members to authenticated;
grant select,insert,update,delete on public.pages to authenticated;
grant select on public.page_versions to authenticated;
grant select,insert,update,delete on public.workspace_databases to authenticated;
grant select,insert,update,delete on public.database_entries to authenticated;
grant select,insert,delete on public.page_relations to authenticated;
grant select,insert,delete on public.attachments to authenticated;
grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.workspace_role(uuid) to authenticated;
grant execute on function private.can_edit_workspace(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;
grant execute on function private.can_edit_page(uuid,uuid) to authenticated;
grant execute on function private.create_workspace(text) to authenticated;
grant execute on function private.create_workspace_invite(uuid,text,integer,integer) to authenticated;
grant execute on function private.join_workspace_with_invite(text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('notenest-files','notenest-files',false,26214400,
  array['image/jpeg','image/png','image/gif','image/webp','image/svg+xml','application/pdf','text/plain','text/markdown','application/zip','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do update set public=false,file_size_limit=26214400;

drop policy if exists "workspace members can read note files" on storage.objects;
create policy "workspace members can read note files" on storage.objects for select to authenticated
using(bucket_id='notenest-files' and private.is_workspace_member((storage.foldername(name))[1]::uuid));
drop policy if exists "workspace editors can upload note files" on storage.objects;
create policy "workspace editors can upload note files" on storage.objects for insert to authenticated
with check(bucket_id='notenest-files' and private.can_edit_page((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
drop policy if exists "workspace editors can update note files" on storage.objects;
create policy "workspace editors can update note files" on storage.objects for update to authenticated
using(bucket_id='notenest-files' and private.can_edit_page((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid))
with check(bucket_id='notenest-files' and private.can_edit_page((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));
drop policy if exists "workspace editors can delete note files" on storage.objects;
create policy "workspace editors can delete note files" on storage.objects for delete to authenticated
using(bucket_id='notenest-files' and private.can_edit_page((storage.foldername(name))[1]::uuid,(storage.foldername(name))[2]::uuid));

-- Full replica identity lets Realtime deliver old row values for deletes.
alter table public.pages replica identity full;
alter table public.workspace_databases replica identity full;
alter table public.database_entries replica identity full;
alter table public.page_relations replica identity full;
alter table public.attachments replica identity full;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    begin alter publication supabase_realtime add table public.pages; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.workspace_databases; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.database_entries; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.workspace_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.page_relations; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.attachments; exception when duplicate_object then null; end;
  end if;
end $$;

-- RLS smoke checks to run after creating two test accounts:
-- A non-member must receive zero rows from workspaces/pages for another workspace.
-- A viewer may SELECT but must not INSERT/UPDATE/DELETE pages or database entries.
-- An editor may edit content but must not create or manage workspace invites.
-- An owner/admin may create invitations and add members only through join_workspace_with_invite().


-- Private-schema privileged functions are not directly exposed by the Data API.
revoke all on function private.is_workspace_member(uuid) from public, anon;
revoke all on function private.workspace_role(uuid) from public, anon;
revoke all on function private.can_edit_workspace(uuid) from public, anon;
revoke all on function private.can_manage_workspace(uuid) from public, anon;
revoke all on function private.can_edit_page(uuid,uuid) from public, anon;
revoke all on function private.add_workspace_owner() from public, anon;
revoke all on function private.create_workspace(text) from public, anon;
revoke all on function private.create_workspace_invite(uuid,text,integer,integer) from public, anon;
revoke all on function private.join_workspace_with_invite(text) from public, anon;
revoke all on function private.capture_page_version() from public, anon;

grant execute on function private.is_workspace_member(uuid) to authenticated;
grant execute on function private.workspace_role(uuid) to authenticated;
grant execute on function private.can_edit_workspace(uuid) to authenticated;
grant execute on function private.can_manage_workspace(uuid) to authenticated;
grant execute on function private.create_workspace(text) to authenticated;
grant execute on function private.create_workspace_invite(uuid,text,integer,integer) to authenticated;
grant execute on function private.join_workspace_with_invite(text) to authenticated;

revoke all on function public.create_workspace(text) from public, anon;
revoke all on function public.create_workspace_invite(uuid,text,integer,integer) from public, anon;
revoke all on function public.join_workspace_with_invite(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;
grant execute on function public.create_workspace_invite(uuid,text,integer,integer) to authenticated;
grant execute on function public.join_workspace_with_invite(text) to authenticated;
