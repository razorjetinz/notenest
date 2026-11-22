-- Keep page-version snapshots tied to the page and workspace they describe.
alter table public.page_versions
  add constraint page_versions_workspace_page_fkey
  foreign key (workspace_id,page_id)
  references public.pages(workspace_id,id)
  on delete cascade;

-- The workspace-aware composite foreign key is stronger and replaces this
-- redundant page-only constraint.
alter table public.attachments
  drop constraint if exists attachments_page_id_fkey;

create index if not exists page_versions_workspace_page_idx
  on public.page_versions(workspace_id,page_id);
