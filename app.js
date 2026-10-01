// Rhein-Neckar Cluster Interactive Map Application
// 100% Offline Vector Cartography with Geographic Landmarks,
// Factual Official Stadtteile (13 cities), and Simple Arrow Status Tracking.

const INITIAL_CLEAN_DATA = {
  towns: {},
  districts: {},
  deployments: []
};

const AppState = {
  currentMode: 'inspect', // 'inspect' | 'paint' | 'arrow'
  activePaintMilestone: 'pg',
  activePaintColor: '#86efac',
  visualViewMode: 'milestone',
  
  showLabels: true,
  showSurrounding: true,
  showRivers: true,
  showLandmarks: true,
  showArrows: true,
  
  selectedTownId: null,
  selectedDistrictId: null,
  activeDrawerTab: 'overview',
  
  arrowSourceId: null,
  arrowSourceIsDistrict: false,
  
  focusedTownId: null,
  
  towns: {},
  districts: {},
  deployments: [],
  
  map: null,
  surroundingLayer: null,
  landmarksLayer: null,
  geoJsonLayer: null,
  districtsLayer: null,
  townPerimeterLayer: null,
  markersLayer: null,
  arrowSvgLayer: null,
  
  townFeaturesById: {},
  townLayersById: {},
  districtFeaturesById: {},
  districtLayersById: {},

  // History & Quick Action state
  undoStack: [],
  redoStack: [],
  isHistoryAction: false,
  activeQuickDeployment: null
};

// --- Central Terminology & Label Dictionary (Single Source of Truth) ---
const APP_TERMS = {
  milestones: {
    none: {
      key: 'none',
      code: '—',
      short: 'Kein',
      standard: 'Noch nicht begonnen',
      full: 'Noch nicht begonnen',
      color: '#ffffff',
      border: '#cbd5e1'
    },
    pg: {
      key: 'pg',
      code: 'PG',
      short: 'PG',
      standard: 'Programm des Wachstums',
      full: 'Programm des Wachstums (PG)',
      color: '#86efac',
      border: '#22c55e'
    },
    ipg: {
      key: 'ipg',
      code: 'IPG',
      short: 'IPG',
      standard: 'Intensives Programm',
      full: 'Intensives Programm des Wachstums (IPG)',
      color: '#34c759',
      border: '#15803d'
    },
    ipg_plus: {
      key: 'ipg_plus',
      code: 'IPG+',
      short: 'IPG+',
      standard: 'Fortgeschrittenes Programm',
      full: 'Fortgeschrittenes Intensives Programm (IPG+)',
      color: '#15803d',
      border: '#052e16'
    },
    custom: {
      key: 'custom',
      code: 'Indiv.',
      short: 'Farbe',
      standard: 'Individuelle Farbe',
      full: 'Individuelle Farbanpassung',
      color: '#cbd5e1',
      border: '#64748b'
    }
  },
  activities: {
    devotionals: 'Andachtstreffen',
    studyCircles: 'Studienkreise',
    childrenClasses: 'Kinderklassen',
    juniorYouth: 'Juniorengruppen'
  },
  deployments: {
    types: {
      'Pioniere': 'Pioniere / Umzügler',
      'Wanderlehrer': 'Wanderlehrer / Besuchsteam',
      'Projektbegleitung': 'Projektbegleitung',
      'Kinderklassen-Lehrer': 'Kinderklassen-Lehrer',
      'Junioren-Animateur': 'Junioren-Animateur',
      'Studienkreis-Tutor': 'Studienkreis-Tutor'
    },
    statuses: {
      'active': 'Aktiv',
      'planned': 'Geplant',
      'established': 'Etabliert'
    }
  },
  units: {
    town: 'Ortschaft',
    district: 'Stadtteil'
  }
};

const STORAGE_KEY = 'rhein_neckar_cluster_clean_v7';
const BACKUPS_STORAGE_KEY = 'rn_cluster_backups_v1';
const META_STORAGE_KEY = 'rn_cluster_meta_v1';
const MAX_UNDO_STACK = 45;
const MAX_BACKUPS = 12;

// --- AppStorage: IndexedDB with Transparent LocalStorage Migration ---
const AppStorage = {
  db: null,
  dbName: 'RheinNeckarClusterDB',
  dbVersion: 1,

  async init() {
    if (!window.indexedDB) {
      console.warn('IndexedDB not supported, using localStorage');
      return false;
    }
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open(this.dbName, this.dbVersion);
        req.onupgradeneeded = (e) => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('state')) {
            db.createObjectStore('state', { keyPath: 'key' });
          }
          if (!db.objectStoreNames.contains('backups')) {
            const bs = db.createObjectStore('backups', { keyPath: 'id' });
            bs.createIndex('timestamp', 'timestamp', { unique: false });
          }
        };
        req.onsuccess = async (e) => {
          this.db = e.target.result;
          await this.migrateFromLocalStorage();
          resolve(true);
        };
        req.onerror = (e) => {
          console.warn('IndexedDB open error:', e);
          resolve(false);
        };
      } catch (err) {
        console.warn('IndexedDB initialization failed:', err);
        resolve(false);
      }
    });
  },

  async migrateFromLocalStorage() {
    if (!this.db) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        await this.saveState(parsed);
      }
      const rawBackups = localStorage.getItem(BACKUPS_STORAGE_KEY);
      if (rawBackups) {
        const backups = JSON.parse(rawBackups);
        for (const b of backups) {
          await this.saveBackup(b);
        }
      }
    } catch (e) {
      console.warn('IndexedDB migration notice:', e);
    }
  },

  async getState() {
    if (!this.db) {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('state', 'readonly');
        const req = tx.objectStore('state').get('current');
        req.onsuccess = () => resolve(req.result ? req.result.data : null);
        req.onerror = () => {
          const raw = localStorage.getItem(STORAGE_KEY);
          resolve(raw ? JSON.parse(raw) : null);
        };
      } catch (e) {
        const raw = localStorage.getItem(STORAGE_KEY);
        resolve(raw ? JSON.parse(raw) : null);
      }
    });
  },

  async saveState(data) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}

    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('state', 'readwrite');
        tx.objectStore('state').put({ key: 'current', data: data, updatedAt: Date.now() });
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async saveBackup(backupItem) {
    if (!this.db) return;
    return new Promise((resolve) => {
      try {
        const tx = this.db.transaction('backups', 'readwrite');
        tx.objectStore('backups').put(backupItem);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (e) {
        resolve(false);
      }
    });
  },

  async checkPersistence() {
    if (navigator.storage && navigator.storage.persisted) {
      return await navigator.storage.persisted();
    }
    return false;
  },

  async requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      return await navigator.storage.persist();
    }
    return false;
  }
};

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
  registerServiceWorker();
  await AppStorage.init();
  checkMigrationOnStartup();
  loadStoredData();
  initMap();
  initArrowSvgLayer();
  renderSurroundingRegions();
  renderGeographicLandmarks();
  renderGeoJson();
  renderDistrictsGeoJson();
  renderTownPerimeterLayer();
  initUIEventListeners();
  updateClusterStats();
  updateUndoRedoButtons();
  updateExportIndicators();
  updatePersistenceStatus();
  saveAutoBackup("Sitzungsstart", false);

  // Check URL params for direct town focus (e.g. ?focus=heidelberg or #heidelberg)
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const focusParam = urlParams.get('focus') || (window.location.hash ? window.location.hash.substring(1) : null);
    if (focusParam && AppState.townFeaturesById[focusParam]) {
      setTimeout(() => focusTownDistricts(focusParam), 150);
    }
  } catch (e) {
    console.warn('URL focus parse error:', e);
  }

  // Check URL for shared cluster state or platform migration
  setTimeout(() => {
    checkMigrationOnStartup();
    checkShareUrlOnStartup();
  }, 250);
  window.addEventListener('hashchange', () => {
    checkMigrationOnStartup();
    checkShareUrlOnStartup();
  });
});

// ==========================================================================
// Schema Versioning & Data Sanitization Engine (Security & Hard Constraints)
// ==========================================================================
const CURRENT_SCHEMA_VERSION = 2;

function sanitizeColor(col, fallback = '#86efac') {
  if (typeof col !== 'string') return fallback;
  const clean = col.trim();
  if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(clean)) return clean;
  if (/^var\(--[a-zA-Z0-9-]+\)$/.test(clean)) return clean;
  return fallback;
}

function sanitizeActivityObject(acts) {
  if (!acts || typeof acts !== 'object') {
    return { devotionals: 0, studyCircles: 0, childrenClasses: 0, juniorYouth: 0 };
  }
  return {
    devotionals: Math.max(0, parseInt(acts.devotionals, 10) || 0),
    studyCircles: Math.max(0, parseInt(acts.studyCircles, 10) || 0),
    childrenClasses: Math.max(0, parseInt(acts.childrenClasses, 10) || 0),
    juniorYouth: Math.max(0, parseInt(acts.juniorYouth, 10) || 0)
  };
}

function sanitizeEntityData(entity) {
  if (!entity || typeof entity !== 'object') {
    return {
      milestone: 'none',
      customColor: '#86efac',
      nuclei: 0,
      activities: sanitizeActivityObject(null),
      isCenter: false,
      notes: ''
    };
  }
  const validMilestones = ['none', 'pg', 'ipg', 'ipg_plus', 'custom'];
  const ms = validMilestones.includes(entity.milestone) ? entity.milestone : 'none';
  return {
    milestone: ms,
    customColor: sanitizeColor(entity.customColor, '#86efac'),
    nuclei: Math.max(0, parseInt(entity.nuclei, 10) || 0),
    activities: sanitizeActivityObject(entity.activities),
    isCenter: Boolean(entity.isCenter),
    notes: typeof entity.notes === 'string' ? entity.notes.slice(0, 10000) : ''
  };
}

function sanitizeDeploymentRecord(dep, idx = 0) {
  if (!dep || typeof dep !== 'object') return null;
  const fromId = String(dep.fromId || dep.f || '').trim();
  const toId = String(dep.toId || dep.t || '').trim();
  if (!fromId || !toId) return null;

  const validStatuses = ['active', 'planned', 'established'];
  const status = validStatuses.includes(dep.status || dep.s) ? (dep.status || dep.s) : 'active';
  const fromName = dep.fromName || AppState.townFeaturesById[fromId]?.properties?.name || AppState.districtFeaturesById[fromId]?.properties?.name || fromId;
  const toName = dep.toName || AppState.townFeaturesById[toId]?.properties?.name || AppState.districtFeaturesById[toId]?.properties?.name || toId;

  return {
    id: typeof dep.id === 'string' && dep.id ? dep.id : `dep_item_${idx + 1}_${Date.now().toString(36)}`,
    fromId,
    toId,
    fromName: String(fromName).slice(0, 100),
    toName: String(toName).slice(0, 100),
    type: typeof dep.type === 'string' && dep.type ? dep.type.slice(0, 100) : 'Pioniere / Umzügler',
    count: Math.max(1, parseInt(dep.count || dep.c, 10) || 1),
    status,
    color: sanitizeColor(dep.color || dep.col, '#007aff'),
    notes: typeof (dep.notes || dep.nt) === 'string' ? (dep.notes || dep.nt).slice(0, 5000) : '',
    createdAt: dep.createdAt || new Date().toISOString()
  };
}

function migrateStoredState(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, towns: {}, districts: {}, deployments: [] };
  }
  const towns = {};
  if (parsed.towns && typeof parsed.towns === 'object') {
    for (const [id, t] of Object.entries(parsed.towns)) {
      towns[id] = sanitizeEntityData(t);
    }
  }

  const districts = {};
  if (parsed.districts && typeof parsed.districts === 'object') {
    for (const [id, d] of Object.entries(parsed.districts)) {
      districts[id] = sanitizeEntityData(d);
    }
  }

  const deployments = [];
  if (Array.isArray(parsed.deployments)) {
    parsed.deployments.forEach((d, idx) => {
      const sanitized = sanitizeDeploymentRecord(d, idx);
      if (sanitized) deployments.push(sanitized);
    });
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    towns,
    districts,
    deployments,
    updatedAt: parsed.updatedAt || new Date().toISOString()
  };
}

function validateClusterDataset(data) {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Die Datei enthält kein gültiges JSON-Objekt.' };
  }
  if (!data.towns && !data.deployments) {
    return { valid: false, error: "Fehlende Pflichtfelder: 'towns' oder 'deployments' erforderlich." };
  }
  if (data.towns && (typeof data.towns !== 'object' || Array.isArray(data.towns))) {
    return { valid: false, error: "'towns' muss ein Schlüssel-Wert-Objekt sein." };
  }
  if (data.districts && (typeof data.districts !== 'object' || Array.isArray(data.districts))) {
    return { valid: false, error: "'districts' muss ein Schlüssel-Wert-Objekt sein." };
  }
  if (data.deployments && !Array.isArray(data.deployments)) {
    return { valid: false, error: "'deployments' muss eine Liste sein." };
  }

  const migrated = migrateStoredState(data);
  return { valid: true, sanitizedData: migrated };
}

function validateSharedPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: 'Ungültige Share-Nutzlast.' };
  }
  if (!payload.t || typeof payload.t !== 'object') {
    return { valid: false, error: "Share-Payload enthält keine gültigen Ortsdaten ('t')." };
  }
  const cleanT = {};
  const validMilestones = ['none', 'pg', 'ipg', 'ipg_plus', 'custom'];
  for (const [id, item] of Object.entries(payload.t)) {
    if (!item || typeof item !== 'object') continue;
    const cleanItem = {};
    if (item.m && validMilestones.includes(item.m)) cleanItem.m = item.m;
    if (item.n) cleanItem.n = Math.max(0, parseInt(item.n, 10) || 0);
    if (item.c) cleanItem.c = 1;
    if (item.nt && typeof item.nt === 'string') cleanItem.nt = item.nt.slice(0, 5000);
    if (item.col) cleanItem.col = sanitizeColor(item.col, '#86efac');
    cleanT[String(id).slice(0, 64)] = cleanItem;
  }

  const cleanD = {};
  if (payload.d && typeof payload.d === 'object') {
    for (const [id, item] of Object.entries(payload.d)) {
      if (!item || typeof item !== 'object') continue;
      const cleanItem = {};
      if (item.m && validMilestones.includes(item.m)) cleanItem.m = item.m;
      if (item.n) cleanItem.n = Math.max(0, parseInt(item.n, 10) || 0);
      if (item.c) cleanItem.c = 1;
      if (item.nt && typeof item.nt === 'string') cleanItem.nt = item.nt.slice(0, 5000);
      cleanD[String(id).slice(0, 64)] = cleanItem;
    }
  }

  const cleanDp = [];
  if (Array.isArray(payload.dp)) {
    payload.dp.forEach(d => {
      if (!d || typeof d !== 'object') return;
      const f = String(d.f || '').trim();
      const t = String(d.t || '').trim();
      if (!f || !t) return;
      cleanDp.push({
        f: f.slice(0, 64),
        t: t.slice(0, 64),
        c: Math.max(1, parseInt(d.c, 10) || 1),
        s: ['active', 'planned', 'established'].includes(d.s) ? d.s : 'active',
        col: sanitizeColor(d.col, '#007aff'),
        nt: typeof d.nt === 'string' ? d.nt.slice(0, 2000) : ''
      });
    });
  }

  return {
    valid: true,
    sanitizedPayload: {
      v: payload.v || 1,
      ts: typeof payload.ts === 'number' ? payload.ts : Date.now(),
      t: cleanT,
      d: cleanD,
      dp: cleanDp
    }
  };
}

// --- Data Persistence ---
function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrateStoredState(parsed);
      AppState.towns = migrated.towns;
      AppState.districts = migrated.districts;
      AppState.deployments = migrated.deployments;
    } else {
      AppState.towns = {};
      AppState.districts = {};
      AppState.deployments = [];
    }
  } catch (e) {
    console.error('Error loading stored data:', e);
    AppState.towns = {};
    AppState.districts = {};
    AppState.deployments = [];
  }
  
  if (typeof RHEIN_NECKAR_GEOJSON !== 'undefined') {
    RHEIN_NECKAR_GEOJSON.features.forEach(f => {
      const id = f.properties.id;
      AppState.townFeaturesById[id] = f;
      if (!AppState.towns[id]) {
        const isDefaultCenter = ['Mannheim', 'Heidelberg', 'Speyer', 'Leimen'].includes(f.properties.name);
        AppState.towns[id] = {
          milestone: 'none',
          customColor: '#86efac',
          nuclei: 0,
          activities: { devotionals: 0, studyCircles: 0, childrenClasses: 0, juniorYouth: 0 },
          isCenter: isDefaultCenter,
          notes: ''
        };
      }
    });
  }

  if (typeof RHEIN_NECKAR_DISTRICTS !== 'undefined') {
    RHEIN_NECKAR_DISTRICTS.features.forEach(f => {
      const id = f.properties.id;
      AppState.districtFeaturesById[id] = f;
      if (!AppState.districts[id]) {
        AppState.districts[id] = {
          milestone: 'none',
          customColor: '#86efac',
          nuclei: 0,
          activities: { devotionals: 0, studyCircles: 0, childrenClasses: 0, juniorYouth: 0 },
          notes: ''
        };
      }
    });
  }
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'http:' || window.location.protocol === 'https:')) {
    navigator.serviceWorker.register('./sw.js?v=5').then((reg) => {
      reg.update().catch(() => {});
    }).catch(err => {
      console.log('Service worker note (offline fallback):', err);
    });

    // Listen for update messages from the service worker
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SW_UPDATED') {
        // Show a non-intrusive update toast with a reload link
        let container = document.getElementById('toast-container');
        if (!container) {
          container = document.createElement('div');
          container.id = 'toast-container';
          document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'app-toast app-toast-info app-toast-update';
        toast.innerHTML = '';
        const msg = document.createElement('span');
        msg.className = 'toast-message';
        msg.textContent = 'Neue Version verfügbar – ';
        const reloadLink = document.createElement('button');
        reloadLink.className = 'toast-reload-btn';
        reloadLink.textContent = 'Neu laden';
        reloadLink.addEventListener('click', () => window.location.reload());
        const closeBtn = document.createElement('button');
        closeBtn.className = 'toast-close';
        closeBtn.textContent = '×';
        closeBtn.setAttribute('aria-label', 'Meldung schließen');
        closeBtn.addEventListener('click', () => toast.remove());
        toast.appendChild(msg);
        toast.appendChild(reloadLink);
        toast.appendChild(closeBtn);
        container.appendChild(toast);
        requestAnimationFrame(() => toast.classList.add('toast-enter'));
      }
    });
  }
}


function saveState() {
  const dataToSave = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    towns: AppState.towns,
    districts: AppState.districts,
    deployments: AppState.deployments,
    updatedAt: new Date().toISOString()
  };
  AppStorage.saveState(dataToSave);
  updateClusterStats();
  saveAutoBackup('Automatische Sicherung', false);
}

// --- History (Undo / Redo) & Local Auto-Backups ---
function snapshotCurrentData() {
  return {
    towns: JSON.parse(JSON.stringify(AppState.towns)),
    districts: JSON.parse(JSON.stringify(AppState.districts)),
    deployments: JSON.parse(JSON.stringify(AppState.deployments))
  };
}

function pushHistory(desc) {
  if (AppState.isHistoryAction) return;
  const snapshot = snapshotCurrentData();
  snapshot.desc = desc || 'Änderung';
  snapshot.time = Date.now();

  AppState.undoStack.push(snapshot);
  if (AppState.undoStack.length > MAX_UNDO_STACK) {
    AppState.undoStack.shift();
  }
  AppState.redoStack = [];
  updateUndoRedoButtons();
}

function undo() {
  if (AppState.undoStack.length === 0) return;

  const currentState = snapshotCurrentData();
  currentState.desc = 'Vor Rückgängig';
  currentState.time = Date.now();
  AppState.redoStack.push(currentState);

  const prevState = AppState.undoStack.pop();
  AppState.isHistoryAction = true;
  AppState.towns = prevState.towns;
  AppState.districts = prevState.districts;
  AppState.deployments = prevState.deployments;

  saveState();
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  if (AppState.selectedDistrictId) selectDistrict(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) selectTown(AppState.selectedTownId);
  AppState.isHistoryAction = false;

  updateUndoRedoButtons();
}

function redo() {
  if (AppState.redoStack.length === 0) return;

  const currentState = snapshotCurrentData();
  currentState.desc = 'Vor Wiederholen';
  currentState.time = Date.now();
  AppState.undoStack.push(currentState);

  const nextState = AppState.redoStack.pop();
  AppState.isHistoryAction = true;
  AppState.towns = nextState.towns;
  AppState.districts = nextState.districts;
  AppState.deployments = nextState.deployments;

  saveState();
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  if (AppState.selectedDistrictId) selectDistrict(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) selectTown(AppState.selectedTownId);
  AppState.isHistoryAction = false;

  updateUndoRedoButtons();
}

function updateUndoRedoButtons() {
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.disabled = (AppState.undoStack.length === 0);
  if (btnRedo) btnRedo.disabled = (AppState.redoStack.length === 0);

  const mUndo = document.getElementById('mobile-act-undo');
  const mRedo = document.getElementById('mobile-act-redo');
  if (mUndo) mUndo.disabled = (AppState.undoStack.length === 0);
  if (mRedo) mRedo.disabled = (AppState.redoStack.length === 0);
}

function getStoredBackups() {
  try {
    const raw = localStorage.getItem(BACKUPS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveAutoBackup(desc, force = false) {
  try {
    const backups = getStoredBackups();
    const now = Date.now();

    // Throttle automated saves to once every 2 minutes unless forced
    if (!force && backups.length > 0) {
      const last = backups[0];
      if (now - last.timestamp < 2 * 60 * 1000) return;
    }

    let activeTownsCount = 0;
    let totalNuclei = 0;
    let totalActivities = 0;
    Object.values(AppState.towns).forEach(t => {
      if (t.milestone !== 'none') activeTownsCount++;
      totalNuclei += (t.nuclei || 0);
      if (t.activities) {
        totalActivities += (t.activities.devotionals || 0) + (t.activities.studyCircles || 0) + (t.activities.childrenClasses || 0) + (t.activities.juniorYouth || 0);
      }
    });

    const newBackup = {
      id: 'bk_' + now,
      timestamp: now,
      dateFormatted: new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(now)),
      desc: desc || 'Automatischer Speicherpunkt',
      stats: {
        activeTowns: activeTownsCount,
        nuclei: totalNuclei,
        activities: totalActivities,
        deployments: AppState.deployments.length
      },
      data: snapshotCurrentData()
    };

    backups.unshift(newBackup);
    if (backups.length > MAX_BACKUPS) backups.pop();
    try {
      localStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(backups));
    } catch (e) {}
    AppStorage.saveBackup(newBackup);
  } catch (e) {
    console.warn('Could not save auto backup:', e);
  }
}

function restoreBackup(backupId) {
  const backups = getStoredBackups();
  const found = backups.find(b => b.id === backupId);
  if (!found) return;

  showConfirmModal({
    title: 'Sicherung wiederherstellen',
    message: `Möchtest du den Sicherungsstand vom ${found.dateFormatted} (${found.desc}) wirklich wiederherstellen? Deine aktuellen Daten werden zuvor gesichert.`,
    confirmText: 'Wiederherstellen',
    cancelText: 'Abbrechen',
    onConfirm: () => {
      pushHistory('Vor Wiederherstellung gesichert');
      AppState.isHistoryAction = true;
      AppState.towns = found.data.towns;
      AppState.districts = found.data.districts;
      AppState.deployments = found.data.deployments;
      saveState();
      refreshAllStyles();
      refreshMarkers();
      renderArrows();
      if (AppState.selectedTownId) selectTown(AppState.selectedTownId);
      AppState.isHistoryAction = false;

      const modal = document.getElementById('backups-modal');
      if (modal) modal.classList.remove('visible');
      showInAppAlert('Sicherungsstand erfolgreich wiederhergestellt ✓', 'success');
    }
  });
}


function renderBackupsList() {
  updatePersistenceStatus();
  updateExportIndicators();
  const container = document.getElementById('backups-list-container');
  if (!container) return;
  const backups = getStoredBackups();

  if (backups.length === 0) {
    container.innerHTML = '<div style="color:var(--text-tertiary); font-style:italic; padding:12px 0;">Noch keine Sicherungspunkte vorhanden.</div>';
    return;
  }

  container.innerHTML = '';
  backups.forEach(b => {
    const card = document.createElement('div');
    card.className = 'backup-card';
    card.innerHTML = `
      <div class="backup-info">
        <div class="backup-time">${escapeHtml(b.dateFormatted)}</div>
        <div class="backup-desc">${escapeHtml(b.desc)}</div>
        <div class="backup-stats">${b.stats.activeTowns} aktive Orte • ${b.stats.nuclei} Nuklei • ${b.stats.activities} Aktivitäten • ${b.stats.deployments} Pfeile</div>
      </div>
      <div class="backup-actions">
        <button class="btn btn-secondary btn-restore-item" style="padding: 4px 10px; font-size: 11px;" data-backup-id="${b.id}">Wiederherstellen</button>
      </div>
    `;
    card.querySelector('.btn-restore-item').addEventListener('click', () => {
      restoreBackup(b.id);
    });
    container.appendChild(card);
  });
}

// --- Silky Smooth 60fps Wheel & Trackpad Zoom Engine ---
L.Map.mergeOptions({
  smoothWheelZoom: true,
  smoothSensitivity: 1.2
});

L.Map.SmoothWheelZoom = L.Handler.extend({
  addHooks: function () {
    L.DomEvent.on(this._map._container, 'wheel', this._onWheelScroll, this);
  },

  removeHooks: function () {
    L.DomEvent.off(this._map._container, 'wheel', this._onWheelScroll, this);
  },

  _onWheelScroll: function (e) {
    if (!this._map.options.smoothWheelZoom) return;
    if (this._map._animatingZoom) return; // Do not disrupt programmatic flyToBounds animations
    L.DomEvent.stop(e);

    const map = this._map;
    const container = map._container;
    const rect = container.getBoundingClientRect();
    const mousePos = L.point(e.clientX - rect.left, e.clientY - rect.top);

    this._mousePos = mousePos;

    // Normalize delta across Mac trackpads, Magic Mouse, and classic mouse wheels
    let delta = -e.deltaY;
    if (e.deltaMode === 1) delta *= 40; // Firefox line mode
    else if (e.deltaMode === 2) delta *= 800; // Page mode

    // Pinch gesture on Mac trackpad emits e.ctrlKey = true
    const isPinch = e.ctrlKey;
    const factor = isPinch ? 0.01 : 0.0028;
    const sensitivity = map.options.smoothSensitivity || 1.2;
    const dZoom = delta * factor * sensitivity;

    const prevTarget = this._isZooming ? this._targetZoom : map.getZoom();
    this._targetZoom = Math.min(
      map.getMaxZoom(),
      Math.max(map.getMinZoom(), prevTarget + dZoom)
    );

    if (!this._isZooming) {
      this._isZooming = true;
      this._zoomAnimation();
    }
  },

  _zoomAnimation: function () {
    if (!this._isZooming) return;

    const map = this._map;
    const currentZoom = map.getZoom();
    const diff = this._targetZoom - currentZoom;

    if (Math.abs(diff) < 0.004) {
      map.setZoomAround(this._mousePos, this._targetZoom, { animate: false });
      this._isZooming = false;
      map.fire('zoomend');
      return;
    }

    // 60fps exponential easing for fluid glide
    const step = diff * 0.24;
    map.setZoomAround(this._mousePos, currentZoom + step, { animate: false });

    requestAnimationFrame(this._zoomAnimation.bind(this));
  }
});

L.Map.addInitHook('addHandler', 'smoothWheelZoom', L.Map.SmoothWheelZoom);

// --- Map Setup ---
function initMap() {
  AppState.map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    boxZoom: true,
    doubleClickZoom: true,
    scrollWheelZoom: false, // SmoothWheelZoom handles mousewheel & trackpad
    smoothWheelZoom: true,
    smoothSensitivity: 1.2,
    minZoom: 8,
    maxZoom: 16,
    zoomSnap: 0.2,
    zoomDelta: 0.5
  }).setView([49.405, 8.465], 10.4);

  L.control.zoom({ position: 'bottomright' }).addTo(AppState.map);

  AppState.map.createPane('townPerimeterPane');
  AppState.map.getPane('townPerimeterPane').style.zIndex = 415;
  AppState.map.getPane('townPerimeterPane').style.pointerEvents = 'none';

  AppState.markersLayer = L.layerGroup().addTo(AppState.map);

  AppState.map.on('click', (e) => {
    closeQuickPopover();
    if (e && e.originalEvent && e.originalEvent.target) {
      if (e.originalEvent.target.closest && (e.originalEvent.target.closest('#arrow-quick-hud') || e.originalEvent.target.closest('.arrow-svg-layer'))) {
        return;
      }
    }
    closeArrowQuickHUD();
  });

  AppState.map.on('zoomend moveend resize', () => {
    refreshAllStyles();
    refreshMarkers();
    updateNavigationHUD();
    renderArrows();
  });

  AppState.map.on('move drag zoom viewreset', () => {
    renderArrows();
  });
}

