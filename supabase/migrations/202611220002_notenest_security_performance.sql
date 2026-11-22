-- NoteNest cloud hardening and supporting indexes.
-- The workspace_invites table is intentionally accessed only by private RPC functions.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;

-- Keep invitation rows inaccessible through the public Data API, even if a
-- future change accidentally adds table privileges to anon/authenticated.
drop policy if exists "workspace_invites denied direct access" on public.workspace_invites;
create policy "workspace_invites denied direct access"
on public.workspace_invites
for all
to anon, authenticated
using (false)
with check (false);

-- Index all foreign-key columns used for membership checks, joins and deletes.
create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);
create index if not exists workspace_invites_workspace_id_idx on public.workspace_invites(workspace_id);
create index if not exists workspace_invites_created_by_idx on public.workspace_invites(created_by);
create index if not exists pages_created_by_idx on public.pages(created_by);
create index if not exists pages_updated_by_idx on public.pages(updated_by);
create index if not exists pages_workspace_parent_idx on public.pages(workspace_id,parent_id);
create index if not exists page_versions_workspace_id_idx on public.page_versions(workspace_id);
create index if not exists page_versions_created_by_idx on public.page_versions(created_by);
create index if not exists workspace_databases_created_by_idx on public.workspace_databases(created_by);
create index if not exists database_entries_workspace_id_idx on public.database_entries(workspace_id);
create index if not exists database_entries_workspace_database_idx on public.database_entries(workspace_id,database_id);
create index if not exists database_entries_created_by_idx on public.database_entries(created_by);
create index if not exists page_relations_workspace_id_idx on public.page_relations(workspace_id);
create index if not exists page_relations_workspace_source_idx on public.page_relations(workspace_id,source_page_id);
create index if not exists page_relations_workspace_target_idx on public.page_relations(workspace_id,target_page_id);
create index if not exists page_relations_created_by_idx on public.page_relations(created_by);
create index if not exists attachments_workspace_id_idx on public.attachments(workspace_id);
create index if not exists attachments_workspace_page_idx on public.attachments(workspace_id,page_id);
create index if not exists attachments_created_by_idx on public.attachments(created_by);
