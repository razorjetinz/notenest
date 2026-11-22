# NoteNest Workspace

**A calm, open-source workspace for notes, documents, tasks and ideas.**

NoteNest Workspace is a Notion-inspired, local-first web app. Organise your thoughts in pages, build structured documents with content blocks, create checklists, and keep your work portable.

**Live app:** https://razorjetinz.github.io/notenest/  
**Repository:** https://github.com/razorjetinz/notenest  
**Made by:** [InfiOffice](https://infioffice.com)

## Features

- **Pages and subpages** — organise information in a simple page hierarchy.
- **Block editor** — paragraphs, three heading levels, bulleted and numbered lists, to-dos, quotes, code blocks, callouts and dividers.
- **Page templates** — start with a blank page, meeting notes, project planner or journal.
- **Workspace navigation** — home dashboard, all pages, favorites and trash.
- **Quick search** — search page titles, tags and page text.
- **Tags and page icons** — label pages and add a visual marker.
- **Autosave** — changes are saved in the browser using IndexedDB, with a local-storage fallback.
- **Portable data** — export a complete JSON backup, import a backup, or export pages as Markdown.
- **Markdown import** — bring in existing .md, .markdown and .txt documents.
- **Light and dark themes** — responsive layout for desktop, tablet and mobile.
- **Installable PWA** — install it as a desktop/mobile app and use the cached app shell offline after the first successful visit.
- **No external JavaScript dependencies** — no build step, account, analytics or tracking.

## Run locally

You can open index.html directly for basic use. For service-worker and installable PWA support, run a local web server:

~~~bash
python3 -m http.server 8080
~~~

Then visit http://localhost:8080.

## Publish with GitHub Pages

This repository uses GitHub Pages' built-in deployment workflow.

1. Open this repository's **Settings → Pages**.
2. Under **Build and deployment**, select **Deploy from a branch**.
3. Choose branch **main** and folder **/(root)**, then save.
4. GitHub will build and publish the site after each push to main. You can follow progress in the **Actions** tab.
5. Open https://razorjetinz.github.io/notenest/ once the deployment succeeds.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl / ⌘ + N | Create a page |
| Ctrl / ⌘ + K | Search the workspace |
| Ctrl / ⌘ + S | Save now |

Press Enter at the end of a block to create the next block. Use Shift + Enter for a new line inside the current block.

## Privacy and storage

NoteNest is local-first. Page content is stored in the current browser profile on the current device. It is **not** sent to a server, and there is no account or telemetry. Your pages will not automatically sync between browsers or devices.

Use **Settings & backup → Export JSON** regularly. To move your workspace to another device, export the JSON backup on the first device and import it on the second. Clearing browser site data can delete your local workspace.

## Current scope

This release is a personal workspace foundation, not a hosted multi-user Notion clone. It does not yet provide accounts, cloud synchronisation, real-time collaboration, permissions, public sharing, relational databases, or hosted file storage. Those capabilities require a server-side service and are planned as future milestones.

## Roadmap

- [ ] Cloud sync with a self-hostable backend
- [ ] User accounts, workspaces and access controls
- [ ] Real-time collaboration and sharing
- [ ] Database views (table, board, calendar and gallery)
- [ ] File and image attachments
- [ ] Backlinks, mentions and page relations
- [ ] Version history and restore points
- [ ] More importers and exporters

## Contributing

Bug reports, feature requests and pull requests are welcome. For substantial changes, open an issue first so the implementation can be discussed.

## License

MIT. See LICENSE.

---

Made with care by [InfiOffice](https://infioffice.com).