// --- Surrounding Regions ---
function renderSurroundingRegions() {
  if (typeof SURROUNDING_KREISE === 'undefined') return;

  AppState.surroundingLayer = L.geoJSON(SURROUNDING_KREISE, {
    style: {
      fillColor: '#f1f5f9',
      fillOpacity: 0.65,
      color: '#cbd5e1',
      weight: 1.2,
      dashArray: '3, 4'
    },
    interactive: false
  }).addTo(AppState.map);

  const regionalLabels = [
    { name: "Rheinhessen-Pfalz", coords: [49.52, 7.82], isRegion: true },
    { name: "Darmstadt-Aschaffenburg", coords: [49.65, 8.65], isRegion: true },
    { name: "Heilbronn-Tauber", coords: [49.30, 9.15], isRegion: true },
    { name: "Baden-Nordschwarzwald", coords: [49.12, 8.45], isRegion: true },
  ];

  regionalLabels.forEach(item => {
    const icon = L.divIcon({
      className: item.isRegion ? 'surrounding-region-label' : 'surrounding-city-label',
      html: `<span>${item.name}</span>`,
      iconSize: [item.isRegion ? 160 : 100, 20],
      iconAnchor: [item.isRegion ? 80 : 50, 10]
    });
    L.marker(item.coords, { icon: icon, interactive: false }).addTo(AppState.surroundingLayer);
  });
}

// --- Geographic Landmarks (Motorways, Bundesstraßen, Rivers & Streams) ---
function renderGeographicLandmarks() {
  if (typeof GEOGRAPHIC_LANDMARKS === 'undefined') return;

  AppState.landmarksLayer = L.geoJSON(GEOGRAPHIC_LANDMARKS, {
    style: (feature) => {
      const type = feature.properties.type;
      if (type === 'river') {
        return { color: '#0284c7', weight: 4.5, opacity: 0.75, lineCap: 'round' };
      } else if (type === 'stream') {
        return { color: '#38bdf8', weight: 2.2, opacity: 0.65, dashArray: '2, 3' };
      } else if (type === 'motorway') {
        return { color: '#64748b', weight: 3, opacity: 0.5, lineCap: 'round' };
      } else if (type === 'trunk') {
        return { color: '#94a3b8', weight: 2, opacity: 0.45, dashArray: '4, 4' };
      }
      return { color: '#cbd5e1', weight: 1.5 };
    },
    interactive: true,
    onEachFeature: (feature, layer) => {
      const p = feature.properties;
      const label = p.type === 'river' || p.type === 'stream' ? `Fluss: ${p.name}` : `Straße: ${p.name}`;
      layer.bindTooltip(label, { sticky: true, opacity: 0.9 });
    }
  }).addTo(AppState.map);
}

// --- Focused Stadtteil Drill-Down & Automatic Zoom ---
function focusTownDistricts(townId) {
  const feat = AppState.townFeaturesById[townId];
  const layer = AppState.townLayersById[townId];
  if (!feat || !layer || !AppState.map) return;

  AppState.focusedTownId = townId;
  AppState.selectedTownId = townId;
  AppState.selectedDistrictId = null;

  const drawer = document.getElementById('details-drawer');
  const drawerWidth = drawer && !drawer.classList.contains('collapsed') ? Math.min(window.innerWidth * 0.45, 420) : 40;
  AppState.map.fitBounds(layer.getBounds(), {
    maxZoom: 14,
    paddingTopLeft: [50, 40],
    paddingBottomRight: [drawerWidth + 30, 40],
    animate: true
  });

  const distCount = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === townId).length;
  selectTown(townId, false);
  if (distCount > 0) {
    switchDrawerTab('districts');
    const firstDist = Object.values(AppState.districtFeaturesById).find(df => df.properties.townId === townId);
    if (firstDist) {
      AppState.selectedDistrictId = firstDist.properties.id;
      updateMilestoneHeaderAndSelection();
      renderDistrictsListForTown(townId);
    }
  }

  refreshAllStyles();
  refreshMarkers();
  updateNavigationHUD();
}

function focusDistrictOnMap(districtId) {
  const feat = AppState.districtFeaturesById[districtId];
  const layer = AppState.districtLayersById[districtId];
  if (!feat || !layer || !AppState.map) return;

  AppState.focusedTownId = feat.properties.townId;
  AppState.selectedTownId = feat.properties.townId;
  AppState.selectedDistrictId = districtId;

  const drawer = document.getElementById('details-drawer');
  const drawerWidth = drawer && !drawer.classList.contains('collapsed') ? Math.min(window.innerWidth * 0.45, 420) : 40;

  AppState.map.fitBounds(layer.getBounds(), {
    maxZoom: 15,
    paddingTopLeft: [50, 40],
    paddingBottomRight: [drawerWidth + 30, 40],
    animate: true
  });

  selectDistrict(districtId, false);
  refreshAllStyles();
  refreshMarkers();
  updateNavigationHUD();
}

function zoomToClusterOverview(animate = true) {
  closeQuickPopover();
  AppState.focusedTownId = null;
  AppState.selectedTownId = null;
  AppState.selectedDistrictId = null;

  const drawer = document.getElementById('details-drawer');
  if (drawer) {
    drawer.classList.add('collapsed');
  }

  const navBar = document.getElementById('zoom-nav-bar');
  if (navBar) navBar.style.display = 'none';
  const banner = document.getElementById('focus-banner');
  if (banner) banner.style.display = 'none';
  const separator = document.getElementById('nav-separator');
  if (separator) separator.style.display = 'none';

  if (AppState.map && AppState.geoJsonLayer) {
    AppState.map.fitBounds(AppState.geoJsonLayer.getBounds(), {
      padding: [12, 12],
      animate: animate,
      duration: 0.8
    });
  }

  refreshAllStyles();
  refreshMarkers();
  updateNavigationHUD();
}

function exitDistrictFocus() {
  zoomToClusterOverview(true);
}

// --- SVG Arrow Layer ---
function initArrowSvgLayer() {
  const container = AppState.map.getContainer();
  
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "arrow-svg-layer");
  svg.style.position = "absolute";
  svg.style.left = "0px";
  svg.style.top = "0px";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none";
  svg.style.zIndex = "450";
  
  container.appendChild(svg);
  AppState.arrowSvgLayer = svg;
}

// --- Milestone Colors ---
const MILESTONE_COLORS = {
  none: { fill: '#ffffff', border: '#1e293b', text: '#64748b' },
  pg: { fill: '#86efac', border: '#16a34a', text: '#14532d' },
  ipg: { fill: '#22c55e', border: '#15803d', text: '#052e16' },
  ipg_plus: { fill: '#15803d', border: '#052e16', text: '#ffffff' }
};

// --- Level of Detail & District Mode Helper ---
function isTownInDistrictMode(townId) {
  const hasDistricts = Object.values(AppState.districtFeaturesById).some(df => df.properties.townId === townId);
  if (!hasDistricts) return false;
  // When a specific town is focused, ONLY expand that town to maintain a clean, uncluttered map
  if (AppState.focusedTownId) {
    return townId === AppState.focusedTownId;
  }
  // When zooming in manually, reveal Stadtteile at zoom >= 12.0
  const currentZoom = AppState.map ? AppState.map.getZoom() : 10;
  return currentZoom >= 12.0;
}

// --- Navigation Breadcrumb HUD Sync ---
function updateNavigationHUD() {
  const navBar = document.getElementById('zoom-nav-bar');
  const separator = document.getElementById('nav-separator');
  const banner = document.getElementById('focus-banner');
  const bannerText = document.getElementById('focus-banner-text');
  if (!navBar || !banner || !bannerText) return;

  const currentZoom = AppState.map ? AppState.map.getZoom() : 10;
  const isZoomed = currentZoom >= 11;

  if (AppState.selectedDistrictId) {
    const distFeat = AppState.districtFeaturesById[AppState.selectedDistrictId];
    const townFeat = AppState.townFeaturesById[AppState.focusedTownId || (distFeat ? distFeat.properties.townId : null)];
    const townName = townFeat ? townFeat.properties.name : (distFeat ? distFeat.properties.townName : '');
    const distName = distFeat ? distFeat.properties.name : 'Stadtteil';

    navBar.style.display = 'flex';
    if (separator) separator.style.display = 'inline-flex';
    banner.style.display = 'inline-flex';
    bannerText.textContent = townName ? `${townName} › ${distName}` : distName;
  } else if (AppState.focusedTownId) {
    const feat = AppState.townFeaturesById[AppState.focusedTownId];
    const name = feat ? feat.properties.name : 'Ortschaft';

    navBar.style.display = 'flex';
    if (separator) separator.style.display = 'inline-flex';
    banner.style.display = 'inline-flex';
    bannerText.textContent = name;
  } else if (AppState.selectedTownId && isZoomed) {
    const feat = AppState.townFeaturesById[AppState.selectedTownId];
    const name = feat ? feat.properties.name : 'Ortschaft';

    navBar.style.display = 'flex';
    if (separator) separator.style.display = 'inline-flex';
    banner.style.display = 'inline-flex';
    bannerText.textContent = name;
  } else if (isZoomed) {
    navBar.style.display = 'flex';
    if (separator) separator.style.display = 'none';
    banner.style.display = 'none';
  } else {
    navBar.style.display = 'none';
    if (separator) separator.style.display = 'none';
    banner.style.display = 'none';
  }
}

// --- Polygon Styles (Towns) ---
function getTownStyle(feature) {
  const id = feature.properties.id;
  const town = AppState.towns[id] || { milestone: 'none', nuclei: 0, activities: {} };

  if (isTownInDistrictMode(id)) {
    // When in district mode, this city's interior is rendered by its individual Stadtteile.
    // The overarching municipal perimeter is rendered sharply on top by townPerimeterLayer.
    return {
      fillOpacity: 0,
      opacity: 0,
      weight: 0,
      interactive: false
    };
  }

  const isSelected = AppState.selectedTownId === id && !AppState.selectedDistrictId;
  const isArrowSource = AppState.arrowSourceId === id;
  const isCenter = town.isCenter;

  let fillColor = '#ffffff';
  let borderColor = 'rgba(100, 116, 139, 0.28)';
  let fillOpacity = 0.88;
  let weight = 1.0;

  if (AppState.visualViewMode === 'milestone') {
    if (town.milestone === 'custom' && town.customColor) {
      fillColor = town.customColor;
      borderColor = darkenColor(town.customColor, 20);
      weight = 1.8;
      fillOpacity = 0.95;
    } else if (town.milestone !== 'none') {
      const mc = MILESTONE_COLORS[town.milestone] || MILESTONE_COLORS.none;
      fillColor = mc.fill;
      borderColor = mc.border;
      weight = town.milestone === 'ipg_plus' ? 2.2 : (town.milestone === 'ipg' ? 1.9 : 1.6);
      fillOpacity = 0.95;
    }
  } else if (AppState.visualViewMode === 'activities') {
    const totalActs = calculateTotalActivities(town.activities);
    if (totalActs > 0) {
      if (totalActs <= 2) fillColor = '#bbf7d0';
      else if (totalActs <= 5) fillColor = '#4ade80';
      else if (totalActs <= 10) fillColor = '#22c55e';
      else fillColor = '#15803d';
      borderColor = darkenColor(fillColor, 15);
      weight = 1.8;
      fillOpacity = 0.95;
    }
  } else if (AppState.visualViewMode === 'nuclei') {
    const n = town.nuclei || 0;
    if (n > 0) {
      if (n === 1) fillColor = '#a7f3d0';
      else if (n <= 3) fillColor = '#10b981';
      else fillColor = '#047857';
      borderColor = darkenColor(fillColor, 15);
      weight = 1.8;
      fillOpacity = 0.95;
    }
  }

  return {
    fillColor: fillColor,
    fillOpacity: isSelected || isArrowSource ? 0.98 : fillOpacity,
    color: isArrowSource ? '#007aff' : (isSelected ? '#007aff' : (isCenter ? '#f59e0b' : borderColor)),
    weight: isArrowSource ? 3.5 : (isSelected ? 3.2 : (isCenter ? 2.4 : weight)),
    opacity: 0.95,
    dashArray: isArrowSource ? '4, 4' : null,
    interactive: true
  };
}

// --- Overarching Municipality Perimeter Style (Zoom-In & Detail Mode) ---
function getTownPerimeterStyle(feature) {
  const id = feature.properties.id;
  const inDistrictMode = isTownInDistrictMode(id);

  if (!inDistrictMode) {
    return { opacity: 0, fillOpacity: 0, weight: 0 };
  }

  const isSelected = AppState.selectedTownId === id;
  const town = AppState.towns[id];
  const isCenter = town && town.isCenter;

  return {
    fillOpacity: 0,
    opacity: 0.95,
    color: isSelected ? '#007aff' : (isCenter ? '#d97706' : '#1e293b'),
    weight: isSelected ? 4.0 : 3.0,
    dashArray: null,
    lineJoin: 'round',
    lineCap: 'round',
    interactive: false
  };
}

// --- Polygon Styles (Districts) ---
function getDistrictStyle(feature) {
  const townId = feature.properties.townId;
  const id = feature.properties.id;

  if (!isTownInDistrictMode(townId)) {
    return { opacity: 0, fillOpacity: 0, interactive: false };
  }

  const dist = AppState.districts[id] || { milestone: 'none', nuclei: 0, activities: {} };

  let fillColor = '#ffffff';
  let borderColor = '#94a3b8'; // subtle Slate 400 for internal district dividers
  let fillOpacity = 0.94;
  let weight = 1.2;
  let dashArray = null;

  if (AppState.visualViewMode === 'milestone') {
    if (dist.milestone === 'custom' && dist.customColor) {
      fillColor = dist.customColor;
      borderColor = darkenColor(dist.customColor, 20);
    } else if (dist.milestone !== 'none') {
      const mc = MILESTONE_COLORS[dist.milestone] || MILESTONE_COLORS.none;
      fillColor = mc.fill;
      borderColor = mc.border;
    } else {
      dashArray = '2, 3'; // gentle dashed line for unstarted districts
    }
  } else if (AppState.visualViewMode === 'activities') {
    const totalActs = calculateTotalActivities(dist.activities);
    if (totalActs > 0) {
      if (totalActs <= 1) fillColor = '#bbf7d0';
      else if (totalActs <= 3) fillColor = '#4ade80';
      else fillColor = '#15803d';
      borderColor = darkenColor(fillColor, 15);
    } else {
      dashArray = '2, 3';
    }
  } else if (AppState.visualViewMode === 'nuclei') {
    const n = dist.nuclei || 0;
    if (n > 0) {
      if (n === 1) fillColor = '#34d399';
      else fillColor = '#047857';
      borderColor = darkenColor(fillColor, 15);
    } else {
      dashArray = '2, 3';
    }
  }

  const isSelected = AppState.selectedDistrictId === id;
  const isArrowSource = AppState.arrowSourceId === id;

  if (isSelected || isArrowSource) {
    borderColor = '#007aff';
    weight = 3;
    dashArray = isArrowSource ? '3, 3' : null;
  }

  return {
    fillColor: fillColor,
    fillOpacity: isSelected || isArrowSource ? 0.98 : fillOpacity,
    color: borderColor,
    weight: weight,
    dashArray: dashArray,
    opacity: 0.9,
    interactive: true
  };
}

// --- Render GeoJSON Layers ---
function renderGeoJson() {
  if (AppState.geoJsonLayer) {
    AppState.map.removeLayer(AppState.geoJsonLayer);
  }
  AppState.townLayersById = {};

  AppState.geoJsonLayer = L.geoJSON(RHEIN_NECKAR_GEOJSON, {
    style: getTownStyle,
    onEachFeature: (feature, layer) => {
      const id = feature.properties.id;
      AppState.townLayersById[id] = layer;

      updateTownTooltip(id);

      layer.on({
        mouseover: (e) => {
          if (!isTownInDistrictMode(id)) {
            const currentStyle = getTownStyle(feature);
            layer.setStyle({
              weight: 2.4,
              color: '#007aff',
              fillColor: currentStyle.fillColor === '#ffffff' ? '#f8fafc' : currentStyle.fillColor,
              fillOpacity: 0.98
            });
          }
        },
        mouseout: (e) => {
          if (!isTownInDistrictMode(id)) {
            layer.setStyle(getTownStyle(feature));
          }
        },
        click: (e) => {
          if (!isTownInDistrictMode(id)) {
            handleTownClick(id, e.latlng);
          }
        }
      });
    }
  }).addTo(AppState.map);

  AppState.map.fitBounds(AppState.geoJsonLayer.getBounds(), { padding: [12, 12] });
}

function renderDistrictsGeoJson() {
  if (typeof RHEIN_NECKAR_DISTRICTS === 'undefined') return;

  if (AppState.districtsLayer) {
    AppState.map.removeLayer(AppState.districtsLayer);
  }
  AppState.districtLayersById = {};

  AppState.districtsLayer = L.geoJSON(RHEIN_NECKAR_DISTRICTS, {
    style: getDistrictStyle,
    onEachFeature: (feature, layer) => {
      const id = feature.properties.id;
      AppState.districtLayersById[id] = layer;

      updateDistrictTooltip(id);

      layer.on({
        mouseover: (e) => {
          if (isTownInDistrictMode(feature.properties.townId)) {
            layer.setStyle({ weight: 2.6, color: '#007aff', fillOpacity: 0.98 });
          }
        },
        mouseout: (e) => {
          if (isTownInDistrictMode(feature.properties.townId)) {
            layer.setStyle(getDistrictStyle(feature));
          }
        },
        click: (e) => {
          if (isTownInDistrictMode(feature.properties.townId)) {
            handleDistrictClick(id, e.latlng);
          }
        }
      });
    }
  }).addTo(AppState.map);

  refreshMarkers();
}

function renderTownPerimeterLayer() {
  if (typeof RHEIN_NECKAR_GEOJSON === 'undefined' || !AppState.map) return;

  if (AppState.townPerimeterLayer) {
    AppState.map.removeLayer(AppState.townPerimeterLayer);
  }

  AppState.townPerimeterLayer = L.geoJSON(RHEIN_NECKAR_GEOJSON, {
    pane: 'townPerimeterPane',
    style: getTownPerimeterStyle,
    interactive: false
  }).addTo(AppState.map);
}

function updateTownTooltip(townId) {
  const layer = AppState.townLayersById[townId];
  const feature = AppState.townFeaturesById[townId];
  const town = AppState.towns[townId];
  if (!layer || !feature || !town) return;

  if (isTownInDistrictMode(townId)) {
    layer.unbindTooltip();
    return;
  }

  const totalActs = calculateTotalActivities(town.activities);
  const milestoneLabel = getMilestoneLabel(town.milestone);
  const centerBadge = town.isCenter ? '<span style="color:var(--system-orange); margin-left:4px;">★ Zentrum</span>' : '';
  const distCount = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === townId).length;

  const tooltipContent = `
    <div class="tt-title">${escapeHtml(feature.properties.name)} ${centerBadge}</div>
    <div class="tt-row"><span>Status:</span> <span class="tt-val">${milestoneLabel}</span></div>
    <div class="tt-row"><span>Nuklei:</span> <span class="tt-val">${town.nuclei || 0}</span></div>
    <div class="tt-row"><span>Kernaktivitäten:</span> <span class="tt-val">${totalActs}</span></div>
    ${distCount > 0 ? `<div style="margin-top:5px; font-size:10px; color:var(--system-blue); font-weight:600;">Klick: Auf Stadtteile heranzoomen (${distCount} Stadtteile)</div>` : `<div style="margin-top:5px; font-size:10px; color:var(--text-tertiary);">Einheitliche Kommune</div>`}
  `;

  layer.unbindTooltip();
  layer.bindTooltip(tooltipContent, {
    sticky: true,
    direction: 'top',
    opacity: 0.98
  });
}

function updateDistrictTooltip(districtId) {
  const layer = AppState.districtLayersById[districtId];
  const feature = AppState.districtFeaturesById[districtId];
  const dist = AppState.districts[districtId];
  if (!layer || !feature || !dist) return;

  const totalActs = calculateTotalActivities(dist.activities);
  const milestoneLabel = getMilestoneLabel(dist.milestone);

  const tooltipContent = `
    <div style="font-size:10.5px; font-weight:700; color:var(--text-tertiary); text-transform:uppercase; letter-spacing:0.4px;">${escapeHtml(feature.properties.townName)}</div>
    <div class="tt-title" style="margin-top:2px;"><span style="color:var(--system-blue); font-weight:bold;">↳</span> Unterpunkt: ${escapeHtml(feature.properties.name)}</div>
    <div class="tt-row"><span>Status:</span> <span class="tt-val">${milestoneLabel}</span></div>
    <div class="tt-row"><span>Nuklei:</span> <span class="tt-val">${dist.nuclei || 0}</span></div>
    <div class="tt-row"><span>Kernaktivitäten:</span> <span class="tt-val">${totalActs}</span></div>
  `;

  layer.unbindTooltip();
  layer.bindTooltip(tooltipContent, {
    sticky: true,
    direction: 'top',
    opacity: 0.98
  });
}

// --- Subtle Cartographic Markers & Labels ---
const CARTOGRAPHIC_ANCHORS = new Set([
  'Heidelberg', 'Mannheim', 'Ludwigshafen am Rhein', 'Speyer',
  'Weinheim', 'Sinsheim', 'Wiesloch', 'Schwetzingen', 'Bad Dürkheim',
  'Frankenthal (Pfalz)', 'Leimen', 'Walldorf', 'Hockenheim', 'Eberbach',
  'Neustadt an der Weinstraße', 'Grünstadt'
]);

