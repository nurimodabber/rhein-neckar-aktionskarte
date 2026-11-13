// Konten & geteilte Karten: Anmeldung über Clerk, Speicherung über /api/maps.
// Personendaten (Art. 9 DSGVO) leben nur im Arbeitsspeicher und auf dem Server, nie in localStorage/IndexedDB:
// solange AppState.remote gesetzt ist, schreibt saveState() nichts lokal (Sperren in app.js).

const MAX_PEOPLE = 500;
const MAP_ID_RE = /^[A-Za-z0-9_-]{22}$/;
const LAST_MAP_KEY = 'rn_last_map_v1';

function sanitizePeople(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const p of list) {
    if (out.length >= MAX_PEOPLE) break;
    if (!p || typeof p !== 'object') continue;
    const name = String(p.name || '').trim().slice(0, 100);
    if (!name) continue;
    out.push({ name, note: String(p.note || '').slice(0, 500), believer: p.believer === true });
  }
  return out;
}

// Drei-Wege-Abgleich bei gleichzeitigem Speichern: pro Ort gewinnt, wer ihn geändert hat.
// Haben beide denselben Ort geändert, gilt die eigene Version und `lost` zählt die überschriebenen Orte.
function mergeMaps(base, mine, theirs) {
  const out = { towns: {}, districts: {}, deployments: theirs.deployments || [] };
  let lost = 0;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  for (const k of ['towns', 'districts']) {
    const ids = new Set([...Object.keys(mine[k] || {}), ...Object.keys(theirs[k] || {})]);
    for (const id of ids) {
      const b = (base[k] || {})[id], m = (mine[k] || {})[id], t = (theirs[k] || {})[id];
      if (same(m, b) || same(m, t)) { if (t !== undefined) out[k][id] = t; }
      else { out[k][id] = m; if (!same(t, b)) lost++; }
    }
  }
  if (!same(mine.deployments, base.deployments) && !same(mine.deployments, theirs.deployments)) {
    if (!same(theirs.deployments, base.deployments)) lost++;
    out.deployments = mine.deployments;
  }
  return { data: out, lost };
}

if (typeof module === 'object' && module.exports) module.exports = { sanitizePeople, mergeMaps };

