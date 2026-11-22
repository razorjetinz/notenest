# NoteNest Cloud setup (Supabase)

This guide connects the public NoteNest web app to a Supabase project. The web interface remains hosted on GitHub Pages; Supabase supplies the database, authentication, real-time events and private file storage.

## 1. Create a Supabase project

1. Open https://supabase.com/dashboard and create a free project.
2. Choose a project name and a strong database password. Save the database password somewhere safe; NoteNest does not need it.
3. Choose the region closest to the people who will use the workspace.
4. Wait until the project is ready.

Supabase free-plan quotas and limits can change. Check the current Supabase pricing page before relying on a particular amount of storage or monthly usage.

## 2. Install the NoteNest database schema

1. Open the Supabase project.
2. Choose **SQL Editor → New query**.
3. Run `supabase/migrations/202611220001_notenest_cloud.sql` from the repository.
4. In a second query, run `supabase/migrations/202611220002_notenest_security_performance.sql`.
5. Confirm that both queries complete without errors. The second migration tightens function settings, denies direct invitation-table access and adds foreign-key indexes.

The migration creates the NoteNest tables, workspace roles, invitation functions, page-version trigger, a private Storage bucket and Row Level Security (RLS) policies. Do not remove or disable RLS.

## 3. Configure authentication URLs

In Supabase, open **Authentication → URL Configuration**. This setting must be completed in the Dashboard; the Supabase management connection available to this session does not expose the Auth URL configuration endpoint.

Set the Site URL to:

```
https://razorjetinz.github.io/notenest/
```

Add these Redirect URLs:

```
https://razorjetinz.github.io/notenest/
http://localhost:8080/
```

The local URL is for local testing only. When using a different local port or a custom domain, add that exact URL too.

Under **Authentication → Providers → Email**, enable email/password sign-in. Keeping email confirmation enabled is recommended. With confirmation enabled, a new user must click the confirmation email before signing in. Configure a custom SMTP provider if you need reliable email delivery beyond the project's default testing limits.

## 4. Copy the browser-safe project credentials

Open **Project Settings → API** (or the project's API keys section).

Copy:
- **Project URL**
- **Publishable key** (or the legacy **anon** public key)

Do not use a secret key or the `service_role` key. The browser must never receive a privileged key. The database policies are designed to enforce access for the public key.

## 5. Connect NoteNest

1. Open https://razorjetinz.github.io/notenest/.
2. Open **Settings & backup** in the left navigation.
3. In **Cloud workspace**, paste the Project URL and publishable/anon key.
4. Select **Save connection**.
5. Enter your email and password and choose **Create account**.
6. Confirm the email if Supabase asks you to.
7. Return to NoteNest and select **Sign in**.

The first signed-in user automatically receives a new workspace as its owner. When that workspace has no pages, NoteNest uploads the pages currently stored in that browser. When the cloud workspace already contains pages, its data is loaded into the browser. Export a JSON backup before connecting a browser that contains important local work.

## 6. Invite collaborators

1. Open **Settings & backup → Cloud workspace**.
2. Under **Invite collaborators**, choose Editor or Viewer.
3. Select **Create invite link** and copy the link.
4. Send the link to the person you want to invite.
5. They open the link, create a NoteNest account or sign in, and accept the invitation.

Invitations expire after seven days and allow up to five uses. Owners and admins can create invitations. Editors can update content. Viewers can read content but cannot modify it. Database RLS policies enforce these permissions; hiding a button in the interface is not the security boundary.

The application lists member IDs and roles. It does not expose other users' email addresses from the authentication database.

## 7. Cloud features

- Pages are stored in Postgres and sync automatically while connected.
- Realtime database events notify open clients when pages, database records or databases change.
- Databases support Table, Board, Calendar and Gallery views. The initial database schema includes a title, status, due date, description and optional cover image URL.
- Attachments use a private Storage bucket. Files up to 25 MB are accepted by the NoteNest client and bucket configuration. Signed file links are short-lived.
- Page relations create linked pages and backlinks.
- The database trigger saves earlier page content snapshots. Use **History** on a page to restore a previous snapshot.
- JSON backup and Markdown export remain available.

## 8. Data ownership and limitations

- Your Supabase project is the cloud data store. GitHub Pages only hosts the public HTML, CSS and JavaScript application.
- NoteNest sends no page content to InfiOffice or GitHub. Data is sent to the Supabase project URL you configure.
- Supabase's publishable/anon key is public by design. RLS and Storage policies protect rows and files. Never share the database password or a service-role/secret key.
- Local browser data remains available as a fallback. It does not automatically sync while signed out or offline.
- Realtime updates provide shared workspace refreshes, not Google-Docs-style simultaneous character-level editing or cursors. If two people edit the same page at the same time, the last saved page version can replace the other person's changes. Coordinate edits to the same page until conflict-aware merging is added.
- Version snapshots are throttled to at most one snapshot per page per minute during repeated edits.
- Calendar view currently shows the current month. Database fields and views are a first implementation, not yet a full Notion-style configurable database engine.
- File previews use browser-supported formats. Unsupported files can still be downloaded.
- GitHub Pages serves a public application shell. Do not put private keys or personal information in source files, repository settings, URLs, or the README.

## Troubleshooting

**"relation does not exist" or "Could not find the table":** rerun the complete SQL migration in the correct Supabase project, then reload NoteNest.

**"Invalid API key":** check that the Project URL and publishable/anon key belong to the same project. Do not paste the service-role key.

**Email confirmation link returns an error:** add the exact NoteNest URL under Authentication → URL Configuration → Redirect URLs.

**Cloud sync is denied:** check that the signed-in account is a member of the selected workspace and that the migration's RLS policies remain enabled. Viewers cannot edit.

**Files fail to upload:** confirm the migration created the private `notenest-files` bucket and check that the file is below 25 MB and uses an allowed MIME type.

**Move your data:** use Settings & backup → Export JSON on the source device and Import backup on the destination device. Keep the exported file secure because it contains your workspace content.


## Additional password protection

The Supabase Security Advisor reports that leaked-password protection is currently disabled. In the Supabase Dashboard, open **Authentication → Settings → Password security** and enable leaked password protection. The management connection used for database deployment does not expose this Auth security toggle, so it has not been changed automatically.