const MUNICIPALITY_POPULATION = {
  'Mannheim': 315000, 'Ludwigshafen am Rhein': 172000, 'Heidelberg': 160000,
  'Speyer': 51000, 'Frankenthal (Pfalz)': 49000, 'Neustadt an der Weinstraße': 54000,
  'Weinheim': 45500, 'Sinsheim': 36000, 'Leimen': 27000, 'Wiesloch': 27000,
  'Schwetzingen': 21800, 'Hockenheim': 21700, 'Bad Dürkheim': 18800, 'Haßloch': 20400,
  'Schifferstadt': 20500, 'Walldorf': 15600, 'Grünstadt': 14000, 'Schriesheim': 15000,
  'Sandhausen': 15400, 'Brühl': 14300, 'Edingen-Neckarhausen': 14200, 'Dossenheim': 12500,
  'Ketsch': 13000, 'Mutterstadt': 13000, 'Nußloch': 11300, 'Ladenburg': 12500,
  'Limburgerhof': 11600, 'Bobenheim-Roxheim': 10100, 'Böhl-Iggelheim': 10500,
  'Eberbach': 14400, 'Römerberg': 9800, 'St. Leon-Rot': 13900, 'Oftersheim': 12200,
  'Plankstadt': 10500, 'Heddesheim': 11800, 'Hemsbach': 11800, 'Hirschberg an der Bergstraße': 9800,
  'Mühlhausen': 8700, 'Rauenberg': 8700, 'Dielheim': 9000, 'Bammental': 6600,
  'Neckargemünd': 13500, 'Reilingen': 8000, 'Altlußheim': 6300, 'Neulußheim': 7100,
  'Waldsee': 5900, 'Dudenhofen': 6000, 'Altrip': 7700, 'Maxdorf': 7200,
  'Dannstadt-Schauernheim': 7400, 'Deidesheim': 3800, 'Freinsheim': 5000,
  'Weisenheim am Sand': 4300, 'Weisenheim am Berg': 1700, 'Bobenheim am Berg': 850,
  'Gerolsheim': 1800, 'Dackenheim': 450, 'Erpolzheim': 1350, 'Großkarlbach': 1150,
  'Kleinkarlbach': 900, 'Bissersheim': 450, 'Battenberg (Pfalz)': 400,
  'Altleiningen': 1750, 'Neuleiningen': 800, 'Carlsberg': 3500, 'Wattenheim': 1600,
  'Hettenleidelheim': 3000, 'Tiefenthal': 850, 'Ebertsheim': 1250, 'Kindenheim': 1000,
  'Bockenheim an der Weinstraße': 2200, 'Kirchheim an der Weinstraße': 1900,
  'Obersülzen': 700, 'Dirmstein': 3000, 'Laumersheim': 900, 'Großniedesheim': 1350,
  'Kleinniedesheim': 950, 'Heßheim': 3100, 'Heuchelheim bei Frankenthal': 1250,
  'Beindersheim': 3350, 'Lambsheim': 7000, 'Birkenheide': 3200, 'Fußgönheim': 2600,
  'Rödersheim-Gronau': 2900, 'Hochdorf-Assenheim': 3200, 'Neuhofen': 7200,
  'Otterstadt': 3400, 'Harthausen': 3100, 'Hanhofen': 2600, 'Wachenheim an der Weinstraße': 4600,
  'Kallstadt': 1200, 'Herxheim am Berg': 700,
  'Ellerstadt': 2400, 'Friedelsheim': 1450, 'Gönnheim': 1600, 'Niederkirchen bei Deidesheim': 2350,
  'Forst an der Weinstraße': 800, 'Ruppertsberg': 1450, 'Meckenheim': 3400,
  'Lambrecht (Pfalz)': 4000, 'Lindenberg': 1100, 'Neidenfels': 800, 'Frankeneck': 800,
  'Esthal': 1350, 'Weidenthal': 1800, 'Elmstein': 2400, 'Angelbachtal': 5100,
  'Eppelheim': 15300, 'Eschelbronn': 2700, 'Epfenbach': 2400, 'Gaiberg': 2400,
  'Heddesbach': 460, 'Heiligkreuzsteinach': 2600, 'Helmstadt-Bargen': 3800,
  'Ilvesheim': 9300, 'Laudenbach': 6400, 'Lobbach': 2400, 'Malsch': 3500,
  'Mauer': 4100, 'Meckesheim': 5200, 'Neckarbischofsheim': 4100, 'Neidenstein': 1800,
  'Reichartshausen': 2100, 'Schönau': 4400, 'Schönbrunn': 2900, 'Spechbach': 1700,
  'Waibstadt': 5700, 'Wiesenbach': 3100, 'Wilhelmsfeld': 3200, 'Zuzenhausen': 2200,
  'Mertesheim': 400, 'Obrigheim (Pfalz)': 2800, 'Quirnheim': 800
};

function calculateTownLabelRank(feature, town) {
  let rank = 0;
  const name = feature.properties.name;

  // 1. Entsende-Zentren have highest priority
  if (town.isCenter) rank += 1000000;

  // 2. Milestone achievements
  if (town.milestone && town.milestone !== 'none') {
    if (town.milestone === 'ipg_plus') rank += 600000;
    else if (town.milestone === 'ipg') rank += 500000;
    else if (town.milestone === 'pg') rank += 400000;
    else rank += 350000;
  }

  // 3. Active nuclei and core activities
  const totalActs = calculateTotalActivities(town.activities);
  if (totalActs > 0) rank += 200000 + totalActs * 1000;
  if (town.nuclei > 0) rank += 100000 + town.nuclei * 1000;

  // 4. Anchor cities & kreisfreie Städte
  if (CARTOGRAPHIC_ANCHORS.has(name)) rank += 50000;
  if (feature.properties.isStadtkreis) rank += 30000;

  // 5. Population weighting
  const pop = MUNICIPALITY_POPULATION[name] || 2500;
  rank += pop;

  return rank;
}

