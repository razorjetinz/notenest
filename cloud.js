(function () {
  "use strict";
  const CONFIG_KEY = "notenest.supabase.config.v1";
  const WORKSPACE_KEY = "notenest.supabase.workspace.v1";
  const BUCKET = "notenest-files";
  const MAX_FILE_SIZE = 25 * 1024 * 1024;
  let client = null, user = null, workspaceId = null, workspaceName = "My workspace";
  let syncTimer = null, syncing = false, loadingRemote = false, channel = null;
  let activeDatabaseId = null, lastInviteUrl = "", lastSelection = null;

  const App = () => window.NoteNestApp;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const uid = () => App().uid();
  const workspace = () => App().getWorkspace();
  const pages = () => App().activePages();
  const byPage = (id) => workspace().pages.find((p) => p.id === id) || null;
  const byDatabase = (id) => (workspace().databases || []).find((d) => d.id === id) || null;
  const config = () => {
    if (localStorage.getItem("notenest.cloud.disabled") === "1") return null;
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || "null");
      if (saved && saved.url && saved.key) return saved;
    } catch (_) {}
    return window.NOTENEST_SUPABASE_CONFIG || null;
  };
  const isConnected = () => !!(client && user && workspaceId);

  function errorMessage(error) {
    if (!error) return "Unknown error";
    return error.message || error.error_description || String(error);
  }
  function setStatus(text, state) {
    const label = $("cloud-state");
    if (label) {
      label.textContent = text;
      label.className = "cloud-state " + (state || "");
    }
  }
  function notify(message) { if (App()) App().notify(message); }

  function handleRemoteRelation(payload) {
    if(loadingRemote||syncing)return;
    const row=payload.new||payload.old;if(!row||!row.id)return;
    const data=workspace();data.relations=data.relations||[];
    if(payload.eventType==="DELETE")data.relations=data.relations.filter(r=>r.id!==row.id);
    else if(!data.relations.some(r=>r.id===row.id))data.relations.push({id:row.id,sourcePageId:row.source_page_id,targetPageId:row.target_page_id,relationType:row.relation_type});
    App().persistNow();const page=App().currentPage();if(page)renderPageExtras(page);
  }
  function handleRemoteAttachment(payload) {
    if(loadingRemote||syncing)return;
    const row=payload.new||payload.old;if(!row||!row.id)return;
    const data=workspace();data.attachments=data.attachments||[];
    if(payload.eventType==="DELETE")data.attachments=data.attachments.filter(a=>a.id!==row.id);
    else if(!data.attachments.some(a=>a.id===row.id))data.attachments.push({id:row.id,pageId:row.page_id,storagePath:row.storage_path,fileName:row.file_name,mimeType:row.mime_type,sizeBytes:row.size_bytes,createdAt:new Date(row.created_at).getTime()});
    App().persistNow();const page=App().currentPage();if(page)renderPageExtras(page);
  }
  function renderCloudPanel() {
    const host = $("cloud-panel");
    if (!host) return;
    const cfg = config();
    const configMarkup = '<div class="settings-card cloud-setup-card"><div class="cloud-panel-title"><h3>Cloud workspace</h3><span id="cloud-state" class="cloud-state ' + (isConnected() ? "online" : "offline") + '">' + (isConnected() ? "Connected" : "Not connected") + '</span></div>' +
      '<p>Connect a Supabase project to sync pages between devices, share workspaces, collaborate and store attachments.</p>' +
      '<label class="cloud-label" for="cloud-url">Supabase project URL</label><input class="cloud-input" id="cloud-url" type="url" placeholder="https://your-project.supabase.co" value="' + esc(cfg && cfg.url || "") + '">' +
      '<label class="cloud-label" for="cloud-key">Publishable / anon key</label><input class="cloud-input" id="cloud-key" type="password" autocomplete="off" placeholder="sb_publishable_... or anon key" value="' + esc(cfg && cfg.key || "") + '">' +
      '<div class="settings-actions"><button class="primary-button" data-action="cloud-connect">Save connection</button>' +
      (cfg ? '<button class="secondary-button" data-action="cloud-disconnect">Forget configuration</button>' : '') + '</div>' +
      '<p class="cloud-footnote">Use only the public publishable (or legacy anon) key here. Never paste a service_role or secret key.</p></div>';

    if (!cfg) {
      host.innerHTML = configMarkup +
        '<div class="settings-card"><h3>How to get connected</h3><p>Create a free Supabase project, run the SQL migration from the repository, then paste the project URL and publishable key above. The setup guide is in the repository under docs/CLOUD_SETUP.md.</p><div class="settings-actions"><a class="secondary-button" href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Open Supabase ↗</a><a class="secondary-button" href="https://github.com/razorjetinz/notenest/blob/main/docs/CLOUD_SETUP.md" target="_blank" rel="noopener noreferrer">Setup guide ↗</a></div></div>';
      return;
    }

    if (!client) {
      host.innerHTML = configMarkup + '<div class="settings-card"><p>Supabase client is not available. Check your network connection and reload the page.</p></div>';
      return;
    }
    if (!user) {
      host.innerHTML = configMarkup +
        '<div class="settings-card"><h3>Sign in or create an account</h3><p>Use an email address and password to access your cloud workspace. Email confirmation may be required by your Supabase project settings.</p>' +
        '<label class="cloud-label" for="cloud-email">Email</label><input class="cloud-input" id="cloud-email" type="email" autocomplete="username" placeholder="you@example.com">' +
        '<label class="cloud-label" for="cloud-password">Password</label><input class="cloud-input" id="cloud-password" type="password" autocomplete="current-password" minlength="8" placeholder="At least 8 characters">' +
        '<div class="settings-actions"><button class="primary-button" data-action="cloud-signin">Sign in</button><button class="secondary-button" data-action="cloud-signup">Create account</button></div>' +
        '<p class="cloud-footnote">Your account is managed by your Supabase project. NoteNest does not see or store your password.</p></div>' +
        '<div class="settings-card"><h3>Have an invitation?</h3><p>Sign in first, then paste the invitation code or open the invite link on this device.</p><input class="cloud-input" id="invite-code" placeholder="Invitation code">' +
        '<div class="settings-actions"><button class="secondary-button" data-action="cloud-join-invite">Join workspace</button></div></div>';
      return;
    }
    const role = workspace().cloud_role || "member";
    const isAdmin = role === "owner" || role === "admin";
    const inviteControl = isAdmin ?
      '<div class="settings-actions"><select class="cloud-input compact" id="invite-role"><option value="editor">Editor — can edit</option><option value="viewer">Viewer — read only</option></select><button class="primary-button" data-action="cloud-create-invite">Create invite link</button></div><div id="invite-result"></div>' :
      '<p class="cloud-footnote">Only workspace owners and admins can create invitations.</p>';
    host.innerHTML = configMarkup +
      '<div class="settings-card"><div class="cloud-panel-title"><h3>Signed in</h3><span class="cloud-state online">Cloud active</span></div>' +
      '<p><strong>' + esc(user.email || user.id) + '</strong><br>Workspace: ' + esc(workspaceName) + '<br>Access: ' + esc(role) + '</p>' +
      '<div class="settings-actions"><button class="secondary-button" data-action="cloud-sync-now">Sync now</button><button class="secondary-button" data-action="cloud-signout">Sign out</button></div></div>' +
      '<div class="settings-card"><h3>Invite collaborators</h3><p>Create a time-limited invitation link. Editors can change content; viewers can read it. Share the link only with people you trust.</p>' + inviteControl + '</div>' +
      '<div class="settings-card"><h3>Join another workspace</h3><p>Paste an invitation code received from another NoteNest owner.</p><input class="cloud-input" id="invite-code" placeholder="Invitation code"><div class="settings-actions"><button class="secondary-button" data-action="cloud-join-invite">Join workspace</button></div></div>' +
      '<div class="settings-card"><h3>Members</h3><div id="workspace-members"><p class="cloud-footnote">Loading members…</p></div></div>' +
      '<p class="cloud-footnote">Cloud workspace: ' + esc(workspaceId) + '. Changes sync automatically while online. Local browser storage remains enabled as a fallback.</p>';
    loadMembers();
  }

  function saveConfig() {
    const url = ($("cloud-url")?.value || "").trim().replace(/\/+$/, "");
    const key = ($("cloud-key")?.value || "").trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
      notify("Enter a valid Supabase project URL."); return;
    }
    if (!key || key.length < 20 || /service_role|secret/i.test(key)) {
      notify("Use the publishable or anon key, not a secret key."); return;
    }
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, key }));
    localStorage.removeItem("notenest.cloud.disabled");
    initializeClient(true);
  }

  async function initializeClient(refreshUI) {
    const cfg = config();
    if (!cfg) { client = null; user = null; workspaceId = null; if (refreshUI) renderCloudPanel(); return; }
    if (!window.supabase || !window.supabase.createClient) {
      setStatus("SDK unavailable", "offline");
      if (refreshUI) renderCloudPanel();
      return;
    }
    try {
      client = window.supabase.createClient(cfg.url, cfg.key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      client.auth.onAuthStateChange((event, session) => {
        user = session ? session.user : null;
        if (event === "SIGNED_OUT") {
          workspaceId = null;
          if (channel) { client.removeChannel(channel); channel = null; }
          renderCloudPanel();
        } else if ((event === "SIGNED_IN" || event === "TOKEN_REFRESHED") && user) {
          setTimeout(() => loadCloudWorkspace().catch((e) => notify("Cloud sync: " + errorMessage(e))), 0);
        }
      });
      const result = await client.auth.getSession();
      user = result.data.session ? result.data.session.user : null;
      if (user) await loadCloudWorkspace();
      if (refreshUI) renderCloudPanel();
    } catch (error) {
      setStatus("Connection error", "offline");
      notify("Could not connect to Supabase: " + errorMessage(error));
      if (refreshUI) renderCloudPanel();
    }
  }

  async function authenticate(mode) {
    if (!client) return;
    const email = ($("cloud-email")?.value || "").trim();
    const password = $("cloud-password")?.value || "";
    if (!email || password.length < 8) { notify("Enter your email and a password with at least 8 characters."); return; }
    setStatus(mode === "signup" ? "Creating account…" : "Signing in…", "busy");
    let result;
    if (mode === "signup") result = await client.auth.signUp({ email, password });
    else result = await client.auth.signInWithPassword({ email, password });
    if (result.error) {
      setStatus("Sign-in failed", "offline");
      notify(errorMessage(result.error));
      return;
    }
    if (mode === "signup" && !result.data.session) {
      setStatus("Check your email", "busy");
      notify("Account created. Confirm the email, then return here and sign in.");
      return;
    }
    user = result.data.user;
    await loadCloudWorkspace();
    renderCloudPanel();
    notify("Connected to your cloud workspace.");
  }

  async function loadCloudWorkspace() {
    if (!client || !user || loadingRemote) return;
    loadingRemote = true;
    try {
      const membership = await client.from("workspace_members").select("workspace_id,role").eq("user_id", user.id);
      if (membership.error) throw membership.error;
      let selected = localStorage.getItem(WORKSPACE_KEY);
      let member = (membership.data || []).find((m) => m.workspace_id === selected) || (membership.data || [])[0];
      if (!member) {
        const created = await client.rpc("create_workspace", { p_name: "My NoteNest workspace" });
        if (created.error) throw created.error;
        const createdId = created.data;
        member = { workspace_id: createdId, role: "owner" };
      }
      workspaceId = member.workspace_id;
      localStorage.setItem(WORKSPACE_KEY, workspaceId);
      const wsResult = await client.from("workspaces").select("id,name").eq("id", workspaceId).single();
      if (wsResult.error) throw wsResult.error;
      workspaceName = wsResult.data.name || "My workspace";

      const names = ["pages", "workspace_databases", "database_entries", "page_relations", "attachments"];
      const results = await Promise.all(names.map((name) => client.from(name).select("*").eq("workspace_id", workspaceId)));
      results.forEach((r) => { if (r.error) throw r.error; });
      const pageRows = results[0].data || [];
      const dbRows = results[1].data || [];
      const entryRows = results[2].data || [];
      const relationRows = results[3].data || [];
      const attachmentRows = results[4].data || [];

      if (!pageRows.length) {
        const local = workspace();
        local.cloud_workspace_id = workspaceId;
        local.cloud_role = member.role;
        local.databases = local.databases || [];
        local.relations = local.relations || [];
        local.attachments = local.attachments || [];
        await syncWorkspace(true);
      } else {
        const mappedPages = pageRows.map((p) => ({
          id: p.id, parentId: p.parent_id, title: p.title, icon: p.icon, blocks: p.blocks || [],
          tags: p.tags || [], favorite: !!p.favorite, trashed: !!p.trashed,
          createdAt: new Date(p.created_at).getTime(), updatedAt: new Date(p.updated_at).getTime(),
          createdBy: p.created_by, updatedBy: p.updated_by
        }));
        const entriesByDb = new Map();
        entryRows.forEach((e) => {
          if (!entriesByDb.has(e.database_id)) entriesByDb.set(e.database_id, []);
          entriesByDb.get(e.database_id).push({
            id: e.id, title: e.title, status: e.status, due_date: e.due_date,
            description: e.description, cover_url: e.cover_url, data: e.data || {},
            position: e.position, createdAt: new Date(e.created_at).getTime(), updatedAt: new Date(e.updated_at).getTime()
          });
        });
        const mappedDbs = dbRows.map((d) => ({
          id: d.id, title: d.title, icon: d.icon, fields: d.fields || [], view: d.view_type || "table",
          entries: entriesByDb.get(d.id) || [], createdAt: new Date(d.created_at).getTime(), updatedAt: new Date(d.updated_at).getTime()
        }));
        const mappedRelations = relationRows.map((r) => ({ id:r.id, sourcePageId:r.source_page_id, targetPageId:r.target_page_id, relationType:r.relation_type }));
        const mappedAttachments = attachmentRows.map((a) => ({ id:a.id, pageId:a.page_id, storagePath:a.storage_path, fileName:a.file_name, mimeType:a.mime_type, sizeBytes:a.size_bytes, createdAt:new Date(a.created_at).getTime() }));
        App().replaceWorkspace({
          pages: mappedPages, databases: mappedDbs, relations: mappedRelations, attachments: mappedAttachments,
          cloud_workspace_id: workspaceId, cloud_role: member.role, cloud_workspace_name: workspaceName
        });
        await App().persistNow();
        App().render();
      }
      user = (await client.auth.getUser()).data.user || user;
      subscribeRealtime();
      setStatus("Synced · " + workspaceName, "online");
      const pendingInvite = new URLSearchParams(location.search).get("invite") || localStorage.getItem("notenest.pending.invite");
      if (pendingInvite) {
        localStorage.removeItem("notenest.pending.invite");
        history.replaceState({}, "", location.pathname);
        setTimeout(() => joinInvite(pendingInvite), 0);
      }
    } catch (error) {
      setStatus("Sync needs attention", "offline");
      throw error;
    } finally {
      loadingRemote = false;
    }
    renderCloudPanel();
  }

  function toIso(value) {
    if (!value) return new Date().toISOString();
    const d = typeof value === "number" ? new Date(value) : new Date(value);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  async function syncWorkspace(force) {
    if (!isConnected() || syncing || (loadingRemote && !force)) return;
    syncing = true;
    setStatus("Syncing…", "busy");
    try {
      const data = workspace();
      const pageRows = (data.pages || []).map((p) => ({
        id:p.id, workspace_id:workspaceId, parent_id:p.parentId || null, title:p.title || "Untitled",
        icon:p.icon || "📄", blocks:p.blocks || [], tags:p.tags || [], favorite:!!p.favorite, trashed:!!p.trashed,
        created_by:p.createdBy || user.id, updated_by:user.id, created_at:toIso(p.createdAt), updated_at:toIso(p.updatedAt)
      }));
      for (let i=0;i<pageRows.length;i+=100) {
        const r = await client.from("pages").upsert(pageRows.slice(i,i+100), { onConflict:"id" });
        if (r.error) throw r.error;
      }
      const dbRows = (data.databases || []).map((d) => ({
        id:d.id, workspace_id:workspaceId, title:d.title || "Untitled database", icon:d.icon || "▦",
        fields:d.fields || [], view_type:d.view || "table", created_by:user.id,
        created_at:toIso(d.createdAt), updated_at:toIso(d.updatedAt)
      }));
      if (dbRows.length) { const r=await client.from("workspace_databases").upsert(dbRows,{onConflict:"id"}); if(r.error)throw r.error; }
      const entryRows = (data.databases || []).flatMap((d) => (d.entries || []).map((e,index) => ({
        id:e.id, database_id:d.id, workspace_id:workspaceId, title:e.title || "Untitled", status:e.status || "Not started",
        due_date:e.due_date || null, description:e.description || "", cover_url:e.cover_url || null, data:e.data || {},
        position:e.position == null ? index : e.position, created_by:e.createdBy || user.id,
        created_at:toIso(e.createdAt), updated_at:toIso(e.updatedAt)
      })));
      if (entryRows.length) { const r=await client.from("database_entries").upsert(entryRows,{onConflict:"id"}); if(r.error)throw r.error; }
      const relationRows = (data.relations || []).map((r) => ({
        id:r.id, workspace_id:workspaceId, source_page_id:r.sourcePageId, target_page_id:r.targetPageId,
        relation_type:r.relationType || "related", created_by:r.createdBy || user.id
      }));
      if (relationRows.length) { const r=await client.from("page_relations").upsert(relationRows,{onConflict:"source_page_id,target_page_id"}); if(r.error)throw r.error; }
      const label=$("save-label"); if(label)label.textContent="Cloud synced";
      setStatus("Synced · " + new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}), "online");
    } catch (error) {
      setStatus("Offline / sync error", "offline");
      console.error("NoteNest cloud sync failed",error);
      notify("Cloud sync failed: " + errorMessage(error));
    } finally { syncing=false; }
  }
  function queueSync() {
    if (!isConnected() || loadingRemote) return;
    clearTimeout(syncTimer);
    syncTimer=setTimeout(syncWorkspace,900);
  }
  async function syncNow() { clearTimeout(syncTimer); await syncWorkspace(); }

  function subscribeRealtime() {
    if (!client || !workspaceId) return;
    if (channel) client.removeChannel(channel);
    channel=client.channel("notenest-workspace-"+workspaceId)
      .on("postgres_changes",{event:"*",schema:"public",table:"pages",filter:"workspace_id=eq."+workspaceId},handleRemotePage)
      .on("postgres_changes",{event:"*",schema:"public",table:"database_entries",filter:"workspace_id=eq."+workspaceId},handleRemoteEntry)
      .on("postgres_changes",{event:"*",schema:"public",table:"workspace_databases",filter:"workspace_id=eq."+workspaceId},handleRemoteDatabase)
      .on("postgres_changes",{event:"*",schema:"public",table:"page_relations",filter:"workspace_id=eq."+workspaceId},handleRemoteRelation)
      .on("postgres_changes",{event:"*",schema:"public",table:"attachments",filter:"workspace_id=eq."+workspaceId},handleRemoteAttachment)
      .subscribe((status)=>{ if(status==="SUBSCRIBED")setStatus("Live · "+workspaceName,"online"); });
  }
  function handleRemotePage(payload) {
    if (loadingRemote || syncing) return;
    const row=payload.new || payload.old;
    if (!row || !row.id) return;
    const data=workspace();
    const index=(data.pages||[]).findIndex(p=>p.id===row.id);
    if (payload.eventType==="DELETE") {
      if(index>=0)data.pages.splice(index,1);
    } else {
      const mapped={id:row.id,parentId:row.parent_id,title:row.title,icon:row.icon,blocks:row.blocks||[],tags:row.tags||[],favorite:!!row.favorite,trashed:!!row.trashed,createdAt:new Date(row.created_at).getTime(),updatedAt:new Date(row.updated_at).getTime(),createdBy:row.created_by,updatedBy:row.updated_by};
      if(index<0)data.pages.push(mapped);
      else if((mapped.updatedAt||0)>(data.pages[index].updatedAt||0)+1000)data.pages[index]=mapped;
      else return;
    }
    const editing = $("page-title") && document.activeElement && (document.activeElement.id==="page-title" || document.activeElement.dataset.blockText);
    if(editing){notify("A collaborator updated a page. Finish editing before refreshing it.");return}
    App().persistNow(); App().render();
  }
  function handleRemoteEntry(payload) {
    if (loadingRemote || syncing) return;
    const row=payload.new||payload.old;
    if(!row)return;
    const db=byDatabase(row.database_id);
    if(!db)return;
    if(payload.eventType==="DELETE"){
      db.entries=(db.entries||[]).filter(e=>e.id!==row.id);
      App().persistNow();
      if(document.querySelector(".database-heading"))App().render();
      return;
    }
    const mapped={id:row.id,title:row.title,status:row.status,due_date:row.due_date,description:row.description,cover_url:row.cover_url,data:row.data||{},position:row.position,createdAt:new Date(row.created_at).getTime(),updatedAt:new Date(row.updated_at).getTime()};
    const index=(db.entries||[]).findIndex(e=>e.id===row.id);
    if(index<0)db.entries.push(mapped);
    else if(mapped.updatedAt>(db.entries[index].updatedAt||0)+1000)db.entries[index]=mapped;
    else return;
    App().persistNow();
    if(document.querySelector(".database-heading"))App().render();
  }
  function handleRemoteDatabase(payload) {
    if(loadingRemote||syncing)return;
    const row=payload.new||payload.old;if(!row)return;
    const data=workspace(),index=(data.databases||[]).findIndex(d=>d.id===row.id);
    if(payload.eventType==="DELETE"){
      data.databases=(data.databases||[]).filter(d=>d.id!==row.id);
      if(activeDatabaseId===row.id)activeDatabaseId=null;
      App().persistNow();if(document.querySelector(".database-heading"))App().setView("databases");return;
    }
    const mapped={id:row.id,title:row.title,icon:row.icon,fields:row.fields||[],view:row.view_type||"table",entries:index>=0?data.databases[index].entries||[]:[],createdAt:new Date(row.created_at).getTime(),updatedAt:new Date(row.updated_at).getTime()};
    if(index<0)data.databases.push(mapped);else data.databases[index]=Object.assign(mapped,{entries:data.databases[index].entries||[]});
    App().persistNow();
    if(document.querySelector(".database-heading"))App().render();
  }

  function ensureDatabaseArrays() {
    const data=workspace();
    if(!Array.isArray(data.databases))data.databases=[];
    if(!Array.isArray(data.relations))data.relations=[];
    if(!Array.isArray(data.attachments))data.attachments=[];
  }
  function createDatabase() {
    if(isReadOnly()){notify("Viewer access is read-only.");return;}
    ensureDatabaseArrays();
    const title=prompt("Name your database","Project tracker");
    if(!title||!title.trim())return;
    const now=Date.now();
    const db={id:uid(),title:title.trim(),icon:"▦",view:"table",fields:["status","due_date","description","cover_url"],entries:[],createdAt:now,updatedAt:now};
    workspace().databases.push(db);
    activeDatabaseId=db.id;
    App().scheduleSave(); App().setView("database"); notify("Database created");
  }
  function renderDatabases(view) {
    ensureDatabaseArrays();
    if(view==="databases") {
      const list=workspace().databases;
      $("breadcrumbs").innerHTML="<span>My workspace</span><span class='crumb-sep'>/</span><strong>Databases</strong>";
      rootHTML('<div class="welcome"><p class="eyebrow">STRUCTURED INFORMATION</p><h1>Databases</h1><p>Keep projects, tasks, content plans and other structured information in flexible views.</p></div><div class="section-row"><div><h2 class="section-title">'+list.length+' databases</h2><p class="section-sub">One collection, different ways to see the work.</p></div>'+(isReadOnly()?"":'<button class="primary-button" data-action="create-database">＋ New database</button>')+'</div>'+(list.length?'<div class="page-grid">'+list.map(d=>'<button class="page-card" data-action="open-database" data-id="'+esc(d.id)+'"><div class="page-card-top"><span class="page-emoji">'+esc(d.icon||"▦")+'</span><span class="page-card-meta">'+(d.entries||[]).length+' records</span></div><h3>'+esc(d.title)+'</h3><p>Table · Board · Calendar · Gallery</p><div class="page-card-meta">Updated '+new Date(d.updatedAt||Date.now()).toLocaleDateString()+'</div></button>').join("")+'</div>':emptyMarkupLocal("Create your first database","Use a table to track projects, tasks, content or anything with repeatable fields.","Create database","create-database")));
      return;
    }
    const database=byDatabase(activeDatabaseId);
    if(!database){App().setView("databases");return}
    const viewType=database.view||"table",entries=database.entries||[];
    $("breadcrumbs").innerHTML="<span>My workspace</span><span class='crumb-sep'>/</span><span>Databases</span><span class='crumb-sep'>/</span><strong>"+esc(database.title)+"</strong>";
    const tabs=["table","board","calendar","gallery"];
    const actions='<div class="page-toolbar"><div class="page-toolbar-left"><button class="subtle-button" data-action="back-databases">← Databases</button></div><div class="page-toolbar-right"><button class="subtle-button" data-action="rename-database">Rename</button><button class="subtle-button danger" data-action="delete-database" data-id="'+esc(database.id)+'">Delete</button><button class="subtle-button" data-action="add-entry">＋ New record</button></div></div>';
    const viewTabs='<div class="database-tabs">'+tabs.map(t=>'<button class="database-tab '+(viewType===t?"active":"")+'" data-action="set-db-view" data-view-type="'+t+'">'+t[0].toUpperCase()+t.slice(1)+'</button>').join("")+'</div>';
    let body="";
    if(viewType==="table") {
      body='<div class="database-table-wrap"><table class="database-table"><thead><tr><th>Name</th><th>Status</th><th>Due date</th><th>Description</th><th></th></tr></thead><tbody>'+(entries.length?entries.map(e=>'<tr><td><button class="entry-title" data-action="edit-entry" data-id="'+esc(e.id)+'">'+esc(e.title||"Untitled")+'</button></td><td><span class="status-pill">'+esc(e.status||"Not started")+'</span></td><td>'+esc(e.due_date||"—")+'</td><td>'+esc(e.description||"")+'</td><td><button class="row-icon" data-action="delete-entry" data-id="'+esc(e.id)+'" title="Delete record">×</button></td></tr>').join(""):'<tr><td colspan="5" class="table-empty">No records yet. Add your first record.</td></tr>')+'</tbody></table></div>';
    } else if(viewType==="board") {
      const statuses=["Not started","In progress","Done"];
      body='<div class="kanban-board">'+statuses.map(status=>'<section class="kanban-column"><div class="kanban-column-head"><strong>'+status+'</strong><span>'+entries.filter(e=>(e.status||"Not started")===status).length+'</span></div>'+entries.filter(e=>(e.status||"Not started")===status).map(e=>'<button class="kanban-card" data-action="edit-entry" data-id="'+esc(e.id)+'"><strong>'+esc(e.title)+'</strong><small>'+esc(e.due_date||"No due date")+'</small><p>'+esc(e.description||"")+'</p></button>').join("")+'<button class="add-block-button" data-action="add-entry">＋ Add record</button></section>').join("")+'</div>';
    } else if(viewType==="calendar") {
      const today=new Date(),year=today.getFullYear(),month=today.getMonth(),first=new Date(year,month,1),days=new Date(year,month+1,0).getDate(),offset=first.getDay();
      const cells=Array.from({length:offset},()=>'<div class="calendar-cell muted"></div>');
      for(let d=1;d<=days;d++){
        const iso=year+"-"+String(month+1).padStart(2,"0")+"-"+String(d).padStart(2,"0");
        const items=entries.filter(e=>e.due_date===iso);
        cells.push('<div class="calendar-cell"><span class="calendar-day">'+d+'</span>'+items.map(e=>'<button class="calendar-entry" data-action="edit-entry" data-id="'+esc(e.id)+'">'+esc(e.title)+'</button>').join("")+'</div>');
      }
      body='<div class="calendar-title">'+today.toLocaleDateString(undefined,{month:"long",year:"numeric"})+'</div><div class="calendar-grid">'+["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=>'<div class="calendar-weekday">'+d+'</div>').join("")+cells.join("")+'</div><p class="cloud-footnote">Calendar uses the current month. Add a due date to a record to place it here.</p>';
    } else {
      body='<div class="page-grid database-gallery">'+(entries.length?entries.map(e=>'<button class="page-card gallery-card" data-action="edit-entry" data-id="'+esc(e.id)+'">'+(e.cover_url?'<img src="'+esc(e.cover_url)+'" alt="" loading="lazy">':'<div class="gallery-placeholder">▧</div>')+'<h3>'+esc(e.title)+'</h3><span class="status-pill">'+esc(e.status||"Not started")+'</span><p>'+esc(e.description||"")+'</p><div class="page-card-meta">'+esc(e.due_date||"No due date")+'</div></button>').join(""):'<div class="section-sub">No records yet.</div>')+'</div>';
    }
    rootHTML(actions+'<div class="database-heading"><p class="eyebrow">DATABASE</p><h1>'+esc(database.icon||"▦")+' '+esc(database.title)+'</h1><p class="section-sub">'+entries.length+' records · Updates sync when connected</p></div>'+viewTabs+body);
  }
  function rootHTML(html){const host=document.getElementById("view");if(host)host.innerHTML=html}
  function emptyMarkupLocal(title,description,label,action){return '<div class="empty-state"><div class="empty-art">▦</div><h2>'+esc(title)+'</h2><p>'+esc(description)+'</p>'+(label?'<button class="primary-button" data-action="'+action+'">'+esc(label)+'</button>':"")+'</div>'}

  function showModal(title,kicker,html) {
    $("modal-title").textContent=title;
    $("modal-kicker").textContent=kicker||"WORKSPACE";
    $("modal-content").innerHTML=html;
    $("modal-backdrop").hidden=false;
  }
  function closeModal(){ $("modal-backdrop").hidden=true; }
  function renderPageExtras(page) {
    const host=$("page-extras");
    if(!host)return;
    ensureDatabaseArrays();
    const links=workspace().relations.filter(r=>r.sourcePageId===page.id);
    const backlinks=workspace().relations.filter(r=>r.targetPageId===page.id);
    const files=workspace().attachments.filter(a=>a.pageId===page.id);
    host.innerHTML='<div class="extras-grid"><section class="extras-card"><div class="extras-head"><h3>Linked pages</h3><button class="text-button" data-action="open-relations">＋ Link page</button></div>'+(links.length?links.map(r=>{const target=byPage(r.targetPageId);return target?'<button class="relation-link" data-page="'+esc(target.id)+'">'+esc(target.icon||"📄")+' '+esc(target.title)+'</button>':""}).join(""):'<p class="cloud-footnote">No outgoing links yet.</p>')+(backlinks.length?'<div class="extras-subhead">Backlinks</div>'+backlinks.map(r=>{const source=byPage(r.sourcePageId);return source?'<button class="relation-link" data-page="'+esc(source.id)+'">'+esc(source.icon||"📄")+' '+esc(source.title)+'</button>':""}).join(""):"")+'</section><section class="extras-card"><div class="extras-head"><h3>Files & attachments</h3><button class="text-button" data-action="open-attachments">＋ Add files</button></div>'+(files.length?files.map(a=>'<div class="attachment-row"><span>'+(a.mimeType&&a.mimeType.startsWith("image/")?"▧":"📎")+'</span><span class="attachment-name">'+esc(a.fileName)+'</span><button class="row-icon" data-action="delete-attachment" data-id="'+esc(a.id)+'" title="Remove file">×</button></div>').join(""):'<p class="cloud-footnote">No files attached to this page.</p>')+'</section></div>';
  }

  async function openRelations() {
    const page=App().currentPage();
    if(!page)return;
    const options=pages().filter(p=>p.id!==page.id).map(p=>'<option value="'+esc(p.id)+'">'+esc((p.icon||"📄")+" "+(p.title||"Untitled"))+'</option>').join("");
    if(!options){notify("Create another page before linking it.");return}
    showModal("Link another page","PAGE RELATIONS",'<p class="section-sub">Create a link from this page to another page in your workspace. The target page will show a backlink.</p><label class="cloud-label" for="relation-target">Choose a page</label><select class="cloud-input" id="relation-target">'+options+'</select><label class="cloud-label" for="relation-kind">Relationship</label><select class="cloud-input" id="relation-kind"><option value="related">Related</option><option value="source">Source</option><option value="follow-up">Follow-up</option><option value="project">Project</option></select><div class="settings-actions"><button class="primary-button" data-action="save-relation">Create link</button></div>');
  }
  function saveRelation() {
    const page=App().currentPage(),target=$("relation-target")?.value;
    if(!page||!target||target===page.id)return;
    ensureDatabaseArrays();
    if(workspace().relations.some(r=>r.sourcePageId===page.id&&r.targetPageId===target)){notify("These pages are already linked.");return}
    workspace().relations.push({id:uid(),sourcePageId:page.id,targetPageId:target,relationType:$("relation-kind").value||"related"});
    closeModal();App().scheduleSave();renderPageExtras(page);notify("Page link created");
  }
  async function openVersions() {
    const page=App().currentPage();
    if(!page)return;
    if(!isConnected()){notify("Version history is available after connecting a cloud workspace.");return}
    const result=await client.from("page_versions").select("id,snapshot,created_at,created_by").eq("page_id",page.id).order("created_at",{ascending:false}).limit(25);
    if(result.error){notify(errorMessage(result.error));return}
    const versions=result.data||[];
    showModal("Version history","PAGE HISTORY",versions.length?'<p class="section-sub">Snapshots are captured when the page content changes. Restoring a snapshot creates a new saved version.</p><div class="version-list">'+versions.map(v=>'<div class="version-row"><div><strong>'+esc(v.snapshot.title||"Untitled")+'</strong><small>'+esc(fullDate(v.created_at))+'</small></div><button class="secondary-button" data-action="restore-version" data-id="'+esc(v.id)+'">Restore</button></div>').join("")+'</div>':'<div class="empty-state"><h2>No earlier versions</h2><p>After you edit and save this page, earlier content snapshots will appear here.</p></div>');
    window.__NoteNestVersions=versions;
  }
  function fullDate(v){return new Date(v).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"})}
  async function restoreVersion(id) {
    const page=App().currentPage(),version=(window.__NoteNestVersions||[]).find(v=>v.id===id);
    if(!page||!version)return;
    if(!confirm("Restore this earlier version? Your current page will be saved as a version first."))return;
    page.title=version.snapshot.title||"Untitled";page.icon=version.snapshot.icon||"📄";
    page.blocks=version.snapshot.blocks||[];page.tags=version.snapshot.tags||[];page.updatedAt=Date.now();
    closeModal();App().scheduleSave();App().render();notify("Previous version restored");
  }
  async function uploadAttachments(files) {
    const page=App().currentPage();
    if(!page||!files.length)return;
    if(!isConnected()){notify("Connect and sign in to upload cloud attachments.");return}
    for(const file of files){
      if(file.size>MAX_FILE_SIZE){notify(file.name+" is larger than the 25 MB limit.");continue}
      const safeName=file.name.replace(/[^a-zA-Z0-9._-]+/g,"_").slice(-120);
      const path=workspaceId+"/"+page.id+"/"+uid()+"-"+safeName;
      const uploaded=await client.storage.from(BUCKET).upload(path,file,{upsert:false,contentType:file.type||"application/octet-stream"});
      if(uploaded.error){notify("Upload failed: "+errorMessage(uploaded.error));continue}
      const row={workspace_id:workspaceId,page_id:page.id,storage_path:path,file_name:file.name,mime_type:file.type||"application/octet-stream",size_bytes:file.size,created_by:user.id};
      const saved=await client.from("attachments").insert(row).select("*").single();
      if(saved.error){await client.storage.from(BUCKET).remove([path]);notify("Could not save attachment: "+errorMessage(saved.error));continue}
      workspace().attachments.push({id:saved.data.id,pageId:page.id,storagePath:path,fileName:file.name,mimeType:file.type,sizeBytes:file.size,createdAt:Date.now()});
    }
    App().scheduleSave();renderPageExtras(page);notify("Attachment upload finished");
  }
  async function openAttachments() {
    const page=App().currentPage();
    if(!page)return;
    if(!isConnected()){notify("Connect a cloud workspace to upload files.");return}
    const files=workspace().attachments.filter(a=>a.pageId===page.id);
    const links=await Promise.all(files.map(async a=>{
      const result=await client.storage.from(BUCKET).createSignedUrl(a.storagePath,3600);
      const url=result.data&&result.data.signedUrl;
      return '<div class="attachment-row"><span>'+(a.mimeType&&a.mimeType.startsWith("image/")?"▧":"📎")+'</span><a class="attachment-name" href="'+esc(url||"#")+'" target="_blank" rel="noopener noreferrer">'+esc(a.fileName)+'</a><button class="row-icon" data-action="delete-attachment" data-id="'+esc(a.id)+'" title="Remove file">×</button></div>';
    }));
    showModal("Files & attachments","PAGE FILES",'<p class="section-sub">Private files are stored in your Supabase Storage bucket and access is checked against workspace membership.</p>'+(isReadOnly()?"":'<div class="settings-actions"><button class="primary-button" data-action="choose-attachments">＋ Upload files</button></div>')+'<div class="attachment-list">'+(links.length?links.join(""):'<p class="cloud-footnote">No files attached to this page yet.</p>')+'</div><p class="cloud-footnote">Maximum file size: 25 MB. Shareable signed links expire after one hour.</p>');
  }
  async function deleteAttachment(id) {
    const item=workspace().attachments.find(a=>a.id===id);
    if(!item||!isConnected())return;
    if(!confirm("Remove "+item.fileName+" from this page?"))return;
    const storage=await client.storage.from(BUCKET).remove([item.storagePath]);
    if(storage.error){notify(errorMessage(storage.error));return}
    const deleted=await client.from("attachments").delete().eq("id",id);
    if(deleted.error){notify(errorMessage(deleted.error));return}
    workspace().attachments=workspace().attachments.filter(a=>a.id!==id);
    App().scheduleSave();const page=App().currentPage();if(page)renderPageExtras(page);
    if(!$("modal-backdrop").hidden)openAttachments();
    notify("Attachment removed");
  }

  async function loadMembers() {
    if(!isConnected()||!$("workspace-members"))return;
    const result=await client.from("workspace_members").select("user_id,role,created_at").eq("workspace_id",workspaceId).order("created_at");
    const host=$("workspace-members");if(!host)return;
    if(result.error){host.innerHTML='<p class="cloud-footnote">'+esc(errorMessage(result.error))+'</p>';return}
    host.innerHTML='<div class="member-list">'+(result.data||[]).map(m=>'<div class="member-row"><span class="member-avatar">'+esc(m.role.slice(0,1).toUpperCase())+'</span><span><strong>'+(m.user_id===user.id?"You":"Workspace member")+'</strong><small>'+esc(m.user_id)+'</small></span><em>'+esc(m.role)+'</em></div>').join("")+'</div>';
  }
  async function createInvite() {
    if(!isConnected())return;
    const role=$("invite-role")?.value||"editor";
    const result=await client.rpc("create_workspace_invite",{p_workspace_id:workspaceId,p_role:role,p_expires_hours:168,p_uses:5});
    if(result.error){notify(errorMessage(result.error));return}
    const code=result.data;
    const url=location.origin+location.pathname+"?invite="+encodeURIComponent(code);
    lastInviteUrl=url;
    $("invite-result").innerHTML='<div class="invite-result"><input class="cloud-input" readonly value="'+esc(url)+'"><button class="secondary-button" data-action="copy-invite">Copy link</button><small>Valid for 7 days · up to 5 uses · role: '+esc(role)+'</small></div>';
    notify("Invitation link created");
  }
  async function joinInvite(code) {
    if(!isConnected()){localStorage.setItem("notenest.pending.invite",code);notify("Sign in, then accept the invitation.");return}
    const result=await client.rpc("join_workspace_with_invite",{p_code:code});
    if(result.error){notify("Could not join workspace: "+errorMessage(result.error));return}
    workspaceId=result.data;localStorage.setItem(WORKSPACE_KEY,workspaceId);
    await loadCloudWorkspace();notify("Joined the shared workspace");
  }

  function renderDatabaseEntryForm(entry) {
    if(isReadOnly()){notify("Viewer access is read-only.");return;}
    const isEdit=!!entry;
    const data=entry||{title:"",status:"Not started",due_date:"",description:"",cover_url:""};
    showModal(isEdit?"Edit record":"New record","DATABASE ITEM",'<form id="entry-form"><label class="cloud-label" for="entry-title">Name</label><input class="cloud-input" id="entry-title" maxlength="160" required value="'+esc(data.title)+'"><label class="cloud-label" for="entry-status">Status</label><select class="cloud-input" id="entry-status"><option'+(data.status==="Not started"?" selected":"")+'>Not started</option><option'+(data.status==="In progress"?" selected":"")+'>In progress</option><option'+(data.status==="Done"?" selected":"")+'>Done</option></select><label class="cloud-label" for="entry-date">Due date</label><input class="cloud-input" id="entry-date" type="date" value="'+esc(data.due_date||"")+'"><label class="cloud-label" for="entry-description">Description</label><textarea class="cloud-input" id="entry-description" rows="3">'+esc(data.description||"")+'</textarea><label class="cloud-label" for="entry-cover">Cover image URL (optional)</label><input class="cloud-input" id="entry-cover" type="url" value="'+esc(data.cover_url||"")+'" placeholder="https://..."><div class="settings-actions"><button class="primary-button" type="submit">Save record</button>'+(isEdit?'<button class="secondary-button" type="button" data-action="delete-entry" data-id="'+esc(data.id)+'">Delete</button>':'')+'</div></form>');
    const form=$("entry-form");
    form.addEventListener("submit",function(event){
      event.preventDefault();
      const db=byDatabase(activeDatabaseId);if(!db)return;
      const now=Date.now(),id=data.id||uid(),entryData={id,title:$("entry-title").value.trim()||"Untitled",status:$("entry-status").value,due_date:$("entry-date").value||null,description:$("entry-description").value.trim(),cover_url:$("entry-cover").value.trim()||null,createdAt:data.createdAt||now,updatedAt:now};
      const index=(db.entries||[]).findIndex(e=>e.id===id);
      if(index>=0)db.entries[index]=entryData;else db.entries.push(entryData);
      db.updatedAt=now;closeModal();App().scheduleSave();renderDatabases("database");notify("Record saved");
    });
  }
  async function deleteEntry(id) {
    if(isReadOnly()){notify("Viewer access is read-only.");return;}
    const db=byDatabase(activeDatabaseId);if(!db)return;
    if(!confirm("Delete this database record?"))return;
    db.entries=(db.entries||[]).filter(e=>e.id!==id);
    if(isConnected()){const result=await client.from("database_entries").delete().eq("id",id);if(result.error)notify(errorMessage(result.error))}
    App().scheduleSave();renderDatabases("database");notify("Record deleted");
  }
  function renameDatabase() {
    if(isReadOnly()){notify("Viewer access is read-only.");return;}
    const db=byDatabase(activeDatabaseId);if(!db)return;
    const title=prompt("Rename database",db.title);
    if(title&&title.trim()){db.title=title.trim();db.updatedAt=Date.now();App().scheduleSave();renderDatabases("database")}
  }
  async function removeDatabase(id) {
    if(isReadOnly()){notify("Viewer access is read-only.");return;}
    const db=byDatabase(id);if(!db)return;
    if(!confirm("Delete this database and all its records?"))return;
    workspace().databases=workspace().databases.filter(d=>d.id!==id);
    if(isConnected()){const result=await client.from("workspace_databases").delete().eq("id",id);if(result.error)notify(errorMessage(result.error))}
    activeDatabaseId=null;App().scheduleSave();renderDatabases("databases");
  }

  function rememberSelection(event) {
    const area=event.target && event.target.closest && event.target.closest("[data-block-text]");
    if(!area)return;
    lastSelection={id:area.dataset.blockText,start:area.selectionStart,end:area.selectionEnd};
  }
  document.addEventListener("keyup",rememberSelection);
  document.addEventListener("mouseup",rememberSelection);
  document.addEventListener("select",rememberSelection,true);
  function applyFormat(kind) {
    const page=App().currentPage();
    if(!page||!lastSelection){notify("Select text in a paragraph block first.");return}
    const block=page.blocks.find(b=>b.id===lastSelection.id);
    if(!block||block.type==="divider"){notify("Select text in an editable block.");return}
    let prefix="",suffix="";
    if(kind==="bold"){prefix="**";suffix="**"}
    else if(kind==="italic"){prefix="_";suffix="_"}
    else if(kind==="strike"){prefix="~~";suffix="~~"}
    else if(kind==="code"){prefix=String.fromCharCode(96);suffix=String.fromCharCode(96)}
    else if(kind==="link"){const url=prompt("Enter the link URL","https://");if(!url)return;prefix="[";suffix="]("+url.replace(/[)]/g,"%29")+")"}
    const value=block.text||"",start=Math.max(0,Math.min(value.length,lastSelection.start)),end=Math.max(start,Math.min(value.length,lastSelection.end));
    const selected=value.slice(start,end);
    block.text=value.slice(0,start)+prefix+selected+suffix+value.slice(end);
    const cursor=start+prefix.length+selected.length+suffix.length;
    App().scheduleSave();App().render();
    setTimeout(()=>{const area=document.querySelector('[data-block-text="'+block.id+'"]');if(area){area.focus();area.setSelectionRange(cursor,cursor);lastSelection={id:block.id,start:cursor,end:cursor}}},0);
  }

  document.addEventListener("click",async function(event){
    const formatButton=event.target.closest("[data-format]");if(formatButton){applyFormat(formatButton.dataset.format);return;}
    const action=event.target.closest("[data-action]");
    if(!action)return;
    switch(action.dataset.action){
      case "cloud-connect": saveConfig(); break;
      case "cloud-disconnect": localStorage.removeItem(CONFIG_KEY);localStorage.setItem("notenest.cloud.disabled","1");if(client&&channel)client.removeChannel(channel);client=null;user=null;workspaceId=null;renderCloudPanel();notify("Cloud connection paused on this browser");break;
      case "cloud-signin": await authenticate("signin");break;
      case "cloud-signup": await authenticate("signup");break;
      case "cloud-signout": if(client){await client.auth.signOut();user=null;workspaceId=null;renderCloudPanel();}break;
      case "cloud-sync-now": await syncNow();break;
      case "cloud-create-invite": await createInvite();break;
      case "copy-invite": if(lastInviteUrl){await navigator.clipboard.writeText(lastInviteUrl);notify("Invitation link copied")}break;
      case "cloud-join-invite": {const code=($("invite-code")?.value||"").trim()||new URLSearchParams(location.search).get("invite");if(code)await joinInvite(code);else notify("Paste an invitation code first.");break}
      case "create-database": createDatabase();break;
      case "open-database": activeDatabaseId=action.dataset.id;App().setView("database");break;
      case "back-databases": activeDatabaseId=null;App().setView("databases");break;
      case "set-db-view": {const db=byDatabase(activeDatabaseId);if(db){db.view=action.dataset.viewType;db.updatedAt=Date.now();App().scheduleSave();renderDatabases("database")}break}
      case "add-entry": renderDatabaseEntryForm(null);break;
      case "edit-entry": {const db=byDatabase(activeDatabaseId),entry=db&&(db.entries||[]).find(e=>e.id===action.dataset.id);if(entry)renderDatabaseEntryForm(entry);break}
      case "delete-entry": await deleteEntry(action.dataset.id);break;
      case "rename-database": renameDatabase();break;
      case "delete-database": await removeDatabase(action.dataset.id);break;
      case "open-relations": openRelations();break;
      case "save-relation": saveRelation();break;
      case "open-versions": await openVersions();break;
      case "restore-version": await restoreVersion(action.dataset.id);break;
      case "open-attachments": await openAttachments();break;
      case "choose-attachments": closeModal();$("attachment-input")?.click();break;
      case "delete-attachment": await deleteAttachment(action.dataset.id);break;
    }
  });
  document.addEventListener("change",function(event){
    if(event.target.id==="attachment-input"){
      const files=Array.from(event.target.files||[]);
      uploadAttachments(files);event.target.value="";
    }
  });
  document.addEventListener("click",function(event){
    if(event.target.closest('[data-action="open-settings"]'))setTimeout(renderCloudPanel,0);
  });

  let draggedBlockId=null;
  const editorRoot=document.getElementById("view");
  editorRoot.addEventListener("dragstart",function(event){
    const handle=event.target.closest(".block-grip");
    const row=handle&&handle.closest("[data-block-row]");
    if(!row){event.preventDefault();return;}
    draggedBlockId=row.dataset.blockRow;
    if(event.dataTransfer){event.dataTransfer.effectAllowed="move";event.dataTransfer.setData("text/plain",draggedBlockId);}
    row.classList.add("dragging");
  });
  editorRoot.addEventListener("dragend",function(event){
    const row=event.target.closest("[data-block-row]");
    if(row)row.classList.remove("dragging");
    draggedBlockId=null;
  });
  editorRoot.addEventListener("dragover",function(event){if(event.target.closest("[data-block-row]"))event.preventDefault()});
  editorRoot.addEventListener("drop",function(event){
    const target=event.target.closest("[data-block-row]"),page=App().currentPage();
    if(!target||!page)return;
    event.preventDefault();
    const sourceId=draggedBlockId||(event.dataTransfer&&event.dataTransfer.getData("text/plain"));
    const from=page.blocks.findIndex(b=>b.id===sourceId),to=page.blocks.findIndex(b=>b.id===target.dataset.blockRow);
    if(from<0||to<0||from===to)return;
    const moved=page.blocks.splice(from,1)[0];page.blocks.splice(to,0,moved);
    page.updatedAt=Date.now();App().scheduleSave();App().render();notify("Block moved");
  });

  const api = {
    queueSync: queueSync,
    renderDatabases: renderDatabases,
    renderPageExtras: renderPageExtras,
    openSettings: renderCloudPanel,
    isConnected: isConnected,
    isReadOnly: function(){ return isConnected() && workspace().cloud_role === "viewer"; }
  };
  window.NoteNestCloud=api;

  const inviteFromUrl=new URLSearchParams(location.search).get("invite");
  if(inviteFromUrl)localStorage.setItem("notenest.pending.invite",inviteFromUrl);
  const cfg=config();
  if(cfg){
    Promise.resolve(App().ready).then(()=>initializeClient(false)).catch((error)=>{setStatus("Sync error","offline");console.error(error)});
  } else {
    setTimeout(()=>{const label=$("cloud-state");if(label)label.textContent="Not configured";},0);
  }
})();