const Accounts = (() => {
  if (typeof window === 'undefined') return null;

  let cfg = null;              // { publishableKey, ready }
  let clerk = null;
  let maps = [];               // Kartenliste des angemeldeten Kontos
  let base = null;             // letzter Serverstand der offenen Karte (JSON), Basis für Abgleich und Rücksetzen
  let pending = false, saving = false, saveTimer = null, lastReadOnlyAlert = 0;
  let wantedMapId = null;      // #map=… vor der Anmeldung
  let status = '';
  let notice = '';             // Hinweis oben im Dialog, z. B. warum er sich geöffnet hat

  const dialog = () => document.getElementById('accounts-dialog');
  const body = () => document.getElementById('accounts-body');
  const remote = () => AppState.remote;
  const canEdit = () => !!remote() && (remote().role === 'owner' || remote().role === 'edit');
  const currentData = () => ({ towns: AppState.towns, districts: AppState.districts, deployments: AppState.deployments });
  // Die lokale Karte ist nur bearbeitbar, solange der Server ausdrücklich keine Konten anbietet.
  // Unbekannt (offline, Fehler) zählt als „Konten vorhanden“, damit nichts ohne Konto entsteht.
  const localEditAllowed = () => !!cfg && cfg.ready === false;
  const editable = () => (remote() ? canEdit() : localEditAllowed());

  async function loadConfig() {
    if (cfg) return cfg;
    try {
      const r = await fetch('/api/maps?config=1', { cache: 'no-store' });
      if (r.ok) cfg = await r.json();
    } catch (e) { /* offline: später erneut */ }
    return cfg;
  }

  async function loadClerk() {
    if (clerk) return clerk;
    const c = await loadConfig();
    const pk = c && c.ready && c.publishableKey;
    if (!pk) return null;
    const domain = atob(pk.split('_').slice(2).join('_')).replace(/\$$/, '');
    if (!/^[a-z0-9.-]+$/i.test(domain)) return null;
    const inject = (id, src, attrs = {}) => new Promise((resolve, reject) => {
      if (document.getElementById(id)) return resolve();
      const s = document.createElement('script');
      s.id = id; s.src = src; s.crossOrigin = 'anonymous'; s.async = true;
      for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
      s.onload = resolve; s.onerror = () => reject(new Error('Clerk konnte nicht geladen werden'));
      document.head.appendChild(s);
    });
    try {
      await inject('clerk-ui-sdk', `https://${domain}/npm/@clerk/ui@1/dist/ui.browser.js`);
      await inject('clerk-js-sdk', `https://${domain}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': pk });
      for (let i = 0; i < 60 && !window.Clerk; i++) await new Promise(r => setTimeout(r, 50));
      let c2 = window.Clerk;
      if (!c2) return null;
      if (typeof c2 === 'function') c2 = new c2(pk);
      if (!c2.loaded) await c2.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
      clerk = c2;
      clerk.addListener(onAuthChange);
      return clerk;
    } catch (e) {
      console.warn('Clerk:', e.message);
      return null;
    }
  }

  const signedIn = () => !!(clerk && clerk.isSignedIn);
  const email = () => (clerk && clerk.user && clerk.user.primaryEmailAddress ? clerk.user.primaryEmailAddress.emailAddress : '');

  async function api(method, query, payload) {
    const headers = {};
    if (signedIn() && clerk.session) headers.Authorization = 'Bearer ' + await clerk.session.getToken();
    if (payload) headers['Content-Type'] = 'application/json';
    const r = await fetch('/api/maps' + query, { method, headers, body: payload ? JSON.stringify(payload) : undefined, cache: 'no-store' });
    const json = await r.json().catch(() => ({}));
    return { status: r.status, ok: r.ok, json };
  }

  let lastAuthUser = undefined;
  async function onAuthChange() {
    const uid = clerk && clerk.user ? clerk.user.id : null;
    if (uid === lastAuthUser) return;
    lastAuthUser = uid;
    setStatus(status);
    updateReadOnly();
    if (!uid) {
      maps = [];
      if (remote() && remote().role !== 'public') leaveToLocal(true);
    } else {
      await refreshList();
      if (wantedMapId) { const id = wantedMapId; wantedMapId = null; await openMap(id); }
    }
    render();
  }

  async function refreshList() {
    if (!signedIn()) { maps = []; return; }
    const r = await api('GET', '');
    if (r.ok) maps = r.json.maps || [];
  }

  // --- Kartendaten anwenden / verlassen ---
  function applyData(data) {
    loadStoredData(data);
    for (const k of ['towns', 'districts']) {
      for (const [id, u] of Object.entries((data && data[k]) || {})) {
        if (AppState[k][id] && u && u.people) AppState[k][id].people = sanitizePeople(u.people);
      }
    }
    base = JSON.stringify(currentData());
    refreshAll();
  }

  function refreshAll() {
    refreshAllStyles();
    refreshMarkers();
    renderArrows();
    updateClusterStats();
    if (AppState.selectedDistrictId) selectDistrict(AppState.selectedDistrictId, false);
    else if (AppState.selectedTownId) selectTown(AppState.selectedTownId, false);
    renderPeople();
  }

  function resetHistory() {
    AppState.undoStack = [];
    AppState.redoStack = [];
    updateUndoRedoButtons();
  }

  function enter(meta, data) {
    clearTimeout(saveTimer);
    pending = false;
    AppState.remote = meta;
    // Eine offene #share=-Vorschau gehört zur lokalen Karte
    document.getElementById('share-import-banner')?.classList.remove('visible');
    applyData(data);
    resetHistory();
    setStatus(meta.role === 'public' ? 'Öffentlich' : meta.role === 'view' ? 'Nur lesen' : 'Gespeichert');
    updateNotesHint();
  }

  function leaveToLocal(silent) {
    clearTimeout(saveTimer);
    pending = false;
    AppState.remote = null;
    base = null;
    applyData(null);
    base = null;
    resetHistory();
    setStatus('');
    updateNotesHint();
    try { localStorage.removeItem(LAST_MAP_KEY); } catch (e) { /* privat */ }
    if (/^#(map|public)=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    if (!silent) showInAppAlert(localEditAllowed() ? 'Lokale Karte (dieses Gerät) ist wieder aktiv.' : 'Du siehst wieder die lokale Karte (nur Ansicht).', 'info');
  }

  // Vor dem Wechsel: offene Änderungen sichern; schlägt das fehl, bleibt die Karte offen.
  async function settle() {
    if (!remote()) return true;
    clearTimeout(saveTimer);
    while (saving) await new Promise(r => setTimeout(r, 100));
    if (pending) await flush();
    if (pending) { showInAppAlert('Änderungen sind noch nicht gespeichert. Bitte Verbindung prüfen.', 'warning'); return false; }
    return true;
  }

  async function openMap(id) {
    if (!MAP_ID_RE.test(id)) return;
    if (!(await settle())) return;
    if (!signedIn()) { wantedMapId = id; openDialog(); return; }
    const r = await api('GET', `?id=${id}`);
    if (!r.ok) { showInAppAlert(r.json.error || 'Karte konnte nicht geladen werden.', 'warning'); return; }
    const j = r.json;
    enter({ id, rev: j.rev, role: j.role, name: j.name, invites: j.invites || {}, public: j.public === true }, j.data);
    history.replaceState(null, '', '#map=' + id);
    try { localStorage.setItem(LAST_MAP_KEY, id); } catch (e) { /* privat */ }
    render();
  }

  async function openPublic(id) {
    if (!MAP_ID_RE.test(id)) return;
    if (!(await settle())) return;
    try {
      const r = await fetch(`/api/maps?id=${id}&view=public`, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { showInAppAlert(j.error || 'Öffentliche Karte nicht gefunden.', 'warning'); return; }
      enter({ id, rev: null, role: 'public', name: j.name }, j.data);
    } catch (e) {
      showInAppAlert('Öffentliche Karte konnte nicht geladen werden.', 'warning');
    }
  }

  // Bearbeitung der lokalen Karte ohne Konto: zurücknehmen und zeigen, wie es geht
  function blockLocalEdit() {
    loadStoredData();
    refreshAll();
    resetHistory();
    notice = signedIn()
      ? 'Bearbeiten geht in einer Konto-Karte. Öffne unten eine Karte oder lege eine neue an.'
      : 'Zum Bearbeiten brauchst du ein Konto. Melde dich an (oder registriere dich) und lege eine Karte an; den bisherigen Stand kannst du dabei übernehmen.';
    openDialog();
  }

  // --- Speichern ---
  function onEdit() {
    if (!canEdit()) {
      // Nur-Lesen: Änderung sofort zurücknehmen
      applyData(JSON.parse(base));
      if (Date.now() - lastReadOnlyAlert > 3000) {
        lastReadOnlyAlert = Date.now();
        showInAppAlert('Diese Karte ist nur zum Ansehen freigegeben.', 'warning');
      }
      return;
    }
    pending = true;
    setStatus('Speichere…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 1200);
  }

  async function flush() {
    const r = remote();
    if (!r || !pending || saving || !canEdit()) return;
    saving = true;
    pending = false;
    const sent = JSON.stringify(currentData());
    try {
      const res = await api('PUT', `?id=${r.id}`, { rev: r.rev, data: JSON.parse(sent) });
      if (remote() !== r) return;
      if (res.ok) {
        r.rev = res.json.rev;
        base = sent;
      } else if (res.status === 409) {
        await resolveConflict(r);
      } else if (res.status === 403 || res.status === 404) {
        pending = false;
        showInAppAlert(res.json.error || 'Kein Schreibzugriff mehr auf diese Karte.', 'warning');
        await openMap(r.id);
        return;
      } else {
        pending = true;
        if (res.status === 401) showInAppAlert('Bitte erneut anmelden, um zu speichern.', 'warning');
      }
    } catch (e) {
      pending = true;
    } finally {
      saving = false;
      if (remote() === r) setStatus(pending ? 'Nicht gespeichert' : 'Gespeichert');
    }
  }

  async function resolveConflict(r) {
    const res = await api('GET', `?id=${r.id}`);
    if (!res.ok || remote() !== r) { pending = true; return; }
    const merged = mergeMaps(JSON.parse(base), currentData(), res.json.data);
    r.rev = res.json.rev;
    applyData(merged.data);
    base = JSON.stringify(res.json.data);
    pending = true;
    saveTimer = setTimeout(flush, 0);
    showInAppAlert(merged.lost
      ? `Jemand hat gleichzeitig gespeichert. An ${merged.lost} Stelle(n) gilt jetzt deine Version.`
      : 'Änderungen von anderen wurden übernommen.', 'info');
  }

  async function poll() {
    const r = remote();
    if (!r || r.role === 'public' || pending || saving || document.hidden) return;
    const a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    try {
      const res = await api('GET', `?id=${r.id}&rev=${r.rev}`);
      if (!res.ok || res.json.unchanged || remote() !== r || pending || saving) return;
      r.rev = res.json.rev;
      r.name = res.json.name;
      applyData(res.json.data);
      setStatus(canEdit() ? 'Gespeichert' : 'Nur lesen');
    } catch (e) { /* offline */ }
  }

  // --- Anzeige: Kapsel, Notizhinweis, Personen ---
  function setStatus(s) {
    status = s;
    const cap = document.getElementById('live-sync-capsule');
    if (!cap) return;
    const r = remote();
    const show = !!r || !localEditAllowed();
    cap.style.display = show ? '' : 'none';
    if (!show) return;
    document.getElementById('sync-room-label').textContent = r ? r.name : signedIn() ? 'Karte öffnen' : 'Anmelden';
    const pill = document.getElementById('sync-state-pill');
    pill.textContent = r ? s : 'Nur Ansicht';
    cap.title = r ? 'Konto & Karten' : 'Zum Bearbeiten anmelden und eine Karte öffnen';
    pill.classList.toggle('syncing', s === 'Speichere…');
    pill.classList.toggle('offline', s === 'Nicht gespeichert');
    document.getElementById('sync-live-dot').classList.toggle('offline', s === 'Nicht gespeichert');
  }

  function updateNotesHint() {
    const span = document.querySelector('#drawer-notes-details .privacy-notes-hint span');
    if (!span) return;
    if (!span.dataset.local) span.dataset.local = span.textContent;
    span.textContent = remote() && remote().role !== 'public'
      ? 'Nur für dich und die Personen sichtbar, mit denen diese Karte geteilt ist.'
      : span.dataset.local;
  }

  function selectedUnit() {
    if (AppState.selectedDistrictId) return AppState.districts[AppState.selectedDistrictId];
    const tid = AppState.selectedTownId;
    if (!tid || townHasDistricts(tid)) return null;
    return AppState.towns[tid];
  }

  function updateReadOnly() {
    const box = document.getElementById('drawer-readonly');
    if (!box) return;
    const r = remote();
    box.hidden = editable();
    document.getElementById('drawer-readonly-text').textContent = r
      ? (r.role === 'public' ? 'Öffentliche Ansicht.' : 'Diese Karte ist für dich nur zum Ansehen freigegeben.')
      : 'Nur Ansicht. Zum Bearbeiten brauchst du ein Konto.';
    const btn = document.getElementById('drawer-readonly-btn');
    btn.textContent = r ? 'Konto & Karten' : signedIn() ? 'Karte öffnen' : 'Anmelden';
    document.body.classList.toggle('is-readonly', !editable());
  }

  function renderPeople() {
    updateReadOnly();
    const sec = document.getElementById('drawer-people');
    if (!sec) return;
    const r = remote();
    sec.hidden = (r && r.role === 'public') || !AppState.selectedTownId;
    if (sec.hidden) return;
    document.getElementById('people-open-accounts').hidden = !!r;
    if (!r) {
      document.getElementById('people-list').replaceChildren();
      document.getElementById('people-add-form').hidden = true;
      document.getElementById('people-summary').textContent = 'Personen trägst du in einer Konto-Karte ein. Sie sind nur für dich und die Personen sichtbar, mit denen du die Karte teilst.';
      return;
    }
    const unit = selectedUnit();
    const list = document.getElementById('people-list');
    const form = document.getElementById('people-add-form');
    list.replaceChildren();
    let people = [];
    if (unit) {
      people = unit.people || [];
    } else {
      for (const df of Object.values(AppState.districtFeaturesById)) {
        if (df.properties.townId === AppState.selectedTownId) people = people.concat((AppState.districts[df.properties.id] || {}).people || []);
      }
    }
    const believers = people.filter(p => p.believer).length;
    document.getElementById('people-summary').textContent = unit
      ? `${people.length} ${people.length === 1 ? 'Person' : 'Personen'}, davon ${believers} gläubig`
      : `${people.length} ${people.length === 1 ? 'Person' : 'Personen'} in den Stadtteilen, davon ${believers} gläubig. Personen werden im Stadtteil eingetragen.`;
    form.hidden = !unit || !canEdit();
    if (!unit) return;
    const ro = !canEdit();
    people.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'people-item';
      const name = Object.assign(document.createElement('input'), { className: 'form-input people-name', value: p.name, maxLength: 100, disabled: ro });
      name.setAttribute('aria-label', 'Name');
      const note = Object.assign(document.createElement('input'), { className: 'form-input people-note', value: p.note, maxLength: 500, placeholder: 'Notiz', disabled: ro });
      note.setAttribute('aria-label', `Notiz zu ${p.name}`);
      const lab = document.createElement('label');
      lab.className = 'people-believer';
      const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: p.believer, disabled: ro });
      lab.append(cb, ' gläubig');
      const del = Object.assign(document.createElement('button'), { type: 'button', className: 'btn btn-secondary btn-sm', textContent: 'Entfernen', hidden: ro });
      del.setAttribute('aria-label', `${p.name} entfernen`);
      const update = (fn, desc) => {
        pushHistory(desc);
        unit.people = sanitizePeople(fn(unit.people.slice()));
        saveState();
        renderPeople();
      };
      name.addEventListener('change', () => update(ps => { ps[i] = { ...ps[i], name: name.value }; return ps; }, 'Person umbenannt'));
      note.addEventListener('change', () => update(ps => { ps[i] = { ...ps[i], note: note.value }; return ps; }, 'Personennotiz'));
      cb.addEventListener('change', () => update(ps => { ps[i] = { ...ps[i], believer: cb.checked }; return ps; }, 'Gläubig geändert'));
      del.addEventListener('click', () => update(ps => { ps.splice(i, 1); return ps; }, 'Person entfernt'));
      li.append(name, note, lab, del);
      list.appendChild(li);
    });
  }

  function addPerson(e) {
    e.preventDefault();
    const unit = selectedUnit();
    const input = document.getElementById('people-add-name');
    const cb = document.getElementById('people-add-believer');
    if (!unit || !canEdit() || !input.value.trim()) return;
    if ((unit.people || []).length >= MAX_PEOPLE) { showInAppAlert(`Höchstens ${MAX_PEOPLE} Personen pro Ort.`, 'warning'); return; }
    pushHistory('Person hinzugefügt');
    unit.people = sanitizePeople([...(unit.people || []), { name: input.value, note: '', believer: cb.checked }]);
    input.value = '';
    cb.checked = false;
    saveState();
    renderPeople();
    input.focus();
  }

  // --- Dialog „Konten & Karten“ ---
  function openDialog() {
    const d = dialog();
    if (!d.open) d.showModal();
    render();
    loadClerk().then(() => { refreshList().then(render); });
  }

  // Ein modaler <dialog> macht die übrige Seite inert, darum vor Clerk-Fenstern und Bestätigungen schließen.
  function withDialogClosed(fn) {
    if (dialog().open) dialog().close();
    fn();
  }

  function h(tag, attrs = {}, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'onclick' || k === 'onsubmit' || k === 'onchange') el.addEventListener(k.slice(2), v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    }
    el.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
    return el;
  }

  const ROLE_LABEL = { owner: 'Besitzer', edit: 'Bearbeiten', view: 'Lesen', public: 'Öffentlich' };

  function render() {
    const root = body();
    if (!root || !dialog().open) return;
    const r = remote();
    const parts = [];

    if (notice) parts.push(h('p', { className: 'acc-notice', role: 'status' }, notice));

    if (r && r.role === 'public') {
      parts.push(h('p', {}, `Du siehst die öffentliche Ansicht von „${r.name}“: nur Stufen, Aktivitäten und Entsendungen.`));
      parts.push(h('button', { type: 'button', className: 'btn btn-secondary', onclick: () => leaveToLocal(false) || render() }, 'Zur lokalen Karte'));
    }

    if (!cfg) {
      parts.push(h('p', {}, 'Lade…'));
    } else if (!cfg.ready) {
      parts.push(h('p', {}, 'Konten sind auf diesem Server noch nicht eingerichtet. Die lokale Karte funktioniert wie bisher.'));
    } else if (!clerk) {
      parts.push(h('p', {}, 'Anmeldung wird geladen…'));
    } else if (!signedIn()) {
      parts.push(
        h('p', {}, wantedMapId ? 'Diese Karte ist geschützt. Bitte melde dich an.' : 'Mit einem Konto legst du eigene Karten an, teilst sie mit bestimmten Personen und führst Personenlisten pro Ort. Diese Daten sind nur für dich und die Personen sichtbar, mit denen du eine Karte teilst.'),
        h('button', { type: 'button', className: 'btn btn-primary', onclick: () => withDialogClosed(() => clerk.openSignIn()) }, 'Anmelden oder registrieren')
      );
    } else {
      parts.push(h('div', { className: 'acc-row' },
        h('span', { className: 'acc-email' }, `Angemeldet als ${email()}`),
        h('button', { type: 'button', className: 'btn btn-secondary btn-sm', onclick: signOut }, 'Abmelden')));

      parts.push(h('div', { className: 'group-header' }, 'Karten'));
      const ul = h('ul', { className: 'acc-maps' });
      const item = (label, badge, active, onclick) => ul.appendChild(h('li', {},
        h('button', { type: 'button', className: 'acc-map' + (active ? ' active' : ''), onclick, 'aria-current': active ? 'true' : 'false' },
          h('span', {}, label), badge ? h('span', { className: 'acc-badge' }, badge) : null)));
      item(localEditAllowed() ? 'Lokale Karte (nur dieses Gerät)' : 'Lokale Karte (dieses Gerät, nur Ansicht)', null, !r, async () => { if (r && await settle()) { leaveToLocal(false); render(); } });
      maps.forEach(m => item(m.name, ROLE_LABEL[m.role] + (m.public ? ' · öffentlich' : ''), r && r.id === m.id, () => openMap(m.id)));
      parts.push(ul);

      const nameIn = h('input', { className: 'form-input', maxLength: 80, required: true, placeholder: 'Name der neuen Karte', 'aria-label': 'Name der neuen Karte' });
      const copyCb = h('input', { type: 'checkbox', checked: true });
      parts.push(h('form', { className: 'acc-form', onsubmit: (e) => { e.preventDefault(); createMap(nameIn.value, copyCb.checked); } },
        nameIn,
        h('label', { className: 'acc-check' }, copyCb, ' Stand der lokalen Karte übernehmen'),
        h('button', { type: 'submit', className: 'btn btn-primary btn-sm' }, 'Neue Karte anlegen')));

      if (r && r.role === 'owner') parts.push(...ownerSection(r));
    }
    root.replaceChildren(...parts);
  }

  function ownerSection(r) {
    const out = [h('div', { className: 'group-header' }, `„${r.name}“ teilen`)];
    const ul = h('ul', { className: 'acc-invites' });
    for (const [mail, role] of Object.entries(r.invites || {})) {
      const sel = h('select', { className: 'form-select', 'aria-label': `Rolle für ${mail}`, onchange: () => patch({ invites: { [mail]: sel.value } }) },
        h('option', { value: 'view', selected: role === 'view' }, 'Lesen'),
        h('option', { value: 'edit', selected: role === 'edit' }, 'Bearbeiten'));
      ul.appendChild(h('li', {}, h('span', {}, mail), sel,
        h('button', { type: 'button', className: 'btn btn-secondary btn-sm', 'aria-label': `${mail} entfernen`, onclick: () => patch({ invites: { [mail]: null } }) }, 'Entfernen')));
    }
    if (!ul.children.length) ul.appendChild(h('li', { className: 'acc-muted' }, 'Noch mit niemandem geteilt.'));
    out.push(ul);

    const mailIn = h('input', { type: 'email', className: 'form-input', required: true, placeholder: 'E-Mail-Adresse', 'aria-label': 'E-Mail-Adresse' });
    const roleSel = h('select', { className: 'form-select', 'aria-label': 'Rolle' }, h('option', { value: 'view' }, 'Lesen'), h('option', { value: 'edit' }, 'Bearbeiten'));
    out.push(h('form', { className: 'acc-form', onsubmit: (e) => { e.preventDefault(); patch({ invites: { [mailIn.value.trim()]: roleSel.value } }); } },
      mailIn, roleSel, h('button', { type: 'submit', className: 'btn btn-primary btn-sm' }, 'Einladen')));
    out.push(h('p', { className: 'acc-muted' }, 'Die Person meldet sich mit genau dieser E-Mail-Adresse an und findet die Karte dann hier in der Liste.'));

    const pub = h('input', { type: 'checkbox', checked: r.public, onchange: () => patch({ public: pub.checked }) });
    const link = `${location.origin}${location.pathname}#public=${r.id}`;
    out.push(h('label', { className: 'acc-check' }, pub, ' Öffentlich ansehen lassen (nur Stufen, Aktivitäten, Entsendungen; keine Personen, keine Notizen)'));
    if (r.public) out.push(h('button', { type: 'button', className: 'btn btn-secondary btn-sm', onclick: () => copy(link) }, 'Öffentlichen Link kopieren'));

    const renameIn = h('input', { className: 'form-input', maxLength: 80, required: true, value: r.name, 'aria-label': 'Name der Karte' });
    out.push(h('div', { className: 'group-header' }, 'Karte verwalten'));
    out.push(h('form', { className: 'acc-form', onsubmit: (e) => { e.preventDefault(); patch({ name: renameIn.value.trim() }); } },
      renameIn, h('button', { type: 'submit', className: 'btn btn-secondary btn-sm' }, 'Umbenennen')));
    out.push(h('button', { type: 'button', className: 'btn btn-secondary btn-sm destructive', onclick: () => deleteMap(r) }, 'Karte löschen'));
    return out;
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); showInAppAlert('Link kopiert.', 'success'); }
    catch (e) { window.prompt('Link kopieren:', text); }
  }

  async function patch(change) {
    const r = remote();
    if (!r || r.role !== 'owner') return;
    const res = await api('PATCH', `?id=${r.id}`, change);
    if (!res.ok) { showInAppAlert(res.json.error || 'Konnte nicht gespeichert werden.', 'warning'); render(); return; }
    Object.assign(r, { name: res.json.name, invites: res.json.invites, public: res.json.public });
    setStatus(status);
    await refreshList();
    render();
  }

  async function createMap(name, copyLocal) {
    if (!(await settle())) return;
    let data;
    if (copyLocal) {
      // Bewusst aus dem lokalen Speicher, nicht aus AppState: der kann gerade eine andere Konto-Karte sein
      let parsed = null;
      try { parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch (e) { /* leer */ }
      const m = migrateStoredState(parsed);
      data = { towns: m.towns, districts: m.districts, deployments: m.deployments };
    }
    const res = await api('POST', '', { name: name.trim(), data });
    if (!res.ok) { showInAppAlert(res.json.error || 'Karte konnte nicht angelegt werden.', 'warning'); return; }
    await refreshList();
    await openMap(res.json.id);
  }

  function deleteMap(r) {
    withDialogClosed(() => showConfirmModal({
      title: 'Karte löschen',
      message: `„${r.name}“ mit allen Personenlisten und Notizen endgültig löschen? Das lässt sich nicht rückgängig machen. Alle, mit denen die Karte geteilt ist, verlieren den Zugriff.`,
      confirmText: 'Endgültig löschen',
      cancelText: 'Abbrechen',
      isDestructive: true,
      onConfirm: async () => {
        const res = await api('DELETE', `?id=${r.id}`);
        if (!res.ok) { showInAppAlert(res.json.error || 'Löschen fehlgeschlagen.', 'warning'); return; }
        leaveToLocal(true);
        await refreshList();
        showInAppAlert('Karte gelöscht.', 'success');
      }
    }));
  }

  async function signOut() {
    if (!(await settle())) return;
    if (remote() && remote().role !== 'public') leaveToLocal(true);
    await clerk.signOut();
    render();
  }

  async function handleHash() {
    const m = location.hash.match(/^#(map|public)=([A-Za-z0-9_-]{22})$/);
    if (!m || (remote() && remote().id === m[2])) return;
    if (m[1] === 'public') return openPublic(m[2]);
    wantedMapId = m[2];
    await loadClerk();
    if (signedIn()) { wantedMapId = null; await openMap(m[2]); }
    else openDialog();
  }

  function init() {
    document.getElementById('menu-item-accounts')?.addEventListener('click', () => {
      document.getElementById('project-dropdown-menu').classList.remove('visible');
      document.getElementById('btn-project-menu')?.setAttribute('aria-expanded', 'false');
      openDialog();
    });
    document.getElementById('live-sync-capsule')?.addEventListener('click', openDialog);
    document.getElementById('drawer-readonly-btn')?.addEventListener('click', openDialog);
    document.getElementById('people-open-accounts')?.addEventListener('click', openDialog);
    dialog()?.addEventListener('close', () => { notice = ''; });
    loadConfig().then(() => { setStatus(status); updateReadOnly(); });
    document.getElementById('people-add-form')?.addEventListener('submit', addPerson);
    window.addEventListener('hashchange', handleHash);
    window.addEventListener('online', () => { if (pending) flush(); });
    window.addEventListener('beforeunload', (e) => { if (pending || saving) { e.preventDefault(); e.returnValue = ''; } });
    setInterval(poll, 30000);
    handleHash();
    // Zuletzt geöffnete Konto-Karte wieder öffnen (gespeichert wird nur die ID, keine Inhalte)
    const last = localStorage.getItem(LAST_MAP_KEY);
    if (!location.hash && last && MAP_ID_RE.test(last)) {
      loadClerk().then(() => { if (signedIn() && !remote()) openMap(last); });
    }
  }

  return { init, onEdit, renderPeople, openDialog, localEditAllowed, blockLocalEdit };
})();

if (typeof window !== 'undefined') window.Accounts = Accounts;