function refreshMarkers() {
  if (!AppState.markersLayer) return;
  AppState.markersLayer.clearLayers();

  if (!AppState.showLabels) return;

  const currentZoom = AppState.map ? AppState.map.getZoom() : 10.4;
  const mapSize = AppState.map ? AppState.map.getSize() : { x: 1200, y: 800 };

  // 1. Municipalities (Ortschaften) with Label Collision Detection & Ranking
  if (typeof RHEIN_NECKAR_GEOJSON !== 'undefined') {
    const candidates = [];

    RHEIN_NECKAR_GEOJSON.features.forEach(f => {
      const id = f.properties.id;
      const center = f.properties.center;
      const town = AppState.towns[id];
      if (!center || !town) return;

      // If this town is currently resolved into Stadtteile, render an overarching watermark label
      if (isTownInDistrictMode(id)) {
        const watermarkHtml = `
          <div class="municipality-watermark-label">
            ${escapeHtml(f.properties.name)}
          </div>
        `;
        const customIcon = L.divIcon({
          className: 'subtle-marker-container watermark-container',
          html: watermarkHtml,
          iconSize: [220, 32],
          iconAnchor: [110, 16]
        });
        const marker = L.marker(center, { icon: customIcon, interactive: false, zIndexOffset: -200 });
        candidates.push({ isWatermark: true, marker, rank: 9999999 });
        return;
      }

      const totalActs = calculateTotalActivities(town.activities);
      const isCenter = town.isCenter;
      const isActive = (town.milestone && town.milestone !== 'none') || isCenter || totalActs > 0 || (town.nuclei > 0);
      const name = f.properties.name;
      const ms = town.milestone;
      const msBadgeHtml = (ms && ms !== 'none' && ms !== 'custom') 
        ? `<span class="subtle-badge milestone-badge ms-${escapeHtml(ms)}">${escapeHtml(APP_TERMS.milestones[ms]?.short || ms.toUpperCase())}</span>`
        : '';

      const markerHtml = `
        <div class="subtle-map-label ${isCenter ? 'center' : ''} ${isActive ? 'active-cluster' : 'inactive-town'}">
          ${isCenter ? '<span class="center-star">★</span>' : ''}
          <span>${escapeHtml(name)}</span>
          ${msBadgeHtml}
          ${town.nuclei > 0 ? `<span class="subtle-badge nuclei">${town.nuclei}</span>` : ''}
          ${totalActs > 0 ? `<span class="subtle-badge acts">${totalActs}</span>` : ''}
        </div>
      `;

      // Estimated label dimensions in screen pixels
      const hasBadges = town.nuclei > 0 || totalActs > 0 || (ms && ms !== 'none');
      const boxWidth = Math.max(54, name.length * 7.5 + (hasBadges ? 48 : 14) + (isCenter ? 18 : 0));
      const boxHeight = 22;

      const customIcon = L.divIcon({
        className: 'subtle-marker-container',
        html: markerHtml,
        iconSize: [boxWidth, boxHeight],
        iconAnchor: [boxWidth / 2, boxHeight / 2]
      });


      const marker = L.marker(center, { icon: customIcon, interactive: false });
      const rank = calculateTownLabelRank(f, town);

      candidates.push({
        isWatermark: false,
        marker,
        center,
        rank,
        boxWidth,
        boxHeight,
        name
      });
    });

    // Sort candidates: highest rank first
    candidates.sort((a, b) => b.rank - a.rank);

    const placedBoxes = [];
    candidates.forEach(cand => {
      if (cand.isWatermark) {
        AppState.markersLayer.addLayer(cand.marker);
        return;
      }

      if (!AppState.map) {
        AppState.markersLayer.addLayer(cand.marker);
        return;
      }

      const pt = AppState.map.latLngToContainerPoint(cand.center);
      // Skip if completely outside container
      if (pt.x < -120 || pt.x > mapSize.x + 120 || pt.y < -60 || pt.y > mapSize.y + 60) {
        return;
      }

      // Check collision with already placed higher-priority labels
      const pad = currentZoom < 11.2 ? 5 : (currentZoom < 12.5 ? 3 : 1);
      const box = {
        left: pt.x - cand.boxWidth / 2 - pad,
        right: pt.x + cand.boxWidth / 2 + pad,
        top: pt.y - cand.boxHeight / 2 - pad,
        bottom: pt.y + cand.boxHeight / 2 + pad
      };

      let collides = false;
      // At zoom 13+ there is plenty of space, so allow all labels to display
      if (currentZoom < 13.0) {
        for (let i = 0; i < placedBoxes.length; i++) {
          const b = placedBoxes[i];
          if (!(box.right < b.left || box.left > b.right || box.bottom < b.top || box.top > b.bottom)) {
            collides = true;
            break;
          }
        }
      }

      if (!collides) {
        placedBoxes.push(box);
        AppState.markersLayer.addLayer(cand.marker);
      }
    });
  }

  // 2. Neighborhoods / Districts (Nachbarschaften / Stadtteile)
  if (typeof RHEIN_NECKAR_DISTRICTS !== 'undefined') {
    RHEIN_NECKAR_DISTRICTS.features.forEach(df => {
      const townId = df.properties.townId;
      if (!isTownInDistrictMode(townId)) return;

      const center = df.properties.center;
      const id = df.properties.id;
      const dist = AppState.districts[id];
      if (!center || !dist) return;

      const totalActs = calculateTotalActivities(dist.activities);
      const parentName = df.properties.townName || (AppState.townFeaturesById[townId] ? AppState.townFeaturesById[townId].properties.name : '');

      const markerHtml = `
        <div class="subtle-map-label district">
          <span class="district-parent-kicker">${escapeHtml(parentName)}</span>
          <div class="district-name-row">
            <span class="district-name">${escapeHtml(df.properties.name)}</span>
            ${dist.nuclei > 0 ? `<span class="subtle-badge nuclei">${dist.nuclei}</span>` : ''}
            ${totalActs > 0 ? `<span class="subtle-badge acts">${totalActs}</span>` : ''}
          </div>
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'subtle-marker-container',
        html: markerHtml,
        iconSize: [80, 18],
        iconAnchor: [40, 9]
      });

      const marker = L.marker(center, { icon: customIcon, interactive: false });
      AppState.markersLayer.addLayer(marker);

      if (df.properties.exclaveCenter) {
        const exclaveHtml = `
          <div class="subtle-map-label district exclave" style="opacity: 0.75; font-style: italic;">
            <span class="district-name" style="font-size: 11px;">${escapeHtml(df.properties.name)} (Exklave)</span>
          </div>
        `;
        const exclaveIcon = L.divIcon({
          className: 'subtle-marker-container',
          html: exclaveHtml,
          iconSize: [120, 18],
          iconAnchor: [60, 9]
        });
        const exclaveMarker = L.marker(df.properties.exclaveCenter, { icon: exclaveIcon, interactive: false });
        AppState.markersLayer.addLayer(exclaveMarker);
      }
    });
  }

  renderArrows();
}

function refreshAllStyles() {
  if (AppState.geoJsonLayer) {
    AppState.geoJsonLayer.eachLayer(layer => {
      if (layer.feature) {
        layer.setStyle(getTownStyle(layer.feature));
        updateTownTooltip(layer.feature.properties.id);
      }
    });
  }

  if (AppState.districtsLayer) {
    AppState.districtsLayer.eachLayer(layer => {
      if (layer.feature) {
        layer.setStyle(getDistrictStyle(layer.feature));
        updateDistrictTooltip(layer.feature.properties.id);
      }
    });
  }

  if (AppState.townPerimeterLayer) {
    AppState.townPerimeterLayer.eachLayer(layer => {
      if (layer.feature) {
        layer.setStyle(getTownPerimeterStyle(layer.feature));
      }
    });
  }

  if (AppState.surroundingLayer) {
    if (AppState.showSurrounding) {
      if (!AppState.map.hasLayer(AppState.surroundingLayer)) AppState.surroundingLayer.addTo(AppState.map);
    } else {
      if (AppState.map.hasLayer(AppState.surroundingLayer)) AppState.map.removeLayer(AppState.surroundingLayer);
    }
  }

  if (AppState.landmarksLayer) {
    if (AppState.showLandmarks) {
      if (!AppState.map.hasLayer(AppState.landmarksLayer)) AppState.landmarksLayer.addTo(AppState.map);
    } else {
      if (AppState.map.hasLayer(AppState.landmarksLayer)) AppState.map.removeLayer(AppState.landmarksLayer);
    }
  }

  refreshMarkers();
}

// --- Curved Arrow Engine (With Smart Separation & Fast Interactive HUD) ---
function renderArrows() {
  if (!AppState.arrowSvgLayer || !AppState.map) return;
  
  const svg = AppState.arrowSvgLayer;
  svg.innerHTML = '';

  if (!AppState.showArrows || AppState.deployments.length === 0) return;

  const mapSize = AppState.map.getSize();
  svg.setAttribute("width", mapSize.x);
  svg.setAttribute("height", mapSize.y);
  svg.setAttribute("viewBox", `0 0 ${mapSize.x} ${mapSize.y}`);
  svg.style.width = mapSize.x + "px";
  svg.style.height = mapSize.y + "px";
  svg.style.left = "0px";
  svg.style.top = "0px";
  svg.style.transform = "none";

  // Group deployments connecting the same pair of nodes (in either direction) to prevent overlapping lines
  const pairGroups = {};
  AppState.deployments.forEach((dep) => {
    const key = [dep.fromId, dep.toId].sort().join(':::');
    if (!pairGroups[key]) pairGroups[key] = [];
    pairGroups[key].push(dep);
  });

  AppState.deployments.forEach((dep) => {
    const fromFeat = AppState.districtFeaturesById[dep.fromId] || AppState.townFeaturesById[dep.fromId];
    const toFeat = AppState.districtFeaturesById[dep.toId] || AppState.townFeaturesById[dep.toId];
    if (!fromFeat || !toFeat) return;

    const pA = AppState.map.latLngToContainerPoint(fromFeat.properties.center);
    const pB = AppState.map.latLngToContainerPoint(toFeat.properties.center);

    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 5) return;

    // Normal unit vector pointing perpendicular to direction of travel
    const nx = -dy / dist;
    const ny = dx / dist;

    // Determine curvature offset for multiple parallel or bidirectional connections
    const pairKey = [dep.fromId, dep.toId].sort().join(':::');
    const pairList = pairGroups[pairKey] || [dep];
    const totalInPair = pairList.length;
    const indexInPair = pairList.indexOf(dep);

    const baseCurvature = Math.min(65, Math.max(20, dist * 0.20));
    // Symmetrically fan out multiple arrows connecting the same nodes
    const separationOffset = totalInPair > 1 ? (indexInPair - (totalInPair - 1) / 2) * 22 : 0;
    const curvature = baseCurvature + separationOffset;

    const cpX = (pA.x + pB.x) / 2 + nx * curvature;
    const cpY = (pA.y + pB.y) / 2 + ny * curvature;

    const tangentX = pB.x - cpX;
    const tangentY = pB.y - cpY;
    const tangentLen = Math.hypot(tangentX, tangentY) || 1;
    const ux = tangentX / tangentLen;
    const uy = tangentY / tangentLen;
    const unx = -uy;
    const uny = ux;

    const headLen = 14;
    const headWidth = 6.5;
    const endX = pB.x - ux * (headLen - 2);
    const endY = pB.y - uy * (headLen - 2);

    const pathData = `M ${pA.x} ${pA.y} Q ${cpX} ${cpY} ${endX} ${endY}`;

    // Color based on status or custom
    let arrowColor = dep.color || '#007aff';
    let dashStyle = null;

    if (dep.status === 'planned') {
      arrowColor = '#f59e0b'; // Amber / Gold for planned
      dashStyle = '6, 6';
    } else if (dep.status === 'established') {
      arrowColor = '#16a34a'; // Green for established
    }

    const onArrowClick = (e) => {
      if (e) {
        if (e.stopPropagation) e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
        if (window.L && L.DomEvent) {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
        }
      }
      openArrowQuickHUD(dep);
    };

    // 1. Wide invisible hit-area path for easy, effortless clicking
    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("d", pathData);
    hitPath.setAttribute("fill", "none");
    hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "26");
    hitPath.setAttribute("stroke-linecap", "round");
    hitPath.setAttribute("style", "cursor: pointer; pointer-events: stroke;");
    hitPath.setAttribute("data-dep-id", dep.id);

    hitPath.addEventListener("click", onArrowClick);
    hitPath.addEventListener("touchstart", onArrowClick, { passive: false });
    svg.appendChild(hitPath);

    const isSelected = AppState.activeQuickDeployment && AppState.activeQuickDeployment.id === dep.id;

    // 2. Visible arrow path (no marker-end needed!)
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `arrow-path ${dep.status || 'active'} ${isSelected ? 'selected' : ''}`);
    path.setAttribute("stroke", arrowColor);
    path.setAttribute("stroke-width", isSelected ? "5" : (dep.status === 'established' ? "3.5" : "3"));
    if (dashStyle) path.setAttribute("stroke-dasharray", dashStyle);
    path.setAttribute("data-dep-id", dep.id);
    path.setAttribute("style", "cursor: pointer; pointer-events: stroke;");

    path.addEventListener("click", onArrowClick);
    path.addEventListener("touchstart", onArrowClick, { passive: false });
    svg.appendChild(path);

    // 2b. Direct SVG Arrowhead Polygon (100% canvas & html2canvas compatible, razor sharp)
    const tipX = pB.x;
    const tipY = pB.y;
    const w1X = (pB.x - ux * headLen) + unx * headWidth;
    const w1Y = (pB.y - uy * headLen) + uny * headWidth;
    const w2X = (pB.x - ux * headLen) - unx * headWidth;
    const w2Y = (pB.y - uy * headLen) - uny * headWidth;

    const arrowhead = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    arrowhead.setAttribute("points", `${tipX.toFixed(2)},${tipY.toFixed(2)} ${w1X.toFixed(2)},${w1Y.toFixed(2)} ${w2X.toFixed(2)},${w2Y.toFixed(2)}`);
    arrowhead.setAttribute("fill", arrowColor);
    arrowhead.setAttribute("class", `arrow-head ${dep.status || 'active'} ${isSelected ? 'selected' : ''}`);
    arrowhead.setAttribute("data-dep-id", dep.id);
    arrowhead.setAttribute("style", "cursor: pointer; pointer-events: auto;");
    arrowhead.addEventListener("click", onArrowClick);
    arrowhead.addEventListener("touchstart", onArrowClick, { passive: false });
    svg.appendChild(arrowhead);

    // 3. Animated dash for active arrows
    if (dep.status !== 'planned') {
      const flowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      flowPath.setAttribute("d", pathData);
      flowPath.setAttribute("class", "arrow-flow-dash");
      flowPath.setAttribute("style", "pointer-events: none;");
      svg.appendChild(flowPath);
    }

    // 4. Midpoint Node Badge
    const midX = 0.25 * pA.x + 0.5 * cpX + 0.25 * endX;
    const midY = 0.25 * pA.y + 0.5 * cpY + 0.25 * endY;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", `arrow-midpoint-node ${isSelected ? 'selected' : ''}`);
    group.setAttribute("transform", `translate(${midX}, ${midY})`);
    group.setAttribute("style", "cursor: pointer; pointer-events: auto;");
    group.addEventListener("click", onArrowClick);
    group.addEventListener("touchstart", onArrowClick, { passive: false });

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("r", "11");
    circle.setAttribute("fill", "#ffffff");
    circle.setAttribute("stroke", arrowColor);
    circle.setAttribute("stroke-width", "2");
    circle.setAttribute("filter", "drop-shadow(0 2px 4px rgba(0,0,0,0.15))");
    group.appendChild(circle);

    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "central");
    text.setAttribute("font-size", "10");
    text.setAttribute("font-weight", "bold");
    text.setAttribute("fill", arrowColor);
    
    if (dep.status === 'planned') {
      text.textContent = "⏳";
    } else if (dep.status === 'established') {
      text.textContent = "✓";
    } else {
      text.textContent = dep.count ? `${dep.count}` : "➔";
    }
    group.appendChild(text);

    svg.appendChild(group);
  });
}

function openArrowQuickHUD(dep) {
  const prevId = AppState.activeQuickDeployment ? AppState.activeQuickDeployment.id : null;
  AppState.activeQuickDeployment = dep;
  if (prevId !== dep.id) {
    renderArrows();
  }

  const hud = document.getElementById('arrow-quick-hud');
  if (!hud) return;

  const titleElem = document.getElementById('quick-dep-names');
  if (titleElem) titleElem.textContent = `${dep.fromName} ➔ ${dep.toName}`;

  const typeElem = document.getElementById('quick-dep-type');
  if (typeElem) typeElem.textContent = dep.type;

  const countElem = document.getElementById('quick-dep-count');
  if (countElem) countElem.textContent = dep.count ? `${dep.count} Pers.` : '1 Pers.';

  const dot = document.getElementById('quick-dep-dot');
  let arrowColor = dep.color || '#007aff';
  if (dep.status === 'planned') arrowColor = '#f59e0b';
  else if (dep.status === 'established') arrowColor = '#16a34a';
  if (dot) dot.style.background = arrowColor;

  document.querySelectorAll('.quick-status-pill').forEach(pill => {
    pill.classList.toggle('active', pill.dataset.status === (dep.status || 'active'));
  });

  hud.style.display = 'block';
}

function adjustQuickArrowCount(delta) {
  if (!AppState.activeQuickDeployment) return;
  const dep = AppState.activeQuickDeployment;
  const newCount = Math.max(1, (dep.count || 1) + delta);
  if (newCount === dep.count) return;
  pushHistory(`Personenanzahl für Entsendung ${dep.fromName} ➔ ${dep.toName} auf ${newCount} geändert`);
  dep.count = newCount;
  saveState();
  renderArrows();
  openArrowQuickHUD(dep);
  if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
}

function closeArrowQuickHUD() {
  const hadActive = !!AppState.activeQuickDeployment;
  AppState.activeQuickDeployment = null;
  if (hadActive) {
    renderArrows();
  }
  const hud = document.getElementById('arrow-quick-hud');
  if (hud) hud.style.display = 'none';
}

function setQuickArrowStatus(newStatus) {
  if (!AppState.activeQuickDeployment) return;
  const dep = AppState.activeQuickDeployment;
  pushHistory(`Status von Entsendung ${dep.fromName} ➔ ${dep.toName} geändert`);
  dep.status = newStatus;
  saveState();
  renderArrows();
  openArrowQuickHUD(dep);
  if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
}

function deleteQuickArrow() {
  if (!AppState.activeQuickDeployment) return;
  const dep = AppState.activeQuickDeployment;
  closeArrowQuickHUD();
  deleteDeployment(dep.id);
}

// --- Interaction Handlers & Quick Action Popover (Apple-Style) ---
function showTownQuickPopover(townId, latlng) {
  const feature = AppState.townFeaturesById[townId];
  const town = AppState.towns[townId];
  if (!feature || !town || !AppState.map) return;

  const targetCoords = latlng || feature.properties.center || [49.4, 8.5];

  AppState.selectedTownId = townId;
  AppState.selectedDistrictId = null;
  refreshAllStyles();

  const distCount = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId).length;
  const totalActs = calculateTotalActivities(town.activities);
  const ms = town.milestone || 'none';
  const connectedDeps = AppState.deployments.filter(d => d.fromId === townId || d.toId === townId);

  const container = document.createElement('div');
  container.className = 'quick-action-popover';
  container.innerHTML = `
    <div class="qpop-header">
      <div class="qpop-title-col">
        <h4 class="qpop-name">${escapeHtml(feature.properties.name)}</h4>
        <span class="qpop-sub">${distCount > 0 ? `${distCount} Stadtteile` : escapeHtml(feature.properties.kreis || 'Gemeinde')}</span>
      </div>
      <button class="qpop-center-toggle ${town.isCenter ? 'is-center' : ''}" id="qpop-btn-center" title="Als Entsende-Zentrum umschalten">
        ★ ${town.isCenter ? 'Zentrum' : 'Zentrum'}
      </button>
    </div>

    <div class="qpop-section-label">Wachstumsstufe (1 Klick)</div>
    <div class="qpop-milestones-row">
      <button class="qpop-ms-btn ${ms === 'none' ? 'active' : ''}" data-ms="none" title="${APP_TERMS.milestones.none.standard}">
        <span class="ms-pill-dot none"></span>${APP_TERMS.milestones.none.short}
      </button>
      <button class="qpop-ms-btn ${ms === 'pg' ? 'active' : ''}" data-ms="pg" title="${APP_TERMS.milestones.pg.full}">
        <span class="ms-pill-dot pg"></span>${APP_TERMS.milestones.pg.code}
      </button>
      <button class="qpop-ms-btn ${ms === 'ipg' ? 'active' : ''}" data-ms="ipg" title="${APP_TERMS.milestones.ipg.full}">
        <span class="ms-pill-dot ipg"></span>${APP_TERMS.milestones.ipg.code}
      </button>
      <button class="qpop-ms-btn ${ms === 'ipg_plus' ? 'active' : ''}" data-ms="ipg_plus" title="${APP_TERMS.milestones.ipg_plus.full}">
        <span class="ms-pill-dot ipg-plus"></span>${APP_TERMS.milestones.ipg_plus.code}
      </button>
    </div>

    <div class="qpop-metrics-row">
      <div class="qpop-metric">
        <span class="qpop-metric-val">${town.nuclei || 0}</span>
        <span class="qpop-metric-lbl">Nuklei</span>
      </div>
      <div class="qpop-metric">
        <span class="qpop-metric-val">${totalActs}</span>
        <span class="qpop-metric-lbl">Aktivitäten</span>
      </div>
      <div class="qpop-metric">
        <span class="qpop-metric-val">${connectedDeps.length}</span>
        <span class="qpop-metric-lbl">Pfeile</span>
      </div>
    </div>

    <div class="qpop-actions-row">
      ${distCount > 0 ? `
        <button class="btn btn-secondary btn-sm" id="qpop-btn-districts" style="color:var(--system-blue);font-weight:600;">
          🔍 Stadtteile (${distCount})
        </button>
      ` : ''}
      <button class="btn btn-secondary btn-sm" id="qpop-btn-arrow" title="Entsende-Pfeil von hier starten">
        ➔ Entsendung
      </button>
      <button class="btn btn-primary btn-sm" id="qpop-btn-details" title="Details &amp; Notizen im Inspektor öffnen">
        Details ➔
      </button>
    </div>
  `;

  // Milestone 1-click update
  container.querySelectorAll('.qpop-ms-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newMs = btn.dataset.ms;
      pushHistory(`Meilenstein von ${feature.properties.name} geändert`);
      town.milestone = newMs;
      saveState();
      refreshAllStyles();
      refreshMarkers();
      container.querySelectorAll('.qpop-ms-btn').forEach(b => b.classList.toggle('active', b.dataset.ms === newMs));
      const drawer = document.getElementById('details-drawer');
      if (drawer && !drawer.classList.contains('collapsed') && AppState.selectedTownId === townId) {
        updateMilestoneHeaderAndSelection();
      }
    });
  });

  // Center toggle
  const centerBtn = container.querySelector('#qpop-btn-center');
  if (centerBtn) {
    centerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      pushHistory(`Zentrumsstatus für ${feature.properties.name} geändert`);
      town.isCenter = !town.isCenter;
      saveState();
      refreshAllStyles();
      refreshMarkers();
      centerBtn.classList.toggle('is-center', !!town.isCenter);
      const drawer = document.getElementById('details-drawer');
      if (drawer && !drawer.classList.contains('collapsed') && AppState.selectedTownId === townId) {
        document.getElementById('drawer-is-center').checked = !!town.isCenter;
      }
    });
  }

  // Arrow
  const arrowBtn = container.querySelector('#qpop-btn-arrow');
  if (arrowBtn) {
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.map.closePopup();
      setMode('arrow');
      handleArrowSourceTargetClick(townId, false);
    });
  }

  // Details
  const detailsBtn = container.querySelector('#qpop-btn-details');
  if (detailsBtn) {
    detailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.map.closePopup();
      selectTown(townId, false);
    });
  }

  // Districts
  const distBtn = container.querySelector('#qpop-btn-districts');
  if (distBtn) {
    distBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.map.closePopup();
      focusTownDistricts(townId);
    });
  }

  L.popup({
    className: 'apple-quick-popover-wrapper',
    closeButton: true,
    autoPan: true,
    autoPanPadding: [30, 30],
    maxWidth: 320,
    offset: [0, -6]
  })
  .setLatLng(targetCoords)
  .setContent(container)
  .openOn(AppState.map);
}

function showDistrictQuickPopover(districtId, latlng) {
  const feature = AppState.districtFeaturesById[districtId];
  const dist = AppState.districts[districtId];
  if (!feature || !dist || !AppState.map) return;

  const targetCoords = latlng || feature.properties.center || [49.4, 8.5];

  AppState.selectedDistrictId = districtId;
  refreshAllStyles();

  const totalActs = calculateTotalActivities(dist.activities);
  const ms = dist.milestone || 'none';
  const parentName = feature.properties.townName || (AppState.townFeaturesById[feature.properties.townId] ? AppState.townFeaturesById[feature.properties.townId].properties.name : '');

  const container = document.createElement('div');
  container.className = 'quick-action-popover';
  container.innerHTML = `
    <div class="qpop-header">
      <div class="qpop-title-col">
        <h4 class="qpop-name">${escapeHtml(feature.properties.name)}</h4>
        <span class="qpop-sub">Stadtteil von ${escapeHtml(parentName)}</span>
      </div>
    </div>

    <div class="qpop-section-label">Wachstumsstufe (1 Klick)</div>
    <div class="qpop-milestones-row">
      <button class="qpop-ms-btn ${ms === 'none' ? 'active' : ''}" data-ms="none" title="${APP_TERMS.milestones.none.standard}">
        <span class="ms-pill-dot none"></span>${APP_TERMS.milestones.none.short}
      </button>
      <button class="qpop-ms-btn ${ms === 'pg' ? 'active' : ''}" data-ms="pg" title="${APP_TERMS.milestones.pg.full}">
        <span class="ms-pill-dot pg"></span>${APP_TERMS.milestones.pg.code}
      </button>
      <button class="qpop-ms-btn ${ms === 'ipg' ? 'active' : ''}" data-ms="ipg" title="${APP_TERMS.milestones.ipg.full}">
        <span class="ms-pill-dot ipg"></span>${APP_TERMS.milestones.ipg.code}
      </button>
      <button class="qpop-ms-btn ${ms === 'ipg_plus' ? 'active' : ''}" data-ms="ipg_plus" title="${APP_TERMS.milestones.ipg_plus.full}">
        <span class="ms-pill-dot ipg-plus"></span>${APP_TERMS.milestones.ipg_plus.code}
      </button>
    </div>

    <div class="qpop-metrics-row">
      <div class="qpop-metric">
        <span class="qpop-metric-val">${dist.nuclei || 0}</span>
        <span class="qpop-metric-lbl">Nuklei</span>
      </div>
      <div class="qpop-metric">
        <span class="qpop-metric-val">${totalActs}</span>
        <span class="qpop-metric-lbl">Aktivitäten</span>
      </div>
    </div>

    <div class="qpop-actions-row">
      <button class="btn btn-secondary btn-sm" id="qpop-dist-btn-arrow">
        ➔ Entsendung
      </button>
      <button class="btn btn-primary btn-sm" id="qpop-dist-btn-details">
        Details ➔
      </button>
    </div>
  `;

  container.querySelectorAll('.qpop-ms-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const newMs = btn.dataset.ms;
      pushHistory(`Meilenstein von Stadtteil ${feature.properties.name} geändert`);
      dist.milestone = newMs;
      saveState();
      refreshAllStyles();
      refreshMarkers();
      container.querySelectorAll('.qpop-ms-btn').forEach(b => b.classList.toggle('active', b.dataset.ms === newMs));
      const drawer = document.getElementById('details-drawer');
      if (drawer && !drawer.classList.contains('collapsed') && AppState.selectedDistrictId === districtId) {
        updateMilestoneHeaderAndSelection();
      }
    });
  });

  const arrowBtn = container.querySelector('#qpop-dist-btn-arrow');
  if (arrowBtn) {
    arrowBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.map.closePopup();
      setMode('arrow');
      handleArrowSourceTargetClick(districtId, true);
    });
  }

  const detailsBtn = container.querySelector('#qpop-dist-btn-details');
  if (detailsBtn) {
    detailsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.map.closePopup();
      selectDistrict(districtId, false);
    });
  }

  L.popup({
    className: 'apple-quick-popover-wrapper',
    closeButton: true,
    autoPan: true,
    autoPanPadding: [30, 30],
    maxWidth: 320,
    offset: [0, -6]
  })
  .setLatLng(targetCoords)
  .setContent(container)
  .openOn(AppState.map);
}

function closeQuickPopover() {
  if (AppState.map) {
    AppState.map.closePopup();
  }
}

function ensureFeatureVisibleWithDrawer(targetCoords) {
  if (!AppState.map || !targetCoords) return;
  const isMobile = window.innerWidth <= 768;
  const pt = AppState.map.latLngToContainerPoint(targetCoords);
  const mapSize = AppState.map.getSize();

  if (isMobile) {
    // On mobile, the details drawer bottom-sheet covers the lower 52% of the screen
    const visibleHeight = mapSize.y * 0.46;
    if (pt.y > visibleHeight - 30 || pt.y < 30) {
      const targetY = visibleHeight * 0.52;
      const dy = pt.y - targetY;
      AppState.map.panBy([0, dy], { animate: true, duration: 0.35 });
    }
  } else {
    // On desktop, the drawer slides over from the right side (width: 380px)
    const drawerWidth = 380;
    const visibleWidth = mapSize.x - drawerWidth;
    if (pt.x > visibleWidth - 40 || pt.x < 40) {
      const targetX = visibleWidth / 2;
      const dx = pt.x - targetX;
      AppState.map.panBy([dx, 0], { animate: true, duration: 0.35 });
    }
  }
}

function handleTownClick(townId, latlng) {
  closeQuickPopover();
  if (AppState.currentMode === 'inspect') {
    selectTown(townId, false);
    const feature = AppState.townFeaturesById[townId];
    const coords = latlng || (feature && feature.properties ? feature.properties.center : null);
    ensureFeatureVisibleWithDrawer(coords);
  } else if (AppState.currentMode === 'paint') {
    // In Schnell-Einfärben mode: use quick popover for instant coloring
    if (latlng) {
      showTownQuickPopover(townId, latlng);
    } else {
      applyPaintToTown(townId);
    }
  } else if (AppState.currentMode === 'arrow') {
    handleArrowSourceTargetClick(townId, false);
  }
}

function handleDistrictClick(districtId, latlng) {
  closeQuickPopover();
  if (AppState.currentMode === 'inspect') {
    selectDistrict(districtId, false);
    const feature = AppState.districtFeaturesById[districtId];
    const coords = latlng || (feature && feature.properties ? feature.properties.center : null);
    ensureFeatureVisibleWithDrawer(coords);
  } else if (AppState.currentMode === 'paint') {
    if (latlng) {
      showDistrictQuickPopover(districtId, latlng);
    } else {
      applyPaintToDistrict(districtId);
    }
  } else if (AppState.currentMode === 'arrow') {
    handleArrowSourceTargetClick(districtId, true);
  }
}

// --- Selection & Drawer Sync ---
function selectTown(townId, shouldZoom = true) {
  // If we were focused on a different town's districts, exit that previous town's district mode
  if (AppState.focusedTownId && AppState.focusedTownId !== townId) {
    AppState.focusedTownId = null;
    const banner = document.getElementById('focus-banner');
    if (banner) banner.style.display = 'none';
  }

  AppState.selectedTownId = townId;
  AppState.selectedDistrictId = null;

  const feature = AppState.townFeaturesById[townId];
  const town = AppState.towns[townId];
  if (!feature || !town) return;

  const drawer = document.getElementById('details-drawer');
  drawer.classList.remove('collapsed');

  const hierBar = document.getElementById('drawer-hierarchy-bar');
  if (hierBar) hierBar.style.display = 'none';

  document.getElementById('drawer-town-name').textContent = feature.properties.name;
  
  const distCount = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId).length;
  document.getElementById('drawer-town-type').textContent = distCount > 0 
    ? `${feature.properties.kreis} • ${distCount} Stadtteile` 
    : `${feature.properties.kreis} • Gesamtgemeinde`;

  const tabsControl = document.getElementById('drawer-tabs-segmented');
  if (tabsControl) {
    if (distCount > 0) {
      tabsControl.style.display = 'inline-flex';
      const badge = document.getElementById('drawer-districts-count');
      if (badge) badge.textContent = distCount;
    } else {
      tabsControl.style.display = 'none';
      switchDrawerTab('overview');
    }
  }

  renderDistrictsListForTown(townId);

  updateMilestoneHeaderAndSelection();
  document.getElementById('drawer-custom-color').value = town.customColor || '#86efac';

  document.getElementById('drawer-is-center').checked = !!town.isCenter;
  document.getElementById('drawer-is-center').closest('.center-switch-box').style.display = 'flex';

  document.getElementById('drawer-nuclei').value = town.nuclei || 0;

  const acts = town.activities || {};
  document.getElementById('drawer-act-devotionals').value = acts.devotionals || 0;
  document.getElementById('drawer-act-studycircles').value = acts.studyCircles || 0;
  document.getElementById('drawer-act-children').value = acts.childrenClasses || 0;
  document.getElementById('drawer-act-junioryouth').value = acts.juniorYouth || 0;
  document.getElementById('drawer-act-total').textContent = calculateTotalActivities(acts);

  renderDeploymentsList(townId);
  document.getElementById('drawer-notes').value = town.notes || '';

  // AUTOMATIC ZOOM TO TOWN ON SELECTION
  if (shouldZoom && AppState.map) {
    if (distCount > 0) {
      focusTownDistricts(townId);
      return;
    } else {
      const layer = AppState.townLayersById[townId];
      if (layer) {
        const drawerWidth = drawer && !drawer.classList.contains('collapsed') ? Math.min(window.innerWidth * 0.45, 420) : 40;
        AppState.map.fitBounds(layer.getBounds(), {
          maxZoom: 13,
          paddingTopLeft: [50, 40],
          paddingBottomRight: [drawerWidth + 30, 40],
          animate: true
        });
      }
    }
  }

  refreshAllStyles();
  refreshMarkers();
  updateNavigationHUD();
}

function selectDistrict(districtId, shouldZoom = false) {
  AppState.selectedDistrictId = districtId;
  const feature = AppState.districtFeaturesById[districtId];
  const dist = AppState.districts[districtId];
  if (!feature || !dist) return;

  AppState.selectedTownId = feature.properties.townId;

  const drawer = document.getElementById('details-drawer');
  drawer.classList.remove('collapsed');

  const hierBar = document.getElementById('drawer-hierarchy-bar');
  if (hierBar) {
    hierBar.style.display = 'flex';
    document.getElementById('drawer-breadcrumb-parent').textContent = feature.properties.townName;
    document.getElementById('drawer-breadcrumb-current').textContent = `Unterpunkt: ${feature.properties.name}`;
  }

  // Explicit parent town title with subpoint context
  document.getElementById('drawer-town-name').textContent = feature.properties.townName;
  document.getElementById('drawer-town-type').textContent = `Unterpunkt: ${feature.properties.name} (Nachbarschaft von ${feature.properties.townName})`;

  renderDistrictsListForTown(feature.properties.townId);

  // Synchronize inputs with the selected district
  updateMilestoneHeaderAndSelection();
  document.getElementById('drawer-custom-color').value = dist.customColor || '#86efac';

  document.getElementById('drawer-is-center').closest('.center-switch-box').style.display = 'none';

  document.getElementById('drawer-nuclei').value = dist.nuclei || 0;

  const acts = dist.activities || {};
  document.getElementById('drawer-act-devotionals').value = acts.devotionals || 0;
  document.getElementById('drawer-act-studycircles').value = acts.studyCircles || 0;
  document.getElementById('drawer-act-children').value = acts.childrenClasses || 0;
  document.getElementById('drawer-act-junioryouth').value = acts.juniorYouth || 0;
  document.getElementById('drawer-act-total').textContent = calculateTotalActivities(acts);

  renderDeploymentsList(districtId);
  document.getElementById('drawer-notes').value = dist.notes || '';

  if (shouldZoom) {
    focusDistrictOnMap(districtId);
    return;
  }

  refreshAllStyles();
}

function renderDistrictsListForTown(townId) {
  const container = document.getElementById('drawer-districts-list');
  const countSpan = document.getElementById('drawer-districts-count');
  const summarySpan = document.getElementById('drawer-districts-summary-count');
  container.innerHTML = '';

  const parentTown = AppState.townFeaturesById[townId];
  const parentName = parentTown ? parentTown.properties.name : 'dieser Ortschaft';
  const parentHeaderName = document.getElementById('drawer-districts-parent-name');
  if (parentHeaderName) parentHeaderName.textContent = parentName;

  const districts = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId);
  if (countSpan) countSpan.textContent = districts.length;
  if (summarySpan) summarySpan.textContent = `${districts.length} Nachbarschaften`;

  if (districts.length === 0) {
    container.innerHTML = `
      <div style="background:rgba(118,118,128,0.06); border:0.5px solid var(--separator); border-radius:var(--radius-sm); padding:12px; font-size:12px; color:var(--text-secondary);">
        <div style="font-weight:600; color:var(--text-primary); margin-bottom:4px;">Einheitliche Gemeinde</div>
        Dieser Ort besitzt keine weiteren unterteilten Nachbarschaften. Alle Aktivitäten und Nuklei werden für die Gesamt-Kommune gepflegt.
      </div>
    `;
    return;
  }

  districts.forEach(df => {
    const dId = df.properties.id;
    const dData = AppState.districts[dId] || { milestone: 'none', nuclei: 0, activities: {} };
    const actsTotal = calculateTotalActivities(dData.activities);
    const isSelected = AppState.selectedDistrictId === dId;

    const isPaintMode = AppState.currentMode === 'paint';
    const card = document.createElement('div');
    card.className = `district-subcard ${isSelected ? 'active expanded' : ''} ${isPaintMode ? 'paint-ready' : ''}`;
    card.id = `subcard-${dId}`;
    if (isPaintMode) {
      card.title = `Klicken, um ${df.properties.name} mit ${getMilestoneLabel(AppState.activePaintMilestone)} einzufärben`;
    }

    const m = dData.milestone || 'none';
    const mLabel = (m && m !== 'none') ? getMilestoneLabel(m) : 'Keine';
    const mClass = m;

    card.innerHTML = `
      <div class="district-subcard-header">
        <div class="district-subcard-left">
          <span class="subcard-chevron">${isSelected ? '▼' : '▶'}</span>
          <span class="subcard-color-dot ${mClass}" style="background:${getMilestoneColor(dData.milestone)};" title="Klick: Stufe ändern"></span>
          <span class="district-subcard-title" title="${escapeHtml(df.properties.name)}">${escapeHtml(df.properties.name)}</span>
        </div>
        <div class="district-subcard-badges">
          <span class="subcard-badge milestone ${mClass}">${mLabel}</span>
          <div class="subcard-stats-pill" title="${dData.nuclei || 0} Nuklei · ${actsTotal} Aktivitäten">
            <span class="${dData.nuclei > 0 ? 'highlight-nuclei' : ''}">${dData.nuclei || 0} Nukl.</span>
            <span class="stat-sep">·</span>
            <span class="${actsTotal > 0 ? 'highlight-acts' : ''}">${actsTotal} Akt.</span>
          </div>
        </div>
      </div>
      <div class="district-subcard-body" style="display: ${isSelected ? 'block' : 'none'};">
        <div class="subcard-section-label">Meilenstein für ${escapeHtml(df.properties.name)}:</div>
        <div class="subcard-milestone-grid">
          <button type="button" class="subcard-m-btn ${dData.milestone==='none'?'active':''}" data-m="none">Keine</button>
          <button type="button" class="subcard-m-btn ${dData.milestone==='pg'?'active':''}" data-m="pg">PG</button>
          <button type="button" class="subcard-m-btn ${dData.milestone==='ipg'?'active':''}" data-m="ipg">IPG</button>
          <button type="button" class="subcard-m-btn ${dData.milestone==='ipg_plus'?'active':''}" data-m="ipg_plus">IPG+</button>
        </div>

        <div class="subcard-steppers-group">
          <div class="subcard-row">
            <span>Aktive Nuklei:</span>
            <div class="apple-stepper sm">
              <button type="button" class="stepper-btn btn-dec-sub-nuclei">-</button>
              <input type="number" class="stepper-val input-sub-nuclei" value="${dData.nuclei || 0}" min="0" />
              <button type="button" class="stepper-btn btn-inc-sub-nuclei">+</button>
            </div>
          </div>
          <div class="subcard-row">
            <span>Andachten:</span>
            <div class="apple-stepper sm">
              <button type="button" class="stepper-btn btn-dec-sub-dev">-</button>
              <input type="number" class="stepper-val input-sub-dev" value="${dData.activities?.devotionals || 0}" min="0" />
              <button type="button" class="stepper-btn btn-inc-sub-dev">+</button>
            </div>
          </div>
          <div class="subcard-row">
            <span>Studienkreise:</span>
            <div class="apple-stepper sm">
              <button type="button" class="stepper-btn btn-dec-sub-study">-</button>
              <input type="number" class="stepper-val input-sub-study" value="${dData.activities?.studyCircles || 0}" min="0" />
              <button type="button" class="stepper-btn btn-inc-sub-study">+</button>
            </div>
          </div>
          <div class="subcard-row">
            <span>Kinderklassen:</span>
            <div class="apple-stepper sm">
              <button type="button" class="stepper-btn btn-dec-sub-child">-</button>
              <input type="number" class="stepper-val input-sub-child" value="${dData.activities?.childrenClasses || 0}" min="0" />
              <button type="button" class="stepper-btn btn-inc-sub-child">+</button>
            </div>
          </div>
          <div class="subcard-row">
            <span>Junior-Jugend:</span>
            <div class="apple-stepper sm">
              <button type="button" class="stepper-btn btn-dec-sub-youth">-</button>
              <input type="number" class="stepper-val input-sub-youth" value="${dData.activities?.juniorYouth || 0}" min="0" />
              <button type="button" class="stepper-btn btn-inc-sub-youth">+</button>
            </div>
          </div>
        </div>

        <div style="display:flex; gap:6px; margin-top:8px;">
          <button type="button" class="btn btn-secondary btn-zoom-subcard" style="flex:1; font-size:11px; padding:3px 8px; justify-content:center;">
            Auf Karte heranzoomen
          </button>
        </div>
      </div>
    `;

    // Wire header click to toggle, select or paint
    const header = card.querySelector('.district-subcard-header');
    header.addEventListener('click', () => {
      if (AppState.currentMode === 'paint') {
        applyPaintToDistrict(dId);
        return;
      }
      if (AppState.selectedDistrictId === dId) {
        const body = card.querySelector('.district-subcard-body');
        const isExp = body.style.display !== 'none';
        body.style.display = isExp ? 'none' : 'block';
        card.classList.toggle('expanded', !isExp);
        card.querySelector('.subcard-chevron').textContent = isExp ? '▶' : '▼';
      } else {
        selectDistrict(dId, false);
      }
    });

    // Wire color dot quick toggle
    const colorDot = card.querySelector('.subcard-color-dot');
    if (colorDot) {
      colorDot.title = isPaintMode 
        ? `Klicken zum Einfärben (${getMilestoneLabel(AppState.activePaintMilestone)})` 
        : 'Klicken zum Ändern der Stufe';
      colorDot.addEventListener('click', (e) => {
        e.stopPropagation();
        if (AppState.currentMode === 'paint') {
          applyPaintToDistrict(dId);
          return;
        }
        const cycle = { none: 'pg', pg: 'ipg', ipg: 'ipg_plus', ipg_plus: 'none' };
        const nextM = cycle[dData.milestone] || 'pg';
        pushHistory(`Stadtteil ${df.properties.name}: Meilenstein auf ${getMilestoneLabel(nextM)} geändert`);
        dData.milestone = nextM;
        AppState.selectedDistrictId = dId;
        saveState();
        refreshAllStyles();
        refreshMarkers();
        updateClusterStats();
        renderDistrictsListForTown(townId);
        updateMilestoneHeaderAndSelection();
      });
    }

    // Milestone buttons
    card.querySelectorAll('.subcard-m-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = btn.dataset.m;
        pushHistory(`Stadtteil ${df.properties.name}: Meilenstein auf ${getMilestoneLabel(m)} geändert`);
        dData.milestone = m;
        AppState.selectedDistrictId = dId;
        saveState();
        refreshAllStyles();
        refreshMarkers();
        updateClusterStats();
        renderDistrictsListForTown(townId);
        updateMilestoneHeaderAndSelection();
      });
    });

    // Nuclei Stepper
    const nucleiInput = card.querySelector('.input-sub-nuclei');
    card.querySelector('.btn-dec-sub-nuclei').addEventListener('click', (e) => {
      e.stopPropagation();
      pushHistory(`Stadtteil ${df.properties.name}: Nuklei verringert`);
      let v = Math.max(0, (parseInt(nucleiInput.value) || 0) - 1);
      nucleiInput.value = v;
      dData.nuclei = v;
      saveState();
      refreshAllStyles();
      renderDistrictsListForTown(townId);
      if (AppState.selectedDistrictId === dId) document.getElementById('drawer-nuclei').value = v;
    });
    card.querySelector('.btn-inc-sub-nuclei').addEventListener('click', (e) => {
      e.stopPropagation();
      pushHistory(`Stadtteil ${df.properties.name}: Nuklei erhöht`);
      let v = (parseInt(nucleiInput.value) || 0) + 1;
      nucleiInput.value = v;
      dData.nuclei = v;
      saveState();
      refreshAllStyles();
      renderDistrictsListForTown(townId);
      if (AppState.selectedDistrictId === dId) document.getElementById('drawer-nuclei').value = v;
    });

    // Activities
    const bindSubAct = (decCls, incCls, inputCls, key) => {
      const inp = card.querySelector(inputCls);
      card.querySelector(decCls).addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory(`Stadtteil ${df.properties.name}: Aktivität verringert`);
        if (!dData.activities) dData.activities = {};
        let v = Math.max(0, (parseInt(inp.value) || 0) - 1);
        inp.value = v;
        dData.activities[key] = v;
        saveState();
        refreshAllStyles();
        renderDistrictsListForTown(townId);
      });
      card.querySelector(incCls).addEventListener('click', (e) => {
        e.stopPropagation();
        pushHistory(`Stadtteil ${df.properties.name}: Aktivität erhöht`);
        if (!dData.activities) dData.activities = {};
        let v = (parseInt(inp.value) || 0) + 1;
        inp.value = v;
        dData.activities[key] = v;
        saveState();
        refreshAllStyles();
        renderDistrictsListForTown(townId);
      });
    };

    bindSubAct('.btn-dec-sub-dev', '.btn-inc-sub-dev', '.input-sub-dev', 'devotionals');
    bindSubAct('.btn-dec-sub-study', '.btn-inc-sub-study', '.input-sub-study', 'studyCircles');
    bindSubAct('.btn-dec-sub-child', '.btn-inc-sub-child', '.input-sub-child', 'childrenClasses');
    bindSubAct('.btn-dec-sub-youth', '.btn-inc-sub-youth', '.input-sub-youth', 'juniorYouth');

    // Zoom subcard button
    card.querySelector('.btn-zoom-subcard').addEventListener('click', (e) => {
      e.stopPropagation();
      focusDistrictOnMap(dId);
    });

    container.appendChild(card);
  });
}

function switchDrawerTab(tab) {
  AppState.activeDrawerTab = tab;
  const btnOverview = document.getElementById('tab-btn-overview');
  const btnDistricts = document.getElementById('tab-btn-districts');
  const viewOverview = document.getElementById('drawer-overview-view');
  const viewDistricts = document.getElementById('drawer-districts-view');

  if (btnOverview) btnOverview.classList.toggle('active', tab === 'overview');
  if (btnDistricts) btnDistricts.classList.toggle('active', tab === 'districts');

  if (viewOverview) viewOverview.style.display = tab === 'overview' ? 'block' : 'none';
  if (viewDistricts) viewDistricts.style.display = tab === 'districts' ? 'block' : 'none';

  if (tab === 'districts' && !AppState.selectedDistrictId && AppState.selectedTownId) {
    const firstDist = Object.values(AppState.districtFeaturesById).find(f => f.properties.townId === AppState.selectedTownId);
    if (firstDist) {
      AppState.selectedDistrictId = firstDist.properties.id;
      renderDistrictsListForTown(AppState.selectedTownId);
    }
  }

  updateMilestoneHeaderAndSelection();
}

function updateMilestoneUISelection(milestone) {
  document.querySelectorAll('.milestone-card').forEach(card => {
    card.classList.toggle('active', card.dataset.milestone === milestone);
  });
  const customRow = document.getElementById('drawer-custom-color-row');
  if (customRow) customRow.style.display = milestone === 'custom' ? 'flex' : 'none';
}

function updateMilestoneHeaderAndSelection() {
  const header = document.getElementById('drawer-milestone-header');
  const btnApplyAll = document.getElementById('btn-apply-milestone-all-districts');
  const townId = AppState.selectedTownId;
  const distId = AppState.selectedDistrictId;
  const distCount = townId ? Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId).length : 0;

  if (AppState.activeDrawerTab === 'districts' || distId) {
    if (distId && AppState.districts[distId]) {
      const distFeat = AppState.districtFeaturesById[distId];
      const distName = distFeat ? distFeat.properties.name : 'Stadtteil';
      if (header) header.textContent = `Meilenstein für: ${distName}`;
      updateMilestoneUISelection(AppState.districts[distId].milestone);
      const customInput = document.getElementById('drawer-custom-color');
      if (customInput) customInput.value = AppState.districts[distId].customColor || '#86efac';
    } else {
      if (header) header.textContent = 'Meilenstein für Stadtteil:';
      const firstDist = Object.values(AppState.districtFeaturesById).find(f => f.properties.townId === townId);
      if (firstDist && AppState.districts[firstDist.properties.id]) {
        updateMilestoneUISelection(AppState.districts[firstDist.properties.id].milestone);
      }
    }
    if (btnApplyAll) {
      btnApplyAll.style.display = distCount > 0 ? 'inline-block' : 'none';
      btnApplyAll.textContent = `Auf alle ${distCount} Stadtteile anwenden`;
    }
  } else {
    // Overview tab
    if (header) {
      header.textContent = distCount > 0 ? 'Wachstumsstufe (Gesamtgemeinde)' : 'Wachstumsstufe & Meilenstein';
    }
    if (townId && AppState.towns[townId]) {
      updateMilestoneUISelection(AppState.towns[townId].milestone);
      const customInput = document.getElementById('drawer-custom-color');
      if (customInput) customInput.value = AppState.towns[townId].customColor || '#86efac';
    }
    if (btnApplyAll) {
      btnApplyAll.style.display = distCount > 0 ? 'inline-block' : 'none';
      btnApplyAll.textContent = `Auf alle ${distCount} Stadtteile anwenden`;
    }
  }
}

function renderDeploymentsList(targetId) {
  const container = document.getElementById('drawer-deployments-list');
  container.innerHTML = '';

  const outgoing = AppState.deployments.filter(d => d.fromId === targetId);
  const incoming = AppState.deployments.filter(d => d.toId === targetId);

  if (outgoing.length === 0 && incoming.length === 0) {
    container.innerHTML = `<div style="font-size:12px; color:var(--text-tertiary); font-style:italic; padding:6px 0;">Keine aktiven Entsendungen verknüpft.</div>`;
    return;
  }

  outgoing.forEach(d => {
    const card = document.createElement('div');
    card.className = 'deployment-card';
    card.style.borderLeftColor = d.status === 'planned' ? 'var(--system-orange)' : (d.status === 'established' ? 'var(--system-green)' : (d.color || 'var(--system-blue)'));
    const statusText = d.status === 'planned' ? 'Geplant' : (d.status === 'established' ? 'Etabliert' : 'Aktiv');
    card.innerHTML = `
      <div style="flex:1; cursor:pointer;">
        <div class="dep-info-title">
          <span>→ Nach ${escapeHtml(d.toName)}</span>
          <span style="background:rgba(0,122,255,0.1); color:var(--system-blue); padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">${d.count || 1} Pers.</span>
        </div>
        <div class="dep-info-sub">${escapeHtml(d.type)} • <span class="dep-status-pill ${d.status}">${statusText}</span></div>
      </div>
      <div class="dep-actions" style="display:flex; gap:4px; align-items:center;">
        <button type="button" class="btn-icon-edit" title="Entsendung bearbeiten" style="background:none; border:none; cursor:pointer; font-size:12px; padding:2px 4px;">✏️</button>
        <button type="button" class="btn-icon-del" title="Entsendung löschen">✕</button>
      </div>
    `;
    card.querySelector('div:first-child').onclick = () => openDeploymentModal(d);
    card.querySelector('.btn-icon-edit').onclick = (e) => {
      e.stopPropagation();
      openDeploymentModal(d);
    };
    card.querySelector('.btn-icon-del').onclick = (e) => {
      e.stopPropagation();
      deleteDeployment(d.id);
    };
    container.appendChild(card);
  });

  incoming.forEach(d => {
    const card = document.createElement('div');
    card.className = 'deployment-card';
    card.style.borderLeftColor = d.status === 'planned' ? 'var(--system-orange)' : (d.status === 'established' ? 'var(--system-green)' : 'var(--system-green)');
    const statusText = d.status === 'planned' ? 'Geplant' : (d.status === 'established' ? 'Etabliert' : 'Aktiv');
    card.innerHTML = `
      <div style="flex:1; cursor:pointer;">
        <div class="dep-info-title">
          <span>← Von ${escapeHtml(d.fromName)}</span>
          <span style="background:rgba(52,199,89,0.12); color:var(--system-green); padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">${d.count || 1} Pers.</span>
        </div>
        <div class="dep-info-sub">${escapeHtml(d.type)} • <span class="dep-status-pill ${d.status}">${statusText}</span></div>
      </div>
      <div class="dep-actions" style="display:flex; gap:4px; align-items:center;">
        <button type="button" class="btn-icon-edit" title="Entsendung bearbeiten" style="background:none; border:none; cursor:pointer; font-size:12px; padding:2px 4px;">✏️</button>
        <button type="button" class="btn-icon-del" title="Entsendung löschen">✕</button>
      </div>
    `;
    card.querySelector('div:first-child').onclick = () => openDeploymentModal(d);
    card.querySelector('.btn-icon-edit').onclick = (e) => {
      e.stopPropagation();
      openDeploymentModal(d);
    };
    card.querySelector('.btn-icon-del').onclick = (e) => {
      e.stopPropagation();
      deleteDeployment(d.id);
    };
    container.appendChild(card);
  });
}

// --- Quick Paint Mode ---
function applyPaintToTown(townId) {
  const town = AppState.towns[townId];
  if (!town) return;
  const name = AppState.townFeaturesById[townId]?.properties?.name || 'Ortschaft';
  pushHistory(`Ortschaft ${name} eingefärbt`);
  town.milestone = AppState.activePaintMilestone;
  if (AppState.activePaintMilestone === 'custom') town.customColor = AppState.activePaintColor;

  // Also set all districts of this town to the painted milestone
  const districts = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId);
  districts.forEach(df => {
    const dId = df.properties.id;
    if (AppState.districts[dId]) {
      AppState.districts[dId].milestone = AppState.activePaintMilestone;
      if (AppState.activePaintMilestone === 'custom') AppState.districts[dId].customColor = AppState.activePaintColor;
    }
  });

  saveState();
  refreshAllStyles();
  refreshMarkers();
  updateClusterStats();
  if (AppState.selectedTownId === townId) {
    updateMilestoneHeaderAndSelection();
    renderDistrictsListForTown(townId);
  }
}

function applyPaintToDistrict(districtId) {
  const dist = AppState.districts[districtId];
  if (!dist) return;
  const df = AppState.districtFeaturesById[districtId];
  const name = df?.properties?.name || 'Stadtteil';
  pushHistory(`Stadtteil ${name} eingefärbt`);
  dist.milestone = AppState.activePaintMilestone;
  if (AppState.activePaintMilestone === 'custom') dist.customColor = AppState.activePaintColor;
  AppState.selectedDistrictId = districtId;
  saveState();
  refreshAllStyles();
  refreshMarkers();
  updateClusterStats();
  updateMilestoneHeaderAndSelection();
  if (df && AppState.selectedTownId === df.properties.townId) {
    renderDistrictsListForTown(df.properties.townId);
  }
}

// --- Arrow Creation ---
function handleArrowSourceTargetClick(id, isDistrict) {
  const feat = isDistrict ? AppState.districtFeaturesById[id] : AppState.townFeaturesById[id];
  if (!feat) return;

  const label = isDistrict ? `${feat.properties.townName} (${feat.properties.name})` : feat.properties.name;

  if (!AppState.arrowSourceId) {
    AppState.arrowSourceId = id;
    AppState.arrowSourceIsDistrict = isDistrict;
    const banner = document.getElementById('arrow-instruction-text');
    banner.textContent = `Start gewählt: ${label} → Klicke jetzt auf das Ziel`;
    refreshAllStyles();
  } else {
    if (AppState.arrowSourceId === id) {
      showInAppAlert('Start und Ziel können nicht derselbe Ort sein.', 'warning');
      return;
    }

    const fromFeat = AppState.arrowSourceIsDistrict ? AppState.districtFeaturesById[AppState.arrowSourceId] : AppState.townFeaturesById[AppState.arrowSourceId];
    const toFeat = feat;

    openNewArrowModal(fromFeat, toFeat, AppState.arrowSourceIsDistrict, isDistrict);
  }
}

function openNewArrowModal(fromFeat, toFeat, fromIsDist, toIsDist) {
  const fromName = fromIsDist ? `${fromFeat.properties.townName} (${fromFeat.properties.name})` : fromFeat.properties.name;
  const toName = toIsDist ? `${toFeat.properties.townName} (${toFeat.properties.name})` : toFeat.properties.name;

  document.getElementById('new-arrow-from-name').textContent = fromName;
  document.getElementById('new-arrow-to-name').textContent = toName;
  document.getElementById('new-arrow-from-id').value = fromFeat.properties.id;
  document.getElementById('new-arrow-to-id').value = toFeat.properties.id;

  document.getElementById('new-arrow-modal').classList.add('visible');
}

function saveNewArrowFromModal() {
  const fromId = document.getElementById('new-arrow-from-id').value;
  const toId = document.getElementById('new-arrow-to-id').value;

  const fromFeat = AppState.districtFeaturesById[fromId] || AppState.townFeaturesById[fromId];
  const toFeat = AppState.districtFeaturesById[toId] || AppState.townFeaturesById[toId];

  const fromName = fromFeat.properties.townName ? `${fromFeat.properties.townName} (${fromFeat.properties.name})` : fromFeat.properties.name;
  const toName = toFeat.properties.townName ? `${toFeat.properties.townName} (${toFeat.properties.name})` : toFeat.properties.name;

  pushHistory(`Entsendung ${fromName} ➔ ${toName} erstellt`);

  const newDep = {
    id: 'dep-' + Date.now(),
    fromId: fromId,
    fromName: fromName,
    toId: toId,
    toName: toName,
    type: document.getElementById('new-arrow-type').value,
    count: parseInt(document.getElementById('new-arrow-count').value) || 1,
    status: document.getElementById('new-arrow-status').value || 'active',
    color: document.getElementById('new-arrow-color').value || '#007aff',
    notes: document.getElementById('new-arrow-notes').value
  };

  AppState.deployments.push(newDep);
  saveState();
  cancelArrowDrawing();
  setMode('inspect');
  document.getElementById('new-arrow-modal').classList.remove('visible');
  refreshAllStyles();

  if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
}

function cancelArrowDrawing() {
  AppState.arrowSourceId = null;
  AppState.arrowSourceIsDistrict = false;
  const banner = document.getElementById('arrow-instruction-text');
  if (banner) banner.textContent = "1. Start-Ort auf Karte anklicken → 2. Ziel-Ort anklicken";
  refreshAllStyles();
}

function deleteDeployment(depId) {
  const found = AppState.deployments.find(d => d.id === depId);
  const desc = found ? `Entsendung ${found.fromName} ➔ ${found.toName} gelöscht` : 'Entsendung gelöscht';
  const labelFrom = found ? escapeHtml(found.fromName) : '';
  const labelTo = found ? escapeHtml(found.toName) : '';
  showConfirmModal({
    title: 'Entsendung löschen',
    message: found
      ? `Möchtest du den Pfeil von „${found.fromName}" nach „${found.toName}" wirklich entfernen? Diese Aktion kann über Rückgängig rückgängig gemacht werden.`
      : 'Möchtest du diesen Pfeil wirklich entfernen?',
    confirmText: 'Löschen',
    cancelText: 'Abbrechen',
    isDestructive: true,
    onConfirm: () => {
      pushHistory(desc);
      AppState.deployments = AppState.deployments.filter(d => d.id !== depId);
      saveState();
      refreshAllStyles();
      if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
      else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
    }
  });
}


function openDeploymentModal(dep) {
  AppState.editingDeploymentId = dep.id;
  AppState.activeQuickDeployment = dep;

  document.getElementById('edit-dep-id').value = dep.id;
  document.getElementById('edit-dep-from-name').textContent = dep.fromName;
  document.getElementById('edit-dep-to-name').textContent = dep.toName;
  document.getElementById('edit-dep-type').value = dep.type || 'Pioniere / Umzügler';
  document.getElementById('edit-dep-count').value = dep.count || 1;
  document.getElementById('edit-dep-status').value = dep.status || 'active';
  document.getElementById('edit-dep-color').value = dep.color || '#007aff';
  document.getElementById('edit-dep-notes').value = dep.notes || '';

  // Setup swap button (Richtung umkehren)
  const swapBtn = document.getElementById('btn-edit-dep-swap');
  if (swapBtn) {
    swapBtn.onclick = () => {
      const tmpId = dep.fromId;
      const tmpName = dep.fromName;
      dep.fromId = dep.toId;
      dep.fromName = dep.toName;
      dep.toId = tmpId;
      dep.toName = tmpName;

      document.getElementById('edit-dep-from-name').textContent = dep.fromName;
      document.getElementById('edit-dep-to-name').textContent = dep.toName;
    };
  }

  // Delete button
  const delBtn = document.getElementById('view-dep-del-btn');
  if (delBtn) {
    delBtn.onclick = () => {
      document.getElementById('view-dep-modal').classList.remove('visible');
      deleteDeployment(dep.id);
    };
  }

  document.getElementById('view-dep-modal').classList.add('visible');
}

function saveEditedDeployment() {
  const depId = document.getElementById('edit-dep-id').value;
  const dep = AppState.deployments.find(d => d.id === depId);
  if (!dep) return;

  pushHistory(`Entsendung ${dep.fromName} ➔ ${dep.toName} aktualisiert`);

  dep.type = document.getElementById('edit-dep-type').value;
  dep.count = Math.max(1, parseInt(document.getElementById('edit-dep-count').value) || 1);
  dep.status = document.getElementById('edit-dep-status').value || 'active';
  dep.color = document.getElementById('edit-dep-color').value || '#007aff';
  dep.notes = document.getElementById('edit-dep-notes').value;

  saveState();
  renderArrows();
  document.getElementById('view-dep-modal').classList.remove('visible');

  if (AppState.activeQuickDeployment && AppState.activeQuickDeployment.id === depId) {
    openArrowQuickHUD(dep);
  }
  if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
}

// --- Application Modes ---
function setMode(mode) {
  AppState.currentMode = mode;
  const btnInspect = document.getElementById('mode-btn-inspect');
  const btnPaint = document.getElementById('mode-btn-paint');
  const btnArrow = document.getElementById('mode-btn-arrow');
  const paintBar = document.getElementById('paint-palette-bar');
  const arrowBanner = document.getElementById('arrow-instruction-banner');

  if (btnInspect) btnInspect.classList.toggle('active', mode === 'inspect');
  if (btnPaint) btnPaint.classList.toggle('active', mode === 'paint');
  if (btnArrow) btnArrow.classList.toggle('active', mode === 'arrow');

  if (paintBar) paintBar.classList.toggle('visible', mode === 'paint');
  if (arrowBanner) arrowBanner.classList.toggle('visible', mode === 'arrow');

  if (mode !== 'arrow') {
    cancelArrowDrawing();
  }
}

// Recenter current selection (Town or District) on map
function recenterCurrentSelection() {
  if (AppState.selectedDistrictId) {
    focusDistrictOnMap(AppState.selectedDistrictId);
  } else if (AppState.selectedTownId) {
    const distCount = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === AppState.selectedTownId).length;
    if (distCount > 0) {
      focusTownDistricts(AppState.selectedTownId);
    } else {
      const layer = AppState.townLayersById[AppState.selectedTownId];
      if (layer && AppState.map) {
        const drawer = document.getElementById('details-drawer');
        const drawerWidth = drawer && !drawer.classList.contains('collapsed') ? Math.min(window.innerWidth * 0.45, 420) : 40;
        AppState.map.fitBounds(layer.getBounds(), {
          maxZoom: 13,
          paddingTopLeft: [50, 40],
          paddingBottomRight: [drawerWidth + 30, 40],
          animate: true
        });
      }
    }
  }
}

// --- UI Event Listeners ---
function initUIEventListeners() {
  document.getElementById('btn-zoom-cluster').addEventListener('click', exitDistrictFocus);
  document.getElementById('btn-exit-focus').addEventListener('click', exitDistrictFocus);
  
  const btnRecenter = document.getElementById('btn-recenter-selection');
  if (btnRecenter) {
    btnRecenter.addEventListener('click', recenterCurrentSelection);
  }

  document.getElementById('tab-btn-overview').addEventListener('click', () => switchDrawerTab('overview'));
  document.getElementById('tab-btn-districts').addEventListener('click', () => switchDrawerTab('districts'));

  const btnInspect = document.getElementById('mode-btn-inspect');
  const btnPaint = document.getElementById('mode-btn-paint');
  const btnArrow = document.getElementById('mode-btn-arrow');

  btnInspect.addEventListener('click', () => setMode('inspect'));
  btnPaint.addEventListener('click', () => setMode('paint'));
  btnArrow.addEventListener('click', () => setMode('arrow'));
  document.getElementById('btn-cancel-arrow').addEventListener('click', () => {
    cancelArrowDrawing();
    setMode('inspect');
  });

  document.querySelectorAll('.color-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      AppState.activePaintMilestone = chip.dataset.milestone;
      AppState.activePaintColor = chip.dataset.color || '#86efac';
    });
  });

  function updateLegendForView(viewMode) {
    const container = document.getElementById('legend-items-container');
    if (!container) return;
    if (viewMode === 'activities') {
      container.innerHTML = `
        <div class="legend-row">
          <div class="legend-dot" style="background:#15803d; border-color:#052e16;"></div>
          <span><strong>11+</strong> Kernaktivitäten</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot" style="background:#22c55e; border-color:#15803d;"></div>
          <span><strong>6 – 10</strong> Kernaktivitäten</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot" style="background:#4ade80; border-color:#16a34a;"></div>
          <span><strong>3 – 5</strong> Kernaktivitäten</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot" style="background:#bbf7d0; border-color:#4ade80;"></div>
          <span><strong>1 – 2</strong> Kernaktivitäten</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot none"></div>
          <span style="color: var(--text-tertiary);">0 Aktivitäten</span>
        </div>
        <div class="legend-row">
          <span style="color: var(--system-orange); font-size: 13px; line-height: 1; width: 12px; text-align: center;">★</span>
          <span>Entsende-Zentrum</span>
        </div>
      `;
    } else if (viewMode === 'nuclei') {
      container.innerHTML = `
        <div class="legend-row">
          <div class="legend-dot" style="background:#047857; border-color:#064e3b;"></div>
          <span><strong>4+</strong> Nuklei</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot" style="background:#10b981; border-color:#047857;"></div>
          <span><strong>2 – 3</strong> Nuklei</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot" style="background:#a7f3d0; border-color:#10b981;"></div>
          <span><strong>1</strong> Nukleus</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot none"></div>
          <span style="color: var(--text-tertiary);">0 Nuklei</span>
        </div>
        <div class="legend-row">
          <span style="color: var(--system-orange); font-size: 13px; line-height: 1; width: 12px; text-align: center;">★</span>
          <span>Entsende-Zentrum</span>
        </div>
      `;
    } else {
      container.innerHTML = `
        <div class="legend-row">
          <div class="legend-dot ipg-plus"></div>
          <span><strong>IPG+</strong> (Fortgeschrittenes Programm)</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot ipg"></div>
          <span><strong>IPG</strong> (Intensives Programm)</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot pg"></div>
          <span><strong>PG</strong> (Programm des Wachstums)</span>
        </div>
        <div class="legend-row">
          <div class="legend-dot none"></div>
          <span style="color: var(--text-tertiary);">Noch nicht begonnen</span>
        </div>
        <div class="legend-row">
          <span style="color: var(--system-orange); font-size: 13px; line-height: 1; width: 12px; text-align: center;">★</span>
          <span>Entsende-Zentrum</span>
        </div>
      `;
    }
  }

  document.getElementById('select-visual-view').addEventListener('change', (e) => {
    AppState.visualViewMode = e.target.value;
    updateLegendForView(e.target.value);
    refreshAllStyles();
  });


  const toggleLabelsInput = document.getElementById('toggle-labels');
  toggleLabelsInput.checked = true;
  AppState.showLabels = true;

  toggleLabelsInput.addEventListener('change', (e) => {
    AppState.showLabels = e.target.checked;
    refreshMarkers();
  });

  document.getElementById('toggle-surrounding').addEventListener('change', (e) => {
    AppState.showSurrounding = e.target.checked;
    refreshAllStyles();
  });

  document.getElementById('toggle-rivers').addEventListener('change', (e) => {
    AppState.showLandmarks = e.target.checked;
    refreshAllStyles();
  });

  document.getElementById('toggle-arrows').addEventListener('change', (e) => {
    AppState.showArrows = e.target.checked;
    renderArrows();
  });

  document.getElementById('btn-close-drawer').addEventListener('click', () => {
    zoomToClusterOverview(true);
  });

  const btnBack = document.getElementById('btn-back-to-parent-town');
  if (btnBack) {
    btnBack.addEventListener('click', () => {
      if (AppState.selectedTownId) {
        selectTown(AppState.selectedTownId);
      }
    });
  }

  document.querySelectorAll('.milestone-card').forEach(card => {
    card.addEventListener('click', () => {
      const m = card.dataset.milestone;

      // If we are in the districts tab or have an active selected district:
      if (AppState.activeDrawerTab === 'districts' || AppState.selectedDistrictId) {
        let targetDistId = AppState.selectedDistrictId;
        if (!targetDistId && AppState.selectedTownId) {
          const firstDist = Object.values(AppState.districtFeaturesById).find(f => f.properties.townId === AppState.selectedTownId);
          if (firstDist) targetDistId = firstDist.properties.id;
        }

        if (targetDistId && AppState.districts[targetDistId]) {
          const df = AppState.districtFeaturesById[targetDistId];
          const name = df ? df.properties.name : 'Stadtteil';
          pushHistory(`Stadtteil ${name}: Meilenstein auf ${getMilestoneLabel(m)} geändert`);
          AppState.districts[targetDistId].milestone = m;
          AppState.selectedDistrictId = targetDistId;
          updateMilestoneHeaderAndSelection();
          saveState();
          refreshAllStyles();
          refreshMarkers();
          updateClusterStats();
          if (AppState.selectedTownId) {
            renderDistrictsListForTown(AppState.selectedTownId);
          }
          return;
        }
      }

      // Otherwise we are on the overall town / municipality level:
      if (AppState.selectedTownId && AppState.towns[AppState.selectedTownId]) {
        const town = AppState.towns[AppState.selectedTownId];
        const tf = AppState.townFeaturesById[AppState.selectedTownId];
        const name = tf ? tf.properties.name : 'Ortschaft';
        pushHistory(`Ortschaft ${name}: Meilenstein auf ${getMilestoneLabel(m)} geändert`);
        town.milestone = m;
        updateMilestoneHeaderAndSelection();
        saveState();
        refreshAllStyles();
        refreshMarkers();
        updateClusterStats();
        renderDistrictsListForTown(AppState.selectedTownId);
      }
    });
  });

  const btnApplyAll = document.getElementById('btn-apply-milestone-all-districts');
  if (btnApplyAll) {
    btnApplyAll.addEventListener('click', () => {
      const townId = AppState.selectedTownId;
      if (!townId) return;
      const town = AppState.towns[townId];
      if (!town) return;

      let targetMilestone = town.milestone;
      let targetColor = town.customColor;
      if (AppState.activeDrawerTab === 'districts' && AppState.selectedDistrictId && AppState.districts[AppState.selectedDistrictId]) {
        targetMilestone = AppState.districts[AppState.selectedDistrictId].milestone;
        targetColor = AppState.districts[AppState.selectedDistrictId].customColor;
      }

      const townFeat = AppState.townFeaturesById[townId];
      const townName = townFeat ? townFeat.properties.name : 'Gemeinde';
      const districts = Object.values(AppState.districtFeaturesById).filter(f => f.properties.townId === townId);
      if (districts.length === 0) return;

      pushHistory(`Alle ${districts.length} Stadtteile von ${townName} auf ${getMilestoneLabel(targetMilestone)} gesetzt`);
      districts.forEach(df => {
        const dId = df.properties.id;
        if (!AppState.districts[dId]) AppState.districts[dId] = { milestone: 'none', nuclei: 0, activities: {} };
        AppState.districts[dId].milestone = targetMilestone;
        if (targetMilestone === 'custom' && targetColor) {
          AppState.districts[dId].customColor = targetColor;
        }
      });
      town.milestone = targetMilestone;
      if (targetMilestone === 'custom' && targetColor) town.customColor = targetColor;

      saveState();
      refreshAllStyles();
      refreshMarkers();
      updateClusterStats();
      renderDistrictsListForTown(townId);
      updateMilestoneHeaderAndSelection();
    });
  }

  document.getElementById('drawer-custom-color').addEventListener('change', (e) => {
    pushHistory('Farbe angepasst');
    if (AppState.activeDrawerTab === 'districts' || AppState.selectedDistrictId) {
      if (AppState.selectedDistrictId && AppState.districts[AppState.selectedDistrictId]) {
        AppState.districts[AppState.selectedDistrictId].customColor = e.target.value;
      }
    } else if (AppState.selectedTownId && AppState.towns[AppState.selectedTownId]) {
      AppState.towns[AppState.selectedTownId].customColor = e.target.value;
    }
    saveState();
    refreshAllStyles();
  });

  document.getElementById('drawer-is-center').addEventListener('change', (e) => {
    if (AppState.selectedTownId && !AppState.selectedDistrictId) {
      pushHistory(e.target.checked ? 'Als Entsende-Zentrum markiert' : 'Zentrums-Status entfernt');
      AppState.towns[AppState.selectedTownId].isCenter = e.target.checked;
      saveState();
      refreshAllStyles();
    }
  });

  initStepper('nuclei', (val) => {
    if (AppState.selectedDistrictId) {
      AppState.districts[AppState.selectedDistrictId].nuclei = val;
    } else if (AppState.selectedTownId) {
      AppState.towns[AppState.selectedTownId].nuclei = val;
    }
    saveState();
    refreshAllStyles();
  });

  initStepper('act-devotionals', (val) => updateCurrentActivity('devotionals', val));
  initStepper('act-studycircles', (val) => updateCurrentActivity('studyCircles', val));
  initStepper('act-children', (val) => updateCurrentActivity('childrenClasses', val));
  initStepper('act-junioryouth', (val) => updateCurrentActivity('juniorYouth', val));

  document.getElementById('drawer-notes').addEventListener('input', (e) => {
    if (AppState.selectedDistrictId) {
      AppState.districts[AppState.selectedDistrictId].notes = e.target.value;
    } else if (AppState.selectedTownId) {
      AppState.towns[AppState.selectedTownId].notes = e.target.value;
    }
    saveState();
  });

  document.getElementById('drawer-notes').addEventListener('change', () => {
    pushHistory('Notizen aktualisiert');
  });

  // Undo & Redo buttons
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  if (btnUndo) btnUndo.addEventListener('click', undo);
  if (btnRedo) btnRedo.addEventListener('click', redo);

  // Backups modal buttons
  const btnOpenBackups = document.getElementById('btn-open-backups');
  if (btnOpenBackups) {
    btnOpenBackups.addEventListener('click', () => {
      renderBackupsList();
      document.getElementById('backups-modal').classList.add('visible');
    });
  }
  const btnCloseBackupsModal = document.getElementById('btn-close-backups-modal');
  if (btnCloseBackupsModal) {
    btnCloseBackupsModal.addEventListener('click', () => {
      document.getElementById('backups-modal').classList.remove('visible');
    });
  }
  const btnCloseBackupsSheet = document.getElementById('btn-close-backups-sheet');
  if (btnCloseBackupsSheet) {
    btnCloseBackupsSheet.addEventListener('click', () => {
      document.getElementById('backups-modal').classList.remove('visible');
    });
  }
  const btnCreateBackup = document.getElementById('btn-create-manual-backup');
  if (btnCreateBackup) {
    btnCreateBackup.addEventListener('click', () => {
      saveAutoBackup("Manuelle Sicherung", true);
      renderBackupsList();
    });
  }

  // Quick Arrow HUD buttons
  const btnCloseQuick = document.getElementById('btn-close-quick-arrow');
  if (btnCloseQuick) btnCloseQuick.addEventListener('click', closeArrowQuickHUD);

  const btnQuickMinus = document.getElementById('quick-count-minus');
  if (btnQuickMinus) btnQuickMinus.addEventListener('click', () => adjustQuickArrowCount(-1));

  const btnQuickPlus = document.getElementById('quick-count-plus');
  if (btnQuickPlus) btnQuickPlus.addEventListener('click', () => adjustQuickArrowCount(1));

  document.querySelectorAll('.quick-status-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      setQuickArrowStatus(pill.dataset.status);
    });
  });

  const btnQuickDetails = document.getElementById('quick-btn-more-details');
  if (btnQuickDetails) {
    btnQuickDetails.addEventListener('click', () => {
      if (AppState.activeQuickDeployment) {
        const dep = AppState.activeQuickDeployment;
        closeArrowQuickHUD();
        openDeploymentModal(dep);
      }
    });
  }

  const btnQuickDelete = document.getElementById('quick-btn-delete');
  if (btnQuickDelete) {
    btnQuickDelete.addEventListener('click', deleteQuickArrow);
  }

  // Edit Deployment Modal buttons
  const btnSaveEditDep = document.getElementById('btn-save-edit-dep');
  if (btnSaveEditDep) btnSaveEditDep.addEventListener('click', saveEditedDeployment);

  const btnCloseEditDep = document.getElementById('btn-close-view-dep-modal');
  if (btnCloseEditDep) {
    btnCloseEditDep.addEventListener('click', () => {
      document.getElementById('view-dep-modal').classList.remove('visible');
    });
  }

  const btnCancelEditDep = document.getElementById('btn-cancel-edit-dep-modal');
  if (btnCancelEditDep) {
    btnCancelEditDep.addEventListener('click', () => {
      document.getElementById('view-dep-modal').classList.remove('visible');
    });
  }

  // Global Keyboard Shortcuts (⌘Z / ⇧⌘Z / ⌘Y / Escape)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeQuickPopover();
      const openModal = document.querySelector('.modal-backdrop.visible');
      if (openModal) {
        openModal.classList.remove('visible');
        if (openModal.id === 'new-arrow-modal') {
          cancelArrowDrawing();
          setMode('inspect');
        }
      }
      const drawer = document.getElementById('details-drawer');
      if (drawer && !drawer.classList.contains('collapsed')) {
        zoomToClusterOverview(true);
      }
      closeArrowQuickHUD();
      const projMenu = document.getElementById('project-dropdown-menu');
      if (projMenu) {
        projMenu.classList.remove('visible');
        document.getElementById('btn-project-menu')?.setAttribute('aria-expanded', 'false');
      }
      const searchRes = document.getElementById('town-search-results');
      if (searchRes) searchRes.classList.remove('visible');
      if (AppState.currentMode === 'arrow') {
        cancelArrowDrawing();
        setMode('inspect');
      }
      return;
    }

    if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;

    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      if (e.shiftKey) {
        e.preventDefault();
        redo();
      } else {
        e.preventDefault();
        undo();
      }
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
  });

  document.getElementById('btn-start-arrow-from-town').addEventListener('click', () => {
    const id = AppState.selectedDistrictId || AppState.selectedTownId;
    if (!id) return;
    const isDist = !!AppState.selectedDistrictId;
    setMode('arrow');
    AppState.arrowSourceId = id;
    AppState.arrowSourceIsDistrict = isDist;
    const feat = isDist ? AppState.districtFeaturesById[id] : AppState.townFeaturesById[id];
    const name = isDist ? `${feat.properties.townName} (${feat.properties.name})` : feat.properties.name;
    document.getElementById('arrow-instruction-text').textContent = `Start gewählt: ${name} → Klicke jetzt auf das Ziel`;
    refreshAllStyles();
  });

  const searchInput = document.getElementById('town-search-input');
  const searchResults = document.getElementById('town-search-results');
  const searchClearBtn = document.getElementById('btn-search-clear');

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      if (searchClearBtn) searchClearBtn.style.display = q ? 'block' : 'none';

      if (!q) {
        searchResults.classList.remove('visible');
        return;
      }

      const matchedTowns = Object.values(AppState.townFeaturesById).filter(f =>
        f.properties.name.toLowerCase().includes(q) || f.properties.fullName.toLowerCase().includes(q)
      );
      const matchedDistricts = Object.values(AppState.districtFeaturesById).filter(df =>
        df.properties.name.toLowerCase().includes(q)
      );

      searchResults.innerHTML = '';
      
      matchedTowns.slice(0, 5).forEach(f => {
        const item = document.createElement('div');
        item.className = 'search-item';
        const tState = AppState.towns[f.properties.id];
        const ms = tState ? tState.milestone : 'none';
        const msBadge = ms !== 'none' ? `<span class="ms-pill-dot ${ms}" style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px;"></span>` : '';

        item.innerHTML = `<span style="display:flex;align-items:center;">${msBadge}<strong>${escapeHtml(f.properties.name)}</strong></span> <span style="font-size:10px; color:#64748b;">${escapeHtml(f.properties.kreis)}</span>`;
        item.addEventListener('click', () => {
          searchResults.classList.remove('visible');
          searchInput.value = f.properties.name;
          selectTown(f.properties.id, true);
        });
        searchResults.appendChild(item);
      });

      matchedDistricts.slice(0, 5).forEach(df => {
        const item = document.createElement('div');
        item.className = 'search-item';
        item.innerHTML = `
          <div>
            <strong>${escapeHtml(df.properties.name)}</strong>
            <span class="search-subpoint-badge">↳ Nachbarschaft von ${escapeHtml(df.properties.townName)}</span>
          </div>
          <span style="font-size:10px; color:#64748b;">Stadtteil</span>
        `;
        item.addEventListener('click', () => {
          searchResults.classList.remove('visible');
          searchInput.value = `${df.properties.townName} › ${df.properties.name}`;
          focusDistrictOnMap(df.properties.id);
        });
        searchResults.appendChild(item);
      });

      if (matchedTowns.length === 0 && matchedDistricts.length === 0) {
        searchResults.innerHTML = '<div style="padding:10px 14px;font-size:11px;color:#8e8e93;text-align:center;">Keine Treffer gefunden</div>';
      }

      searchResults.classList.add('visible');
    });

    if (searchClearBtn) {
      searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchClearBtn.style.display = 'none';
        searchResults.classList.remove('visible');
        searchInput.focus();
      });
    }

    // Global ⌘K / Ctrl+K shortcut to focus search
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
    });

    // Spotlight search keyboard accessibility (↑ / ↓ / Enter / Escape)
    let activeResultIdx = -1;

    searchInput.addEventListener('keydown', (e) => {
      const items = searchResults.querySelectorAll('.search-item');
      if (items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeResultIdx = (activeResultIdx + 1) % items.length;
        items.forEach((it, idx) => it.classList.toggle('keyboard-selected', idx === activeResultIdx));
        items[activeResultIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeResultIdx = (activeResultIdx - 1 + items.length) % items.length;
        items.forEach((it, idx) => it.classList.toggle('keyboard-selected', idx === activeResultIdx));
        items[activeResultIdx]?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (activeResultIdx >= 0 && items[activeResultIdx]) {
          items[activeResultIdx].click();
        } else if (items[0]) {
          items[0].click();
        }
      } else if (e.key === 'Escape') {
        searchResults.classList.remove('visible');
        activeResultIdx = -1;
        searchInput.blur();
      }
    });

    searchInput.addEventListener('input', () => {
      activeResultIdx = -1;
    });

  }

  // Close search when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.spotlight-search-capsule') && searchResults) {
      searchResults.classList.remove('visible');
    }
  });

  // Mobile Expandable Search
  const searchCapsule = document.getElementById('spotlight-search-capsule');
  if (searchCapsule && searchInput) {
    searchCapsule.addEventListener('click', () => {
      if (window.innerWidth <= 768) {
        searchCapsule.classList.add('mobile-expanded');
        searchInput.focus();
      }
    });

    searchInput.addEventListener('blur', () => {
      if (window.innerWidth <= 768 && !searchInput.value.trim()) {
        setTimeout(() => {
          if (document.activeElement !== searchInput) {
            searchCapsule.classList.remove('mobile-expanded');
          }
        }, 220);
      }
    });
  }

  // Collapsible Layers & Legend Header
  const legendToggle = document.getElementById('legend-header-toggle');
  if (legendToggle) {
    // On phone width, collapse legend by default on startup
    if (window.innerWidth <= 768) {
      const hud = document.getElementById('legend-hud');
      const chevron = document.getElementById('legend-chevron');
      if (hud) hud.classList.add('collapsed');
      if (chevron) chevron.textContent = '▴';
    }

    legendToggle.addEventListener('click', () => {
      const hud = document.getElementById('legend-hud');
      const chevron = document.getElementById('legend-chevron');
      if (hud) {
        hud.classList.toggle('collapsed');
        const isCollapsed = hud.classList.contains('collapsed');
        if (chevron) chevron.textContent = isCollapsed ? '▴' : '▾';
      }
    });
  }

  // Mobile More Actions Sheet
  const btnMobileMenu = document.getElementById('btn-mobile-more-menu');
  const mobileSheet = document.getElementById('mobile-actions-sheet');
  const btnCloseMobileActions = document.getElementById('btn-close-mobile-actions');

  if (btnMobileMenu && mobileSheet) {
    const closeMobileActions = () => mobileSheet.classList.remove('visible');
    btnMobileMenu.addEventListener('click', () => {
      mobileSheet.classList.add('visible');
    });
    if (btnCloseMobileActions) btnCloseMobileActions.addEventListener('click', closeMobileActions);
    mobileSheet.addEventListener('click', (e) => {
      if (e.target === mobileSheet) closeMobileActions();
    });

    document.getElementById('mobile-act-report')?.addEventListener('click', () => {
      closeMobileActions();
      openClusterReportModal();
    });
    document.getElementById('mobile-act-png')?.addEventListener('click', () => {
      closeMobileActions();
      exportMapAsPng();
    });
    document.getElementById('mobile-act-share')?.addEventListener('click', () => {
      closeMobileActions();
      openShareModal();
    });
    document.getElementById('mobile-act-backups')?.addEventListener('click', () => {
      closeMobileActions();
      openBackupManagerModal();
    });
    document.getElementById('mobile-act-legal')?.addEventListener('click', () => {
      closeMobileActions();
      document.getElementById('legal-modal')?.classList.add('visible');
    });
    document.getElementById('mobile-act-undo')?.addEventListener('click', () => {
      undo();
    });
    document.getElementById('mobile-act-redo')?.addEventListener('click', () => {
      redo();
    });
    document.getElementById('mobile-act-reset')?.addEventListener('click', () => {
      closeMobileActions();
      document.getElementById('menu-item-reset')?.click();
    });
  }

  // Draggable Bottom Sheet Handler on Mobile
  const dragHandle = document.getElementById('drawer-drag-handle');
  const detailsDrawer = document.getElementById('details-drawer');
  if (dragHandle && detailsDrawer) {
    let touchStartY = 0;
    let touchCurrentY = 0;

    dragHandle.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        touchStartY = e.touches[0].clientY;
        touchCurrentY = touchStartY;
      }
    }, { passive: true });

    dragHandle.addEventListener('touchmove', (e) => {
      if (e.touches.length > 0) {
        touchCurrentY = e.touches[0].clientY;
      }
    }, { passive: true });

    dragHandle.addEventListener('touchend', () => {
      const diffY = touchCurrentY - touchStartY;
      if (diffY > 55) {
        // Dragged down -> close drawer
        zoomToClusterOverview(true);
      } else if (diffY < -40) {
        // Dragged up -> expand tall
        detailsDrawer.classList.toggle('expanded-tall');
      }
    });
  }

  // Arrow modals & buttons
  document.getElementById('btn-save-new-arrow').addEventListener('click', saveNewArrowFromModal);
  document.getElementById('btn-close-new-arrow-modal').addEventListener('click', () => {
    document.getElementById('new-arrow-modal').classList.remove('visible');
    cancelArrowDrawing();
    setMode('inspect');
  });
  document.getElementById('btn-cancel-new-arrow-modal').addEventListener('click', () => {
    document.getElementById('new-arrow-modal').classList.remove('visible');
    cancelArrowDrawing();
    setMode('inspect');
  });

  document.getElementById('btn-close-view-dep-modal').addEventListener('click', () => {
    document.getElementById('view-dep-modal').classList.remove('visible');
  });

  // Report Modal
  document.getElementById('btn-open-report').addEventListener('click', openClusterReportModal);
  document.getElementById('btn-close-report-modal').addEventListener('click', () => {
    document.getElementById('report-modal').classList.remove('visible');
  });

  // Export PNG Image
  document.getElementById('btn-export-png').addEventListener('click', exportMapAsPng);

  // Unified Apple-style Projekt Menu
  const btnProjectMenu = document.getElementById('btn-project-menu');
  const projectDropdownMenu = document.getElementById('project-dropdown-menu');

  if (btnProjectMenu && projectDropdownMenu) {
    btnProjectMenu.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVis = projectDropdownMenu.classList.toggle('visible');
      btnProjectMenu.setAttribute('aria-expanded', isVis ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#project-dropdown-container')) {
        projectDropdownMenu.classList.remove('visible');
        btnProjectMenu.setAttribute('aria-expanded', 'false');
      }
    });

    document.getElementById('menu-item-export')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      exportDataJson();
    });

    document.getElementById('menu-item-import')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      document.getElementById('json-file-input').click();
    });

    document.getElementById('menu-item-backups')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      renderBackupsList();
      document.getElementById('backups-modal').classList.add('visible');
    });

    document.getElementById('menu-item-onboarding')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      openOnboardingModal();
    });

    document.getElementById('menu-item-legal')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      document.getElementById('legal-modal').classList.add('visible');
    });

    document.getElementById('menu-item-reset')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      resetToCleanData();
    });
  }

  // Onboarding Guide Modal
  const openOnboardingModal = () => document.getElementById('onboarding-modal')?.classList.add('visible');
  const closeOnboardingModal = () => {
    document.getElementById('onboarding-modal')?.classList.remove('visible');
    try { localStorage.setItem('rn_onboarding_seen_v1', 'true'); } catch (e) {}
  };
  document.getElementById('btn-close-onboarding')?.addEventListener('click', closeOnboardingModal);
  document.getElementById('btn-dismiss-onboarding')?.addEventListener('click', closeOnboardingModal);
  document.getElementById('mobile-act-onboarding')?.addEventListener('click', () => {
    closeMobileActions();
    openOnboardingModal();
  });

  // Check first-time visit (auto-open if user hasn't seen it and no share payload loaded)
  try {
    const hasSeen = localStorage.getItem('rn_onboarding_seen_v1');
    const hasShareHash = window.location.hash && window.location.hash.includes('share=');
    if (!hasSeen && !hasShareHash) {
      setTimeout(openOnboardingModal, 800);
    }
  } catch (e) {}

  // Legal & Privacy modal
  const openLegalModal = () => document.getElementById('legal-modal')?.classList.add('visible');
  const closeLegalModal = () => document.getElementById('legal-modal')?.classList.remove('visible');
  document.getElementById('btn-open-legal-legend')?.addEventListener('click', openLegalModal);
  document.getElementById('btn-close-legal-modal')?.addEventListener('click', closeLegalModal);
  document.getElementById('btn-close-legal-sheet')?.addEventListener('click', closeLegalModal);

  document.getElementById('legal-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'legal-modal') closeLegalModal();
  });

  // Storage Persistence & Quick Export
  document.getElementById('btn-request-persistence')?.addEventListener('click', async () => {
    await AppStorage.requestPersistence();
    await updatePersistenceStatus();
  });
  document.getElementById('btn-quick-json-export')?.addEventListener('click', () => {
    exportDataJson();
  });

  // Import Diff Resolution Modal
  const closeImportDiff = () => {
    document.getElementById('import-diff-modal')?.classList.remove('visible');
    pendingImportData = null;
  };
  document.getElementById('btn-close-import-diff-modal')?.addEventListener('click', closeImportDiff);
  document.getElementById('btn-cancel-import-diff')?.addEventListener('click', closeImportDiff);
  document.getElementById('import-diff-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'import-diff-modal') closeImportDiff();
  });
  document.getElementById('btn-execute-import-merge')?.addEventListener('click', executeImportMerge);
  document.getElementById('btn-execute-import-replace')?.addEventListener('click', executeImportReplace);

  document.getElementById('json-file-input').addEventListener('change', handleImportJson);

  // Sharable Links & Cloud Share Event Listeners
  document.getElementById('btn-share-link')?.addEventListener('click', openShareModal);
  document.getElementById('menu-item-share')?.addEventListener('click', () => {
    const projMenu = document.getElementById('project-dropdown-menu');
    const projBtn = document.getElementById('btn-project-menu');
    if (projMenu) projMenu.classList.remove('visible');
    if (projBtn) projBtn.setAttribute('aria-expanded', 'false');
    openShareModal();
  });
  document.getElementById('btn-close-share-modal')?.addEventListener('click', closeShareModal);
  document.getElementById('btn-close-share-sheet')?.addEventListener('click', closeShareModal);
  document.getElementById('btn-copy-share-link')?.addEventListener('click', copyShareLink);
  document.getElementById('btn-native-share')?.addEventListener('click', nativeShare);
  document.getElementById('btn-toggle-qr')?.addEventListener('click', toggleShareQr);
  document.getElementById('share-link-input')?.addEventListener('click', (e) => e.target.select());
  document.getElementById('share-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'share-modal') closeShareModal();
  });

  // Share Import Banner Listeners
  document.getElementById('btn-apply-shared-data')?.addEventListener('click', applySharedDataFromBanner);
  document.getElementById('btn-preview-shared-data')?.addEventListener('click', previewSharedDataFromBanner);
  document.getElementById('btn-dismiss-shared-data')?.addEventListener('click', dismissSharedDataBanner);
}

