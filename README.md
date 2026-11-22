# NoteNest Workspace

**A calm, open-source workspace for notes, documents, databases, tasks and ideas.**

NoteNest Workspace is a Notion-inspired web app with local-first storage and optional cloud collaboration powered by Supabase. Organise information in nested pages, write with structured content blocks, manage records in multiple database views, and keep your data portable.

**Live app:** https://razorjetinz.github.io/notenest/  
**Repository:** https://github.com/razorjetinz/notenest  
**Cloud setup:** [docs/CLOUD_SETUP.md](docs/CLOUD_SETUP.md)  
**Made by:** [InfiOffice](https://infioffice.com)

## Features

### Pages and editor
- Pages and nested subpages with icons, tags, favorites and trash.
- Block editor: paragraphs, headings, bullets, numbered lists, checklists, quotes, code, callouts and dividers.
- Inline Markdown formatting helpers for bold, italic, strikethrough, code and links.
- Drag-and-drop block reordering.
- Meeting notes, project planner and journal templates.
- Quick search across page titles, tags and block content.
- Page relations and backlinks.
- Per-page version history with restore.

### Databases
- Create structured databases for projects, tasks, content calendars and more.
- Table, Kanban board, calendar and gallery views.
- Record title, status, due date, description and optional cover image URL.
- Add, edit and delete records.

### Cloud and collaboration (optional)
- Email/password accounts managed by your own Supabase project.
- Workspace memberships with Owner, Admin, Editor and Viewer roles.
- Time-limited invitation links for Editors and Viewers.
- Postgres persistence, Realtime updates and private Supabase Storage attachments.
- Page version snapshots in Postgres.
- Row Level Security (RLS) policies for workspaces, pages, databases, relations, versions, attachments and file objects.

### Personal use and portability
- Local autosave with IndexedDB and a local-storage fallback.
- Import Markdown/text files and JSON workspace backups.
- Export a whole workspace as JSON or pages as Markdown.
- Responsive light and dark themes.
- Installable PWA with a cached app shell for offline use after the first successful visit.
- No analytics or tracking. No application build step.

## Quick start

Open https://razorjetinz.github.io/notenest/ and start using the local workspace. Pages stay in the current browser and device until you connect a cloud backend or export a backup.

## Enable cloud sync

Cloud sync is optional. You need your own Supabase project.

1. Create a Supabase project.
2. Run the three SQL migration files in order: `202611220001_notenest_cloud.sql`, `202611220002_notenest_security_performance.sql`, then `202611220003_notenest_relationship_integrity.sql` (all under `supabase/migrations/`).
3. Configure Supabase Auth Site URL and Redirect URLs for the NoteNest web address.
4. The published NoteNest site already contains the browser-safe URL and publishable key for its configured Supabase project. Open **Settings & backup → Cloud workspace**, create an account and sign in. For a fork or your own Supabase project, replace `cloud-config.js` with that project’s URL and publishable key.

Follow [the complete setup guide](docs/CLOUD_SETUP.md) for invitations, storage, security and troubleshooting.

**Never use a Supabase secret or service_role key in the browser.** The migration enables RLS and installs policies that enforce workspace permissions. Keep RLS enabled.

## Run locally

For local features, open `index.html` in a modern browser. For PWA/service-worker support and Supabase redirects, serve the files over HTTP:

~~~bash
python3 -m http.server 8080
~~~

Then visit http://localhost:8080. Add that exact origin to Supabase Auth Redirect URLs when testing cloud sign-in locally.

## GitHub Pages

The live web interface is hosted on GitHub Pages:

1. Open repository **Settings → Pages**.
2. Select **Deploy from a branch**.
3. Choose branch `main` and folder `/(root)`.
4. GitHub Pages publishes changes pushed to `main`.

GitHub Pages hosts static files only. Supabase provides the database, authentication, realtime service and file storage.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl / ⌘ + N | Create a page |
| Ctrl / ⌘ + K | Search the workspace |
| Ctrl / ⌘ + S | Save now |
| Enter at the end of a block | Create the next block |
| Shift + Enter | Add a line inside the current block |

## Data, privacy and sync behaviour

- Without Supabase configured, page and database data is stored in this browser profile on this device.
- With Supabase configured and signed in, NoteNest syncs workspace pages and database records to your own Supabase project.
- Attachments are stored in a private Supabase Storage bucket. Signed download links expire.
- The cloud app sends data to the Supabase URL you configure. It does not send page content to InfiOffice or GitHub.
- Export a JSON backup regularly. Clearing browser site data can delete local-only data.
- When first connecting to a new, empty cloud workspace, NoteNest uploads the current browser workspace. If cloud pages already exist, the cloud workspace is loaded into the browser. Export a backup before connecting devices with important unsynced local work.

## Current limitations

This is an actively evolving open-source project, not yet a feature-for-feature Notion replacement.

- Realtime updates refresh pages and database records; simultaneous character-level editing, cursors and conflict-aware merging are not included. The last saved version can win when two people edit the same page at once.
- Database views currently use an initial fixed field set. Custom field types, filters, formulas, rollups, relations and advanced sorting are not yet implemented.
- Calendar view currently displays the current month.
- File previews depend on the browser. Unsupported file types can still be downloaded.
- Version snapshots are throttled to at most one snapshot per page per minute during repeated edits.
- Workspace selection, member removal and detailed role administration are planned enhancements.

## Security notes

The client uses only a Supabase publishable key. Publishable keys are intentionally visible in browser source; they do not grant privileged database access when RLS is correctly configured. Never put database passwords, service-role keys, secret keys or SMTP credentials in this repository or browser configuration. The migration uses Postgres RLS and Storage policies; do not disable them. Review the policies before making schema changes or using the app for sensitive production data.

## Roadmap

- [ ] Conflict-aware collaborative editing and presence
- [ ] Custom database fields, filters, sorting, formulas and rollups
- [ ] Calendar navigation and richer database relations
- [ ] Workspace switching and member administration
- [ ] More importers, export formats and migration tools
- [ ] Automated unit, integration and RLS test coverage

## Contributing

Bug reports, feature requests and pull requests are welcome. For substantial changes, open an issue first so the implementation can be discussed.

## License

MIT. See [LICENSE](LICENSE).

---

Made with care by [InfiOffice](https://infioffice.com).