function initStepper(name, onChange) {
  const decBtn = document.getElementById(`btn-dec-${name}`);
  const incBtn = document.getElementById(`btn-inc-${name}`);
  const input = document.getElementById(`drawer-${name}`);
  if (!decBtn || !incBtn || !input) return;

  decBtn.addEventListener('click', () => {
    pushHistory(`Zähler ${name} verringert`);
    let val = Math.max(0, (parseInt(input.value) || 0) - 1);
    input.value = val;
    onChange(val);
  });
  incBtn.addEventListener('click', () => {
    pushHistory(`Zähler ${name} erhöht`);
    let val = (parseInt(input.value) || 0) + 1;
    input.value = val;
    onChange(val);
  });
  input.addEventListener('change', () => {
    pushHistory(`Zähler ${name} geändert`);
    let val = Math.max(0, parseInt(input.value) || 0);
    input.value = val;
    onChange(val);
  });
}

function updateCurrentActivity(actKey, val) {
  let target = null;
  if (AppState.selectedDistrictId) {
    target = AppState.districts[AppState.selectedDistrictId];
  } else if (AppState.selectedTownId) {
    target = AppState.towns[AppState.selectedTownId];
  }
  if (!target) return;

  if (!target.activities) target.activities = {};
  target.activities[actKey] = val;
  document.getElementById('drawer-act-total').textContent = calculateTotalActivities(target.activities);
  saveState();
  refreshAllStyles();
}

function updateClusterStats() {
  const towns = Object.values(AppState.towns);
  const totalTowns = Object.keys(AppState.townFeaturesById).length || 133;
  
  let reachedTowns = 0;
  let countIpgPlus = 0;
  let countIpg = 0;
  let countPg = 0;
  let totalNuclei = 0;
  let totalDevotionals = 0;
  let totalStudyCircles = 0;
  let totalChildren = 0;
  let totalJuniorYouth = 0;
  let totalCenters = 0;

  towns.forEach(t => {
    if (t.milestone && t.milestone !== 'none') {
      reachedTowns++;
      if (t.milestone === 'ipg_plus') countIpgPlus++;
      else if (t.milestone === 'ipg') countIpg++;
      else countPg++;
    }
    if (t.isCenter) totalCenters++;
    totalNuclei += (t.nuclei || 0);
    if (t.activities) {
      totalDevotionals += (t.activities.devotionals || 0);
      totalStudyCircles += (t.activities.studyCircles || 0);
      totalChildren += (t.activities.childrenClasses || 0);
      totalJuniorYouth += (t.activities.juniorYouth || 0);
    }
  });

  Object.values(AppState.districts).forEach(d => {
    totalNuclei += (d.nuclei || 0);
    if (d.activities) {
      totalDevotionals += (d.activities.devotionals || 0);
      totalStudyCircles += (d.activities.studyCircles || 0);
      totalChildren += (d.activities.childrenClasses || 0);
      totalJuniorYouth += (d.activities.juniorYouth || 0);
    }
  });

  const totalActs = totalDevotionals + totalStudyCircles + totalChildren + totalJuniorYouth;
  const totalDeployments = AppState.deployments.length;

  const statTownsEl = document.getElementById('stat-towns');
  if (statTownsEl) statTownsEl.textContent = `${reachedTowns} / ${totalTowns} aktiv`;

  const percentEl = document.getElementById('vitality-percent');
  const pct = Math.round((reachedTowns / totalTowns) * 100);
  if (percentEl) percentEl.textContent = `(${pct}%)`;

  const vSegIpgPlus = document.getElementById('vseg-ipg-plus');
  const vSegIpg = document.getElementById('vseg-ipg');
  const vSegPg = document.getElementById('vseg-pg');
  if (vSegIpgPlus && vSegIpg && vSegPg) {
    vSegIpgPlus.style.width = `${(countIpgPlus / totalTowns) * 100}%`;
    vSegIpg.style.width = `${(countIpg / totalTowns) * 100}%`;
    vSegPg.style.width = `${(countPg / totalTowns) * 100}%`;
  }

  const elNuclei = document.getElementById('stat-nuclei');
  if (elNuclei) elNuclei.textContent = totalNuclei;
  const elActs = document.getElementById('stat-activities');
  if (elActs) elActs.textContent = totalActs;
  const elDeps = document.getElementById('stat-deployments');
  if (elDeps) elDeps.textContent = totalDeployments;
  const elCenters = document.getElementById('stat-centers');
  if (elCenters) elCenters.textContent = totalCenters;
}

let reportSortState = { column: 'name', asc: true };
let reportSubpointsExpanded = true;

function renderReportTableRows() {
  const tbody = document.getElementById('report-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const q = (document.getElementById('report-search-input')?.value || '').trim().toLowerCase();
  const filterKreis = document.getElementById('report-filter-kreis')?.value || 'all';
  const filterMs = document.getElementById('report-filter-ms')?.value || 'all';

  let features = Object.values(AppState.townFeaturesById);

  // Filter Kreis
  if (filterKreis !== 'all') {
    if (filterKreis === 'Kreisfreie Städte') {
      const kreisfrei = ['Mannheim', 'Heidelberg', 'Ludwigshafen am Rhein', 'Frankenthal (Pfalz)', 'Speyer', 'Neustadt an der Weinstraße'];
      features = features.filter(f => kreisfrei.includes(f.properties.name));
    } else {
      features = features.filter(f => (f.properties.kreis || '').includes(filterKreis));
    }
  }

  // Filter Search
  if (q) {
    features = features.filter(f => {
      const nameMatch = f.properties.name.toLowerCase().includes(q);
      const kreisMatch = (f.properties.kreis || '').toLowerCase().includes(q);
      const districtMatch = Object.values(AppState.districtFeaturesById).some(
        df => df.properties.townId === f.properties.id && df.properties.name.toLowerCase().includes(q)
      );
      return nameMatch || kreisMatch || districtMatch;
    });
  }

  // Filter Milestone
  if (filterMs !== 'all') {
    if (filterMs === 'active') {
      features = features.filter(f => {
        const t = AppState.towns[f.properties.id];
        return t && t.milestone && t.milestone !== 'none';
      });
    } else {
      features = features.filter(f => {
        const t = AppState.towns[f.properties.id];
        return (t?.milestone || 'none') === filterMs;
      });
    }
  }

  // Sort
  features.sort((a, b) => {
    const tA = AppState.towns[a.properties.id] || {};
    const tB = AppState.towns[b.properties.id] || {};
    let valA, valB;
    if (reportSortState.column === 'name') {
      valA = a.properties.name;
      valB = b.properties.name;
      return reportSortState.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else if (reportSortState.column === 'kreis') {
      valA = a.properties.kreis || '';
      valB = b.properties.kreis || '';
      return reportSortState.asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else if (reportSortState.column === 'milestone') {
      const rank = { ipg_plus: 4, ipg: 3, pg: 2, custom: 1, none: 0 };
      valA = rank[tA.milestone || 'none'] || 0;
      valB = rank[tB.milestone || 'none'] || 0;
    } else if (reportSortState.column === 'nuclei') {
      valA = Number(tA.nuclei) || 0;
      valB = Number(tB.nuclei) || 0;
    } else if (reportSortState.column === 'acts') {
      valA = calculateTotalActivities(tA.activities);
      valB = calculateTotalActivities(tB.activities);
    } else {
      valA = a.properties.name;
      valB = b.properties.name;
      return valA.localeCompare(valB);
    }
    return reportSortState.asc ? (valA > valB ? 1 : -1) : (valA < valB ? 1 : -1);
  });

  features.forEach(f => {
    const id = f.properties.id;
    const town = AppState.towns[id] || { milestone: 'none', nuclei: 0, activities: {} };
    const acts = town.activities || {};
    const totalActs = calculateTotalActivities(acts);
    const districts = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === id);
    const distCount = districts.length;

    // Shorten Landkreis Rhein-Neckar-Kreis -> Rhein-Neckar-Kreis
    const cleanKreis = (f.properties.kreis || '').replace(/^Landkreis\s+/, '');

    const tr = document.createElement('tr');
    tr.className = `report-town-row ${distCount > 0 ? 'has-subpoints' : ''}`;
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(f.properties.name)}</strong>
        ${distCount > 0 ? `<button type="button" class="town-expand-btn">${reportSubpointsExpanded ? '▼' : '▶'} ${distCount} Stadtteile</button>` : ''}
      </td>
      <td><span style="font-size:11px; color:#64748b; white-space:nowrap;">${escapeHtml(cleanKreis)}</span></td>
      <td>
        <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600;">
          <span style="width:10px; height:10px; border-radius:50%; background:${getMilestoneColor(town.milestone)};"></span>
          ${escapeHtml(getMilestoneLabel(town.milestone))}
        </span>
      </td>
      <td><strong>${Number(town.nuclei) || 0}</strong></td>
      <td><strong>${totalActs}</strong></td>
      <td>${town.isCenter ? '<span style="color:var(--system-orange); font-weight:600;">★ Zentrum</span>' : '-'}</td>
      <td>${AppState.deployments.filter(d => d.fromId === id || d.toId === id).length}</td>
      <td>
        <button type="button" class="btn btn-secondary btn-jump-town" style="padding: 3px 8px; font-size: 11px;">Details</button>
      </td>
    `;
    tr.querySelector('.btn-jump-town').addEventListener('click', () => jumpToTownFromReport(id));
    if (distCount > 0) {
      tr.querySelector('.town-expand-btn').addEventListener('click', (e) => toggleReportSubpoints(id, e.currentTarget));
    }
    tbody.appendChild(tr);

    if (distCount > 0) {
      districts.forEach(df => {
        const dId = df.properties.id;
        const dist = AppState.districts[dId] || { milestone: 'none', nuclei: 0, activities: {} };
        const dActs = calculateTotalActivities(dist.activities);

        const subTr = document.createElement('tr');
        subTr.className = `report-subpoint-row report-sub-${id}`;
        subTr.style.display = reportSubpointsExpanded ? 'table-row' : 'none';
        subTr.innerHTML = `
          <td style="padding-left: 28px;">
            <span class="subpoint-branch-icon">↳</span>
            <span style="font-weight: 500;">${escapeHtml(df.properties.name)}</span>
            <span class="subpoint-label-badge">Stadtteil</span>
          </td>
          <td><span style="font-size:11px; color:var(--text-tertiary);">${escapeHtml(f.properties.name)}</span></td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px;">
              <span style="width:8px; height:8px; border-radius:50%; background:${getMilestoneColor(dist.milestone)};"></span>
              ${escapeHtml(getMilestoneLabel(dist.milestone))}
            </span>
          </td>
          <td>${Number(dist.nuclei) || 0}</td>
          <td>${dActs}</td>
          <td style="color:var(--text-tertiary);">-</td>
          <td>${AppState.deployments.filter(d => d.fromId === dId || d.toId === dId).length}</td>
          <td>
            <button type="button" class="btn btn-secondary btn-jump-dist" style="padding: 2px 7px; font-size: 10px;">Fokus</button>
          </td>
        `;
        subTr.querySelector('.btn-jump-dist').addEventListener('click', () => jumpToDistrictFromReport(id, dId));
        tbody.appendChild(subTr);
      });
    }
  });

  if (features.length === 0) {
    const emptyTr = document.createElement('tr');
    emptyTr.innerHTML = `<td colspan="8" style="text-align:center; padding: 24px; color: var(--text-tertiary); font-style:italic;">Keine Ortschaften gefunden, die den Filterkriterien entsprechen.</td>`;
    tbody.appendChild(emptyTr);
  }
}

function openClusterReportModal() {
  // Update Overview Metric Cards
  const towns = Object.values(AppState.towns);
  const activeCount = towns.filter(t => t.milestone && t.milestone !== 'none').length;
  const pgCount = towns.filter(t => t.milestone === 'pg').length;
  const ipgCount = towns.filter(t => t.milestone === 'ipg').length;
  const ipgPlusCount = towns.filter(t => t.milestone === 'ipg_plus').length;
  const totalNuclei = towns.reduce((s, t) => s + (Number(t.nuclei) || 0), 0) + Object.values(AppState.districts).reduce((s, d) => s + (Number(d.nuclei) || 0), 0);
  const totalActs = towns.reduce((s, t) => s + calculateTotalActivities(t.activities), 0) + Object.values(AppState.districts).reduce((s, d) => s + calculateTotalActivities(d.activities), 0);
  const totalDeps = (AppState.deployments || []).length;

  const elActive = document.getElementById('rep-card-active');
  if (elActive) elActive.textContent = `${activeCount} / 133`;
  const elMs = document.getElementById('rep-card-ms');
  if (elMs) elMs.textContent = `${pgCount} PG · ${ipgCount} IPG · ${ipgPlusCount} IPG+`;
  const elNuc = document.getElementById('rep-card-nuclei');
  if (elNuc) elNuc.textContent = totalNuclei;
  const elActs = document.getElementById('rep-card-acts');
  if (elActs) elActs.textContent = totalActs;
  const elDeps = document.getElementById('rep-card-deps');
  if (elDeps) elDeps.textContent = totalDeps;

  // Setup event listeners for toolbar once
  if (!window._reportListenersAttached) {
    window._reportListenersAttached = true;
    document.getElementById('report-search-input')?.addEventListener('input', renderReportTableRows);
    document.getElementById('report-filter-kreis')?.addEventListener('change', renderReportTableRows);
    document.getElementById('report-filter-ms')?.addEventListener('change', renderReportTableRows);

    // Column sorting clicks
    document.querySelectorAll('#cluster-report-table th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;
        if (reportSortState.column === col) {
          reportSortState.asc = !reportSortState.asc;
        } else {
          reportSortState.column = col;
          reportSortState.asc = true;
        }
        renderReportTableRows();
      });
    });

    // Toggle expand/collapse all subpoints
    document.getElementById('btn-report-toggle-all')?.addEventListener('click', () => {
      reportSubpointsExpanded = !reportSubpointsExpanded;
      const btn = document.getElementById('btn-report-toggle-all');
      if (btn) btn.textContent = reportSubpointsExpanded ? 'Stadtteile zuklappen' : 'Stadtteile aufklappen';
      renderReportTableRows();
    });

    // CSV Export
    document.getElementById('btn-export-report-csv')?.addEventListener('click', exportReportToCsv);

    // Print
    document.getElementById('btn-print-report')?.addEventListener('click', () => window.print());
  }

  renderReportTableRows();
  document.getElementById('report-modal').classList.add('visible');
}

function exportReportToCsv() {
  const rows = [
    ['Typ', 'Ortschaft / Stadtteil', 'Übergeordneter Ort', 'Kreis', 'Meilenstein', 'Nuklei', 'Andachten', 'Studienkreise', 'Kinderklassen', 'Junioren', 'Aktivitäten Gesamt', 'Entsende-Zentrum', 'Verknüpfte Pfeile']
  ];

  Object.values(AppState.townFeaturesById).forEach(f => {
    const id = f.properties.id;
    const t = AppState.towns[id] || {};
    const acts = t.activities || {};
    const cleanKreis = (f.properties.kreis || '').replace(/^Landkreis\s+/, '');
    const depCount = AppState.deployments.filter(d => d.fromId === id || d.toId === id).length;

    rows.push([
      'Kommune',
      f.properties.name,
      '',
      cleanKreis,
      getMilestoneLabel(t.milestone || 'none'),
      Number(t.nuclei) || 0,
      Number(acts.devotionals) || 0,
      Number(acts.studyCircles) || 0,
      Number(acts.childrenClasses) || 0,
      Number(acts.juniorYouth) || 0,
      calculateTotalActivities(acts),
      t.isCenter ? 'Ja' : 'Nein',
      depCount
    ]);

    const districts = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === id);
    districts.forEach(df => {
      const dId = df.properties.id;
      const d = AppState.districts[dId] || {};
      const dActs = d.activities || {};
      const distDepCount = AppState.deployments.filter(dep => dep.fromId === dId || dep.toId === dId).length;

      rows.push([
        'Stadtteil',
        df.properties.name,
        f.properties.name,
        cleanKreis,
        getMilestoneLabel(d.milestone || 'none'),
        Number(d.nuclei) || 0,
        Number(dActs.devotionals) || 0,
        Number(dActs.studyCircles) || 0,
        Number(dActs.childrenClasses) || 0,
        Number(dActs.juniorYouth) || 0,
        calculateTotalActivities(dActs),
        'Nein',
        distDepCount
      ]);
    });
  });

  const csvContent = '\uFEFF' + rows.map(e => e.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(';')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rhein_neckar_cluster_bericht_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showInAppAlert('Bericht erfolgreich als CSV exportiert ✓', 'success');
}

window.toggleReportSubpoints = function(townId, btn) {
  const rows = document.querySelectorAll(`.report-sub-${townId}`);
  const isHidden = rows.length > 0 && rows[0].style.display === 'none';
  rows.forEach(r => r.style.display = isHidden ? 'table-row' : 'none');
  const count = rows.length;
  btn.textContent = isHidden ? `▼ ${count} Stadtteile` : `▶ ${count} Stadtteile`;
};

window.jumpToTownFromReport = function(townId) {
  document.getElementById('report-modal').classList.remove('visible');
  selectTown(townId, true);
};

window.jumpToDistrictFromReport = function(townId, districtId) {
  document.getElementById('report-modal').classList.remove('visible');
  focusDistrictOnMap(districtId);
};


// --- Metadata Tracking & Export Reminders ---
function recordExportTimestamp() {
  try {
    const meta = getStoredMeta();
    meta.lastExportedAt = Date.now();
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(meta));
  } catch (e) {}
  updateExportIndicators();
}

function getStoredMeta() {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : { lastExportedAt: null };
  } catch (e) {
    return { lastExportedAt: null };
  }
}

function updateExportIndicators() {
  const meta = getStoredMeta();
  const daysEl = document.getElementById('export-days-indicator');
  const menuEl = document.getElementById('menu-export-status-text');

  if (!meta.lastExportedAt) {
    if (daysEl) daysEl.textContent = 'Zuletzt exportiert: Nie';
    if (menuEl) {
      menuEl.textContent = 'Noch nie gesichert ⚠️';
      menuEl.style.color = 'var(--system-orange)';
    }
    return;
  }

  const days = Math.floor((Date.now() - meta.lastExportedAt) / (1000 * 60 * 60 * 24));
  let text = '';
  if (days === 0) text = 'Heute';
  else if (days === 1) text = 'Gestern';
  else text = `Vor ${days} Tagen`;

  if (daysEl) daysEl.textContent = `Zuletzt exportiert: ${text}`;
  if (menuEl) {
    menuEl.textContent = `${text} ${days >= 7 ? '⚠️' : '✓'}`;
    menuEl.style.color = (days >= 7 ? 'var(--system-orange)' : 'var(--text-secondary)');
  }
}

async function updatePersistenceStatus() {
  const labelEl = document.getElementById('storage-persistence-label');
  const btnReq = document.getElementById('btn-request-persistence');
  if (!labelEl) return;

  if (navigator.storage && navigator.storage.persisted) {
    const isPersisted = await navigator.storage.persisted();
    if (isPersisted) {
      labelEl.textContent = 'Dauerhafter Speicher aktiv (Geschützt vor Bereinigung)';
      labelEl.parentElement.style.color = 'var(--system-green)';
      if (btnReq) {
        btnReq.textContent = '✓ Dauerhaft geschützt';
        btnReq.disabled = true;
      }
    } else {
      labelEl.textContent = 'Standard-Speicher (Safari-Warnung nach 7 Tagen)';
      labelEl.parentElement.style.color = 'var(--apple-blue)';
      if (btnReq) {
        btnReq.textContent = 'Dauerhaften Speicher anfordern';
        btnReq.disabled = false;
      }
    }
  }
}

function checkMigrationOnStartup() {
  let rawParam = null;
  if (window.location.hash && window.location.hash.includes('migrate=')) {
    const match = window.location.hash.match(/migrate=([^&]+)/);
    if (match) rawParam = match[1];
  } else if (window.location.search && window.location.search.includes('migrate=')) {
    const urlParams = new URLSearchParams(window.location.search);
    rawParam = urlParams.get('migrate');
  }
  if (!rawParam) return;

  try {
    const raw = decodeURIComponent(rawParam);
    let jsonStr;
    try {
      jsonStr = decodeURIComponent(escape(atob(raw)));
    } catch (e) {
      jsonStr = atob(raw);
    }
    const bundle = JSON.parse(jsonStr);

    if (bundle && bundle.data) {
      saveAutoBackup('Vor Plattform-Migration', true);
      if (bundle.data.towns) AppState.towns = bundle.data.towns;
      if (bundle.data.districts) AppState.districts = bundle.data.districts;
      if (bundle.data.deployments) AppState.deployments = bundle.data.deployments;
      saveState();

      if (bundle.backups && Array.isArray(bundle.backups) && bundle.backups.length > 0) {
        const curBackups = getStoredBackups();
        const merged = [...curBackups, ...bundle.backups].slice(0, MAX_BACKUPS);
        try {
          localStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(merged));
        } catch (e) {}
      }

      refreshAllStyles();
      refreshMarkers();
      renderArrows();
      updateClusterStats();

      // Clean hash
      history.replaceState(null, '', window.location.pathname);
      showInAppAlert('Deine Daten und Sicherungen von der vorherigen Plattform wurden erfolgreich übertragen!', 'success');
    }
  } catch (err) {
    console.error("Migration handover parse error:", err);
  }
}

// --- Safe Import & Diff Resolution ---
let pendingImportData = null; // { sourceName, towns, districts, deployments }

function showImportDiffModal(sourceName, incomingTowns, incomingDistricts, incomingDeployments) {
  let newTowns = 0;
  let updatedTowns = 0;
  let unchangedTowns = 0;

  const currentTownIds = new Set(Object.keys(AppState.towns));
  const incomingTownIds = new Set(Object.keys(incomingTowns || {}));

  for (const [id, inc] of Object.entries(incomingTowns || {})) {
    const cur = AppState.towns[id] || { milestone: 'none', nuclei: 0, activities: {}, notes: '', isCenter: false };
    const curActive = (cur.milestone && cur.milestone !== 'none') || (cur.nuclei > 0);
    const incActive = (inc.milestone && inc.milestone !== 'none') || (inc.nuclei > 0);

    const hasDiff = cur.milestone !== (inc.milestone || 'none') ||
      (cur.nuclei || 0) !== (inc.nuclei || 0) ||
      (cur.notes || '').trim() !== (inc.notes || '').trim() ||
      !!cur.isCenter !== !!inc.isCenter;

    if (!curActive && incActive) {
      newTowns++;
    } else if (hasDiff) {
      updatedTowns++;
    } else {
      unchangedTowns++;
    }
  }

  currentTownIds.forEach(id => {
    if (!incomingTownIds.has(id)) {
      unchangedTowns++;
    }
  });

  const depCount = (incomingDeployments || []).length;

  const elNew = document.getElementById('diff-count-new');
  if (elNew) elNew.textContent = newTowns;
  const elUpd = document.getElementById('diff-count-updated');
  if (elUpd) elUpd.textContent = updatedTowns;
  const elUnc = document.getElementById('diff-count-unchanged');
  if (elUnc) elUnc.textContent = unchangedTowns;
  const elDep = document.getElementById('diff-count-deployments');
  if (elDep) elDep.textContent = depCount;

  const sourceInfoEl = document.getElementById('import-diff-source-info');
  if (sourceInfoEl) {
    sourceInfoEl.textContent = `Datensatz aus "${sourceName}" geladen. Wähle, wie dieser mit deiner bisherigen Karte abgeglichen werden soll:`;
  }

  pendingImportData = {
    sourceName,
    towns: incomingTowns,
    districts: incomingDistricts || {},
    deployments: incomingDeployments || []
  };

  const modal = document.getElementById('import-diff-modal');
  if (modal) modal.classList.add('visible');
}

function executeImportMerge() {
  if (!pendingImportData) return;
  saveAutoBackup(`Vor Zusammenführen (${pendingImportData.sourceName})`, true);
  pushHistory(`Zusammenführen: ${pendingImportData.sourceName}`);

  // Merge towns
  for (const [id, inc] of Object.entries(pendingImportData.towns)) {
    if (!AppState.towns[id]) {
      AppState.towns[id] = JSON.parse(JSON.stringify(inc));
      continue;
    }
    const cur = AppState.towns[id];
    if (inc.milestone && inc.milestone !== 'none' && (!cur.milestone || cur.milestone === 'none')) {
      cur.milestone = inc.milestone;
    }
    if ((inc.nuclei || 0) > (cur.nuclei || 0)) {
      cur.nuclei = inc.nuclei;
    }
    if (inc.activities) {
      cur.activities = cur.activities || {};
      ['devotionals', 'studyCircles', 'childrenClasses', 'juniorYouth'].forEach(k => {
        cur.activities[k] = Math.max(cur.activities[k] || 0, inc.activities[k] || 0);
      });
    }
    if (inc.isCenter) cur.isCenter = true;
    if (inc.notes && inc.notes.trim()) {
      if (!cur.notes || !cur.notes.trim()) {
        cur.notes = inc.notes.trim();
      } else if (!cur.notes.includes(inc.notes.trim())) {
        cur.notes += `\n[${pendingImportData.sourceName}]: ${inc.notes.trim()}`;
      }
    }
  }

  // Merge districts
  for (const [id, inc] of Object.entries(pendingImportData.districts)) {
    if (!AppState.districts[id]) {
      AppState.districts[id] = JSON.parse(JSON.stringify(inc));
      continue;
    }
    const cur = AppState.districts[id];
    if (inc.milestone && inc.milestone !== 'none' && (!cur.milestone || cur.milestone === 'none')) {
      cur.milestone = inc.milestone;
    }
    if ((inc.nuclei || 0) > (cur.nuclei || 0)) {
      cur.nuclei = inc.nuclei;
    }
    if (inc.notes && inc.notes.trim() && !cur.notes.includes(inc.notes.trim())) {
      cur.notes = cur.notes ? `${cur.notes}\n${inc.notes.trim()}` : inc.notes.trim();
    }
  }

  // Merge deployments
  (pendingImportData.deployments || []).forEach(incDep => {
    const exists = AppState.deployments.some(d => d.fromId === incDep.fromId && d.toId === incDep.toId && d.type === incDep.type);
    if (!exists) {
      AppState.deployments.push({
        ...incDep,
        id: 'dep_mrg_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6)
      });
    }
  });

  saveState();
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  updateClusterStats();

  const modal = document.getElementById('import-diff-modal');
  if (modal) modal.classList.remove('visible');
  const banner = document.getElementById('share-import-banner');
  if (banner) banner.classList.remove('visible');

  pendingImportData = null;
  pendingSharedPayload = null;
  showInAppAlert('Daten wurden erfolgreich zusammengeführt! ✓', 'success');
}

function executeImportReplace() {
  if (!pendingImportData) return;
  saveAutoBackup(`Vor Ersetzen (${pendingImportData.sourceName})`, true);
  pushHistory(`Ersetzen: ${pendingImportData.sourceName}`);

  AppState.towns = pendingImportData.towns;
  AppState.districts = pendingImportData.districts;
  AppState.deployments = pendingImportData.deployments;

  saveState();
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  updateClusterStats();

  const modal = document.getElementById('import-diff-modal');
  if (modal) modal.classList.remove('visible');
  const banner = document.getElementById('share-import-banner');
  if (banner) banner.classList.remove('visible');

  pendingImportData = null;
  pendingSharedPayload = null;
  showInAppAlert('Projektstand wurde erfolgreich übernommen! ✓', 'success');
}

function parseSharedPayloadToEntities(payload) {
  const towns = {};
  Object.keys(AppState.townFeaturesById).forEach(id => {
    towns[id] = { milestone: 'none', nuclei: 0, isCenter: false, notes: '', activities: {} };
  });

  if (payload.t) {
    for (const [id, t] of Object.entries(payload.t)) {
      if (!towns[id]) towns[id] = { milestone: 'none', nuclei: 0, isCenter: false, notes: '', activities: {} };
      if (t.m) towns[id].milestone = t.m;
      if (t.n) towns[id].nuclei = t.n;
      if (t.c) towns[id].isCenter = true;
      if (t.nt) towns[id].notes = t.nt;
      if (t.col) towns[id].customColor = t.col;
    }
  }

  const districts = {};
  if (payload.d) {
    for (const [id, d] of Object.entries(payload.d)) {
      districts[id] = {
        milestone: d.m || 'none',
        nuclei: d.n || 0,
        isCenter: !!d.c,
        notes: d.nt || '',
        activities: {}
      };
    }
  }

  const deps = [];
  if (payload.dp && Array.isArray(payload.dp)) {
    payload.dp.forEach((d, idx) => {
      deps.push({
        id: 'dep_share_' + (idx + 1) + '_' + Date.now().toString(36),
        fromId: d.f,
        toId: d.t,
        count: d.c || 1,
        status: d.s || 'active',
        color: d.col || '#007aff',
        notes: d.nt || ''
      });
    });
  }

  return { towns, districts, deployments: deps };
}

function exportDataJson() {
  const exportObject = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    clusterName: "Rhein-Neckar",
    exportedAt: new Date().toISOString(),
    towns: AppState.towns,
    districts: AppState.districts,
    deployments: AppState.deployments
  };

  const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `rhein_neckar_cluster_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);

  recordExportTimestamp();
}

function handleImportJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      const validation = validateClusterDataset(data);
      if (!validation.valid) {
        showInAppAlert(`Importfehler: ${validation.error}`, 'error');
        e.target.value = '';
        return;
      }
      const sanitized = validation.sanitizedData;
      showImportDiffModal(file.name, sanitized.towns, sanitized.districts || {}, sanitized.deployments);
    } catch (err) {
      showInAppAlert(`Die JSON-Datei konnte nicht gelesen werden: ${err.message}`, 'error');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}


// ==========================================================================
// Sharable Links & Cloud Share Engine
// ==========================================================================

function getExportableData() {
  const activeTowns = {};
  for (const [id, t] of Object.entries(AppState.towns)) {
    if (!t) continue;
    const item = {};
    if (t.milestone && t.milestone !== 'none') item.m = t.milestone;
    if (t.nuclei) item.n = t.nuclei;
    if (t.isCenter) item.c = 1;
    if (t.notes && t.notes.trim()) item.nt = t.notes.trim();
    if (t.milestone === 'custom' && t.customColor) item.col = t.customColor;
    if (Object.keys(item).length > 0) {
      activeTowns[id] = item;
    }
  }

  const activeDistricts = {};
  for (const [id, d] of Object.entries(AppState.districts)) {
    if (!d) continue;
    const item = {};
    if (d.milestone && d.milestone !== 'none') item.m = d.milestone;
    if (d.nuclei) item.n = d.nuclei;
    if (d.isCenter) item.c = 1;
    if (d.notes && d.notes.trim()) item.nt = d.notes.trim();
    if (Object.keys(item).length > 0) {
      activeDistricts[id] = item;
    }
  }

  const deps = (AppState.deployments || []).map(d => {
    const item = { f: d.fromId, t: d.toId };
    if (d.count && d.count !== 1) item.c = d.count;
    if (d.status && d.status !== 'active') item.s = d.status;
    if (d.color) item.col = d.color;
    if (d.notes && d.notes.trim()) item.nt = d.notes.trim();
    return item;
  });

  return {
    v: 1,
    t: activeTowns,
    d: activeDistricts,
    dp: deps,
    ts: Date.now()
  };
}

async function encodeShareData(data) {
  const jsonStr = JSON.stringify(data);
  if (typeof CompressionStream !== 'undefined') {
    try {
      const stream = new Blob([jsonStr]).stream();
      const compStream = stream.pipeThrough(new CompressionStream('deflate-raw'));
      const buffer = await new Response(compStream).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return 'z_' + btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } catch (e) {
      console.warn('CompressionStream fallback:', e);
    }
  }
  const utf8 = unescape(encodeURIComponent(jsonStr));
  return 'b_' + btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function decodeShareData(encoded) {
  if (!encoded || typeof encoded !== 'string') throw new Error('Ungültiger Parameter');
  
  if (encoded.startsWith('z_')) {
    const rawB64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(rawB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    if (typeof DecompressionStream !== 'undefined') {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }
    throw new Error('DecompressionStream wird auf diesem Browser nicht unterstützt.');
  } else if (encoded.startsWith('b_')) {
    const rawB64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(rawB64);
    const jsonStr = decodeURIComponent(escape(binary));
    return JSON.parse(jsonStr);
  } else {
    return JSON.parse(decodeURIComponent(encoded));
  }
}

async function generateShareUrl() {
  const data = getExportableData();
  const encoded = await encodeShareData(data);
  const base = window.location.origin + window.location.pathname;
  return `${base}#share=${encoded}`;
}

async function openShareModal() {
  const modal = document.getElementById('share-modal');
  if (!modal) return;

  const input = document.getElementById('share-link-input');
  const indicator = document.getElementById('share-copied-indicator');
  const summary = document.getElementById('share-stats-summary');
  const qrContainer = document.getElementById('share-qr-container');
  const btnNativeShare = document.getElementById('btn-native-share');

  if (indicator) indicator.style.display = 'none';
  if (qrContainer) qrContainer.style.display = 'none';

  const townsActive = Object.values(AppState.towns).filter(t => t.milestone && t.milestone !== 'none').length;
  const nucleiCount = Object.values(AppState.towns).reduce((s, t) => s + (t.nuclei || 0), 0);
  const centersCount = Object.values(AppState.towns).filter(t => t.isCenter).length;
  const arrowCount = (AppState.deployments || []).length;

  if (summary) {
    summary.innerHTML = `
      <div class="share-stat-chip">🏘️ <strong>${townsActive}</strong> aktive Orte</div>
      <div class="share-stat-chip">➔ <strong>${arrowCount}</strong> Pfeile</div>
      <div class="share-stat-chip">★ <strong>${centersCount}</strong> Zentren</div>
      ${nucleiCount > 0 ? `<div class="share-stat-chip">🌱 <strong>${nucleiCount}</strong> Nuklei</div>` : ''}
    `;
  }

  try {
    input.value = "Erstelle teilbaren Link...";
    const shareUrl = await generateShareUrl();
    input.value = shareUrl;

    if (btnNativeShare) {
      btnNativeShare.style.display = (navigator.share ? 'inline-flex' : 'none');
    }
  } catch (err) {
    console.error("Share-Fehler:", err);
    input.value = window.location.href;
  }

  modal.classList.add('visible');
}

function closeShareModal() {
  const modal = document.getElementById('share-modal');
  if (modal) modal.classList.remove('visible');
}

async function copyShareLink() {
  const input = document.getElementById('share-link-input');
  const indicator = document.getElementById('share-copied-indicator');
  if (!input || !input.value) return;

  input.select();
  input.setSelectionRange(0, 99999);

  let success = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(input.value);
      success = true;
    }
  } catch (e) {}

  if (!success) {
    try {
      success = document.execCommand('copy');
    } catch (e) {}
  }

  if (indicator) {
    indicator.style.display = 'inline';
    setTimeout(() => {
      if (indicator) indicator.style.display = 'none';
    }, 3000);
  }
}

async function nativeShare() {
  const input = document.getElementById('share-link-input');
  if (!input || !input.value || !navigator.share) return;
  try {
    await navigator.share({
      title: 'Rhein-Neckar Cluster – Aktionskarte',
      text: 'Hier ist der aktuelle Stand der Rhein-Neckar Aktionskarte:',
      url: input.value
    });
  } catch (e) {
    if (e.name !== 'AbortError') console.warn('Share fehlgeschlagen:', e);
  }
}

function toggleShareQr() {
  const container = document.getElementById('share-qr-container');
  const img = document.getElementById('share-qr-image');
  const input = document.getElementById('share-link-input');
  if (!container || !img || !input) return;

  const isHidden = container.style.display === 'none' || !container.style.display;
  if (isHidden) {
    container.style.display = 'block';
    try {
      if (typeof qrcode === 'function') {
        const qr = qrcode(0, 'M');
        qr.addData(input.value);
        qr.make();
        img.src = qr.createDataURL(4, 6);
      } else {
        console.error('Local QR generator library not loaded');
      }
    } catch (err) {
      console.error('Error generating local QR code:', err);
    }
  } else {
    container.style.display = 'none';
  }
}

function applySharedPayload(payload, persist = true) {
  if (!payload) return;

  const newTowns = {};
  Object.keys(AppState.townFeaturesById).forEach(id => {
    newTowns[id] = { milestone: 'none', nuclei: 0, isCenter: false, notes: '' };
  });

  if (payload.t) {
    for (const [id, t] of Object.entries(payload.t)) {
      if (!newTowns[id]) {
        newTowns[id] = { milestone: 'none', nuclei: 0, isCenter: false, notes: '' };
      }
      if (t.m) newTowns[id].milestone = t.m;
      if (t.n) newTowns[id].nuclei = t.n;
      if (t.c) newTowns[id].isCenter = true;
      if (t.nt) newTowns[id].notes = t.nt;
      if (t.col) newTowns[id].customColor = t.col;
    }
  }
  AppState.towns = newTowns;

  const newDistricts = {};
  if (payload.d) {
    for (const [id, d] of Object.entries(payload.d)) {
      newDistricts[id] = {
        milestone: d.m || 'none',
        nuclei: d.n || 0,
        isCenter: !!d.c,
        notes: d.nt || ''
      };
    }
  }
  AppState.districts = newDistricts;

  const newDeployments = [];
  if (payload.dp && Array.isArray(payload.dp)) {
    payload.dp.forEach((d, idx) => {
      newDeployments.push({
        id: 'dep_share_' + (idx + 1) + '_' + Date.now().toString(36),
        fromId: d.f,
        toId: d.t,
        count: d.c || 1,
        status: d.s || 'active',
        color: d.col || '',
        notes: d.nt || ''
      });
    });
  }
  AppState.deployments = newDeployments;

  if (persist) {
    saveState();
  }
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  updateClusterStats();
}

let pendingSharedPayload = null;

async function checkShareUrlOnStartup() {
  try {
    let rawParam = null;
    if (window.location.hash && window.location.hash.includes('share=')) {
      const match = window.location.hash.match(/share=([^&]+)/);
      if (match) rawParam = match[1];
    } else {
      const urlParams = new URLSearchParams(window.location.search);
      rawParam = urlParams.get('share');
    }

    if (!rawParam) return;

    const rawPayload = await decodeShareData(rawParam);
    const validation = validateSharedPayload(rawPayload);
    if (!validation.valid) {
      console.warn('Ungültige Share-Nutzlast:', validation.error);
      return;
    }
    const payload = validation.sanitizedPayload;

    pendingSharedPayload = payload;

    const banner = document.getElementById('share-import-banner');
    const details = document.getElementById('share-banner-details');
    if (!banner || !details) return;

    const activeTownCount = Object.values(payload.t).filter(t => t.m && t.m !== 'none').length;
    const arrowCount = (payload.dp || []).length;
    const dateStr = payload.ts ? new Date(payload.ts).toLocaleDateString('de-DE') : 'kürzlich';

    const townText = activeTownCount > 0 ? `${activeTownCount} aktive Orte` : `${Object.keys(payload.t).length} Orte`;
    // Build safely with DOM methods to avoid XSS
    details.textContent = '';
    const textNode = document.createTextNode(`Geteilter Stand (${dateStr}): `);
    details.appendChild(textNode);
    const b1 = document.createElement('strong');
    b1.textContent = townText;
    details.appendChild(b1);
    details.appendChild(document.createTextNode(' · '));
    const b2 = document.createElement('strong');
    b2.textContent = `${arrowCount} Pfeile`;
    details.appendChild(b2);
    banner.classList.add('visible');

    // Automatically preview on the map
    applySharedPayload(payload, false);
  } catch (err) {
    console.warn("Konnte geteilten Link nicht laden:", err);
  }
}


function applySharedDataFromBanner() {
  if (!pendingSharedPayload) return;
  const parsed = parseSharedPayloadToEntities(pendingSharedPayload);
  const dateStr = pendingSharedPayload.ts ? new Date(pendingSharedPayload.ts).toLocaleDateString('de-DE') : 'kürzlich';
  showImportDiffModal(`Geteilter Stand (${dateStr})`, parsed.towns, parsed.districts, parsed.deployments);
}

function previewSharedDataFromBanner() {
  if (!pendingSharedPayload) return;
  applySharedPayload(pendingSharedPayload, false);
  const details = document.getElementById('share-banner-details');
  if (details) {
    details.innerHTML = `👀 <em>Vorschau aktiv</em> (deine lokalen Daten wurden noch nicht verändert)`;
  }
}

function dismissSharedDataBanner() {
  const banner = document.getElementById('share-import-banner');
  if (banner) banner.classList.remove('visible');
  loadStoredData();
  refreshAllStyles();
  refreshMarkers();
  renderArrows();
  updateClusterStats();
  history.replaceState(null, '', window.location.pathname + window.location.search);
  pendingSharedPayload = null;
}

async function exportMapAsPng() {
  if (typeof html2canvas === 'undefined') {
    showInAppAlert('Export-Bibliothek nicht geladen – bitte Seite neu laden.', 'error');
    return;
  }

  const btnExport = document.getElementById('btn-export-png');
  if (btnExport) {
    btnExport.style.opacity = '0.6';
    btnExport.style.pointerEvents = 'none';
  }

  // Close project menu dropdown
  const projDropdown = document.getElementById('project-dropdown-menu');
  if (projDropdown) projDropdown.classList.remove('visible');

  // Selectively hide all interactive overlay and HUD controls
  const uiElementsToHide = [
    document.querySelector('.map-floating-toolbar-container'),
    document.getElementById('zoom-nav-bar'),
    document.querySelector('.bottom-left-stack'),
    document.querySelector('.leaflet-control-zoom'),
    document.getElementById('arrow-quick-hud'),
    document.getElementById('arrow-instruction-banner'),
    document.getElementById('project-dropdown-menu'),
    document.getElementById('share-import-banner')
  ].filter(Boolean);

  const prevDisplays = uiElementsToHide.map(el => el.style.display);
  uiElementsToHide.forEach(el => el.style.display = 'none');

  // Temporarily collapse drawer if open so it doesn't obscure the map
  const drawer = document.getElementById('details-drawer');
  const wasDrawerOpen = drawer && !drawer.classList.contains('collapsed');
  if (wasDrawerOpen) drawer.classList.add('collapsed');

  try {
    const mapElem = document.getElementById('map-container');
    const scale = 2; // 2x Retina crisp resolution

    const canvas = await html2canvas(mapElem, {
      useCORS: true,
      scale: scale,
      backgroundColor: '#f8fafc',
      logging: false
    });

    const ctx = canvas.getContext('2d');
    // Critical: reset dirty scaling/translation matrix left by html2canvas
    ctx.resetTransform();

    const totalWidth = canvas.width;
    const totalHeight = canvas.height;

    // --- 1. Apple-Style Presentation Title Card (Top-Left) ---
    ctx.save();
    const cardX = 20 * scale;
    const cardY = 20 * scale;
    const cardW = 310 * scale;
    const cardH = 56 * scale;
    const radius = 12 * scale;

    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, radius);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1 * scale;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = "bold " + (14 * scale) + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('Rhein-Neckar · Aktionskarte', cardX + 14 * scale, cardY + 12 * scale);

    const townsActive = Object.values(AppState.towns).filter(t => t.milestone && t.milestone !== 'none').length;
    const depCount = (AppState.deployments || []).length;
    const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

    ctx.fillStyle = '#64748b';
    ctx.font = "500 " + (10.5 * scale) + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    ctx.fillText(townsActive + " / 133 aktiv · " + depCount + " Pfeile · Stand: " + dateStr, cardX + 14 * scale, cardY + 32 * scale);
    ctx.restore();

    // --- 2. Apple-Style Compact Map Legend (Bottom-Left) ---
    ctx.save();
    const legX = 20 * scale;
    const legW = 350 * scale;
    const legH = 42 * scale;
    const legY = totalHeight - legH - 20 * scale;

    ctx.shadowColor = 'rgba(0,0,0,0.10)';
    ctx.shadowBlur = 10 * scale;
    ctx.shadowOffsetY = 3 * scale;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    
    ctx.beginPath();
    ctx.roundRect(legX, legY, legW, legH, 10 * scale);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 1 * scale;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.stroke();

    const legItems = [
      { type: 'box', color: '#15803d', label: 'IPG+' },
      { type: 'box', color: '#22c55e', label: 'IPG' },
      { type: 'box', color: '#86efac', label: 'PG' },
      { type: 'star', color: '#ea580c', label: 'Zentrum' },
      { type: 'arrow', color: '#007aff', label: 'Pfeil' }
    ];

    let curX = legX + 14 * scale;
    const centerY = legY + (legH / 2);

    legItems.forEach(it => {
      if (it.type === 'box') {
        ctx.fillStyle = it.color;
        ctx.beginPath();
        ctx.roundRect(curX, centerY - 5.5 * scale, 11 * scale, 11 * scale, 2.5 * scale);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1 * scale;
        ctx.stroke();
        curX += 15 * scale;
      } else if (it.type === 'star') {
        ctx.fillStyle = it.color;
        ctx.font = "bold " + (12 * scale) + "px sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('★', curX, centerY);
        curX += 14 * scale;
      } else if (it.type === 'arrow') {
        ctx.fillStyle = it.color;
        ctx.font = "bold " + (12 * scale) + "px sans-serif";
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('➔', curX, centerY);
        curX += 16 * scale;
      }

      ctx.fillStyle = '#334155';
      ctx.font = "600 " + (10 * scale) + "px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.label, curX, centerY);
      curX += ctx.measureText(it.label).width + 12 * scale;
    });

    ctx.restore();

    // Trigger download
    const link = document.createElement('a');
    link.download = `rhein_neckar_karte_${new Date().toISOString().slice(0, 10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    console.error("Export-Fehler:", err);
    showInAppAlert(`Fehler beim Erstellen des Bildes: ${err.message || err}`, 'error');
  } finally {
    // Restore UI elements and drawer
    uiElementsToHide.forEach((el, i) => {
      el.style.display = prevDisplays[i] || '';
    });
    if (wasDrawerOpen && drawer) {
      drawer.classList.remove('collapsed');
    }
    if (btnExport) {
      btnExport.style.opacity = '';
      btnExport.style.pointerEvents = '';
    }
  }
}

function resetToCleanData() {
  showConfirmModal({
    title: 'Karte zurücksetzen',
    message: 'Möchtest du ALLE Daten (Meilensteine, Nuklei, Aktivitäten, Entsendungen, Notizen) auf den Anfangszustand zurücksetzen? Ein Sicherungsstand wird automatisch angelegt und kann über „Sicherungen" wiederhergestellt werden.',
    confirmText: 'Zurücksetzen',
    cancelText: 'Abbrechen',
    isDestructive: true,
    onConfirm: () => {
      saveAutoBackup("Vor Zurücksetzen gesichert", true);
      pushHistory("Vor Zurücksetzen gesichert");
      localStorage.removeItem(STORAGE_KEY);
      AppState.towns = {};
      AppState.districts = {};
      AppState.deployments = [];
      AppState.selectedTownId = null;
      AppState.selectedDistrictId = null;
      AppState.focusedTownId = null;
      loadStoredData();
      refreshAllStyles();
      refreshMarkers();
      renderArrows();
      updateClusterStats();
      document.getElementById('details-drawer').classList.add('collapsed');
      showInAppAlert('Karte wurde auf den Anfangszustand zurückgesetzt.', 'info');
    }
  });
}


function calculateTotalActivities(acts) {
  if (!acts) return 0;
  return (acts.devotionals || 0) + (acts.studyCircles || 0) + (acts.childrenClasses || 0) + (acts.juniorYouth || 0);
}

function getMilestoneLabel(m, format = 'standard') {
  const item = APP_TERMS.milestones[m] || APP_TERMS.milestones.none;
  if (format === 'short' || format === 'code') return item.code;
  if (format === 'full') return item.full;
  return item.standard;
}

function getMilestoneColor(m) {
  const item = APP_TERMS.milestones[m] || APP_TERMS.milestones.none;
  return item.color;
}

function darkenColor(hex, percent) {
  if (!hex || hex === 'transparent' || hex === '#ffffff') return '#1e293b';
  let num = parseInt(hex.replace("#",""), 16),
  amt = Math.round(2.55 * percent),
  R = (num >> 16) - amt,
  B = (num >> 8 & 0x00FF) - amt,
  G = (num & 0x0000FF) - amt;
  return "#" + (0x1000000 + (R<255?R<1?0:R:255)*0x10000 + (B<255?B<1?0:B:255)*0x100 + (G<255?G<1?0:G:255)).toString(16).slice(1);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==========================================================================
// In-App Toast & Confirm Modal (replaces native alert() / confirm())
// ==========================================================================
let _toastTimer = null;

function showInAppAlert(message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `app-toast app-toast-${type}`;
  const iconMap = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.textContent = iconMap[type] || 'ℹ';
  const msg = document.createElement('span');
  msg.className = 'toast-message';
  msg.textContent = message;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Meldung schließen');
  toast.appendChild(icon);
  toast.appendChild(msg);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  closeBtn.addEventListener('click', dismiss);

  // Auto-dismiss: 5s for errors, 3s for others
  const delay = (type === 'error') ? 5000 : 3000;
  setTimeout(dismiss, delay);

  // Animate in
  requestAnimationFrame(() => toast.classList.add('toast-enter'));
}

function showConfirmModal({ title, message, confirmText = 'Bestätigen', cancelText = 'Abbrechen', isDestructive = false, onConfirm, onCancel } = {}) {
  // Remove any existing confirm modal
  const existing = document.getElementById('app-confirm-modal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'app-confirm-modal';
  overlay.className = 'app-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'confirm-modal-title');

  const sheet = document.createElement('div');
  sheet.className = 'app-confirm-sheet';

  const titleEl = document.createElement('h3');
  titleEl.id = 'confirm-modal-title';
  titleEl.className = 'confirm-sheet-title';
  titleEl.textContent = title || 'Bestätigung';

  const msgEl = document.createElement('p');
  msgEl.className = 'confirm-sheet-message';
  msgEl.textContent = message || '';

  const actions = document.createElement('div');
  actions.className = 'confirm-sheet-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'btn btn-secondary confirm-btn-cancel';
  cancelBtn.textContent = cancelText;
  cancelBtn.addEventListener('click', () => {
    overlay.remove();
    if (onCancel) onCancel();
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = `btn ${isDestructive ? 'btn-destructive' : 'btn-primary'} confirm-btn-confirm`;
  confirmBtn.textContent = confirmText;
  confirmBtn.addEventListener('click', () => {
    overlay.remove();
    if (onConfirm) onConfirm();
  });

  actions.appendChild(cancelBtn);
  actions.appendChild(confirmBtn);
  sheet.appendChild(titleEl);
  sheet.appendChild(msgEl);
  sheet.appendChild(actions);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.remove();
      if (onCancel) onCancel();
    }
  });

  // Close on Esc
  const escHandler = (e) => {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
      if (onCancel) onCancel();
    }
  };
  document.addEventListener('keydown', escHandler);

  // Focus the cancel button by default (safe for destructive actions)
  requestAnimationFrame(() => cancelBtn.focus());
}
