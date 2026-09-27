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
  arrowDefs: null,
  
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

const STORAGE_KEY = 'rhein_neckar_cluster_clean_v7';

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
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
});

// --- Data Persistence ---
function loadStoredData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      AppState.towns = parsed.towns || {};
      AppState.districts = parsed.districts || {};
      AppState.deployments = parsed.deployments || [];
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
    navigator.serviceWorker.register('./sw.js?v=2').then((reg) => {
      reg.update().catch(() => {});
    }).catch(err => {
      console.log('Service worker note (offline fallback):', err);
    });
  }
}

function saveState() {
  try {
    const dataToSave = {
      towns: AppState.towns,
      districts: AppState.districts,
      deployments: AppState.deployments,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
  } catch (e) {
    console.warn('Could not save to localStorage:', e);
  }
  updateClusterStats();
  saveAutoBackup('Automatische Sicherung', false);
}

// --- History (Undo / Redo) & Local Auto-Backups ---
const MAX_UNDO_STACK = 45;
const BACKUPS_STORAGE_KEY = 'rn_cluster_backups_v1';
const MAX_BACKUPS = 12;

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
    localStorage.setItem(BACKUPS_STORAGE_KEY, JSON.stringify(backups));
  } catch (e) {
    console.warn('Could not save auto backup:', e);
  }
}

function restoreBackup(backupId) {
  const backups = getStoredBackups();
  const found = backups.find(b => b.id === backupId);
  if (!found) return;

  if (!confirm(`Möchtest du den Sicherungsstand vom ${found.dateFormatted} (${found.desc}) wirklich wiederherstellen?`)) {
    return;
  }

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
}

function renderBackupsList() {
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
    zoomSnap: 0,
    zoomDelta: 1.0
  }).setView([49.405, 8.465], 10.4);

  L.control.zoom({ position: 'bottomright' }).addTo(AppState.map);

  AppState.map.createPane('townPerimeterPane');
  AppState.map.getPane('townPerimeterPane').style.zIndex = 415;
  AppState.map.getPane('townPerimeterPane').style.pointerEvents = 'none';

  AppState.markersLayer = L.layerGroup().addTo(AppState.map);

  AppState.map.on('click', (e) => {
    if (e && e.originalEvent && e.originalEvent.target) {
      if (e.originalEvent.target.closest && (e.originalEvent.target.closest('#arrow-quick-hud') || e.originalEvent.target.closest('.arrow-svg-layer'))) {
        return;
      }
    }
    closeArrowQuickHUD();
  });

  AppState.map.on('zoomend', () => {
    refreshAllStyles();
    refreshMarkers();
    updateNavigationHUD();
    renderArrows();
  });

  AppState.map.on('move drag zoom viewreset resize', () => {
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
  
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  svg.appendChild(defs);
  
  container.appendChild(svg);
  AppState.arrowSvgLayer = svg;
  AppState.arrowDefs = defs;
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
  let borderColor = '#3a3a3c';
  let fillOpacity = 0.92;

  if (AppState.visualViewMode === 'milestone') {
    if (town.milestone === 'custom' && town.customColor) {
      fillColor = town.customColor;
      borderColor = darkenColor(town.customColor, 20);
    } else if (town.milestone !== 'none') {
      const mc = MILESTONE_COLORS[town.milestone] || MILESTONE_COLORS.none;
      fillColor = mc.fill;
      borderColor = mc.border;
    }
  } else if (AppState.visualViewMode === 'activities') {
    const totalActs = calculateTotalActivities(town.activities);
    if (totalActs > 0) {
      if (totalActs <= 2) fillColor = '#bbf7d0';
      else if (totalActs <= 5) fillColor = '#4ade80';
      else if (totalActs <= 10) fillColor = '#22c55e';
      else fillColor = '#15803d';
      borderColor = darkenColor(fillColor, 15);
    }
  } else if (AppState.visualViewMode === 'nuclei') {
    const n = town.nuclei || 0;
    if (n > 0) {
      if (n === 1) fillColor = '#a7f3d0';
      else if (n <= 3) fillColor = '#10b981';
      else fillColor = '#047857';
      borderColor = darkenColor(fillColor, 15);
    }
  }

  return {
    fillColor: fillColor,
    fillOpacity: isSelected || isArrowSource ? 0.98 : fillOpacity,
    color: isArrowSource ? '#007aff' : (isCenter ? '#ff9500' : (isSelected ? '#007aff' : borderColor)),
    weight: isArrowSource ? 3.5 : (isSelected ? 3 : (isCenter ? 2.2 : 1.4)),
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
            layer.setStyle({ weight: 2.8, color: '#007aff' });
          }
        },
        mouseout: (e) => {
          if (!isTownInDistrictMode(id)) {
            layer.setStyle(getTownStyle(feature));
          }
        },
        click: (e) => {
          if (!isTownInDistrictMode(id)) {
            handleTownClick(id);
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
            layer.setStyle({ weight: 2.8, color: '#007aff' });
          }
        },
        mouseout: (e) => {
          if (isTownInDistrictMode(feature.properties.townId)) {
            layer.setStyle(getDistrictStyle(feature));
          }
        },
        click: (e) => {
          if (isTownInDistrictMode(feature.properties.townId)) {
            handleDistrictClick(id);
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
function refreshMarkers() {
  if (!AppState.markersLayer) return;
  AppState.markersLayer.clearLayers();

  if (!AppState.showLabels) return;

  // 1. Municipalities (Ortschaften)
  if (typeof RHEIN_NECKAR_GEOJSON !== 'undefined') {
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
        AppState.markersLayer.addLayer(marker);
        return;
      }

      const totalActs = calculateTotalActivities(town.activities);
      const isCenter = town.isCenter;

      const markerHtml = `
        <div class="subtle-map-label ${isCenter ? 'center' : ''}">
          ${isCenter ? '<span class="center-star">★</span>' : ''}
          <span>${escapeHtml(f.properties.name)}</span>
          ${town.nuclei > 0 ? `<span class="subtle-badge nuclei">${town.nuclei}</span>` : ''}
          ${totalActs > 0 ? `<span class="subtle-badge acts">${totalActs}</span>` : ''}
        </div>
      `;

      const customIcon = L.divIcon({
        className: 'subtle-marker-container',
        html: markerHtml,
        iconSize: [120, 20],
        iconAnchor: [60, 10]
      });

      const marker = L.marker(center, { icon: customIcon, interactive: false });
      AppState.markersLayer.addLayer(marker);
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
  while (svg.lastChild && svg.lastChild !== AppState.arrowDefs) {
    svg.removeChild(svg.lastChild);
  }
  AppState.arrowDefs.innerHTML = '';

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
    const endX = pB.x - (tangentX / tangentLen) * 12;
    const endY = pB.y - (tangentY / tangentLen) * 12;

    const pathData = `M ${pA.x} ${pA.y} Q ${cpX} ${cpY} ${endX} ${endY}`;
    const markerId = `arrowhead-${dep.id}`;

    // Color based on status or custom
    let arrowColor = dep.color || '#007aff';
    let dashStyle = null;

    if (dep.status === 'planned') {
      arrowColor = '#f59e0b'; // Amber / Gold for planned
      dashStyle = '6, 6';
    } else if (dep.status === 'established') {
      arrowColor = '#16a34a'; // Green for established
    }

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", markerId);
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "7");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "6");
    marker.setAttribute("markerHeight", "6");
    marker.setAttribute("orient", "auto-start-reverse");

    const markerPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    markerPath.setAttribute("d", "M 0 1.5 L 8 5 L 0 8.5 z");
    markerPath.setAttribute("fill", arrowColor);
    marker.appendChild(markerPath);
    AppState.arrowDefs.appendChild(marker);

    // 1. Wide invisible hit-area path for easy, effortless clicking
    const hitPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hitPath.setAttribute("d", pathData);
    hitPath.setAttribute("fill", "none");
    hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "26");
    hitPath.setAttribute("stroke-linecap", "round");
    hitPath.setAttribute("style", "cursor: pointer; pointer-events: stroke;");
    hitPath.setAttribute("data-dep-id", dep.id);

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

    hitPath.addEventListener("click", onArrowClick);
    hitPath.addEventListener("touchstart", onArrowClick, { passive: false });
    svg.appendChild(hitPath);

    const isSelected = AppState.activeQuickDeployment && AppState.activeQuickDeployment.id === dep.id;

    // 2. Visible arrow path
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `arrow-path ${dep.status || 'active'} ${isSelected ? 'selected' : ''}`);
    path.setAttribute("stroke", arrowColor);
    path.setAttribute("stroke-width", isSelected ? "5" : (dep.status === 'established' ? "3.5" : "3"));
    if (dashStyle) path.setAttribute("stroke-dasharray", dashStyle);
    path.setAttribute("marker-end", `url(#${markerId})`);
    path.setAttribute("data-dep-id", dep.id);
    path.setAttribute("style", "cursor: pointer; pointer-events: stroke;");

    path.addEventListener("click", onArrowClick);
    path.addEventListener("touchstart", onArrowClick, { passive: false });
    svg.appendChild(path);

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

// --- Interaction Handlers ---
function handleTownClick(townId) {
  if (AppState.currentMode === 'inspect') {
    selectTown(townId, true);
  } else if (AppState.currentMode === 'paint') {
    applyPaintToTown(townId);
  } else if (AppState.currentMode === 'arrow') {
    handleArrowSourceTargetClick(townId, false);
  }
}

function handleDistrictClick(districtId) {
  if (AppState.currentMode === 'inspect') {
    selectDistrict(districtId, true);
  } else if (AppState.currentMode === 'paint') {
    applyPaintToDistrict(districtId);
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
      alert("Start und Ziel können nicht derselbe Ort sein.");
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
  if (confirm("Möchtest du diesen Pfeil wirklich entfernen?")) {
    pushHistory(desc);
    AppState.deployments = AppState.deployments.filter(d => d.id !== depId);
    saveState();
    refreshAllStyles();
    if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
    else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
  }
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

  document.getElementById('select-visual-view').addEventListener('change', (e) => {
    AppState.visualViewMode = e.target.value;
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
      const openModal = document.querySelector('.modal-backdrop.visible');
      if (openModal) {
        openModal.classList.remove('visible');
        if (openModal.id === 'new-arrow-modal') {
          cancelArrowDrawing();
          setMode('inspect');
        }
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

  searchInput.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
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
      item.innerHTML = `<span><strong>${escapeHtml(f.properties.name)}</strong></span> <span style="font-size:10px; color:#64748b;">${escapeHtml(f.properties.kreis)}</span>`;
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

    searchResults.classList.add('visible');
  });

  // Spotlight search keyboard accessibility
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstItem = searchResults.querySelector('.search-item');
      if (firstItem) {
        e.preventDefault();
        firstItem.click();
      }
    } else if (e.key === 'Escape') {
      searchResults.classList.remove('visible');
      searchInput.blur();
    }
  });

  // Close search when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.spotlight-search')) searchResults.classList.remove('visible');
  });

  // Collapsible Legend Header
  const legendToggle = document.getElementById('legend-header-toggle');
  if (legendToggle) {
    legendToggle.addEventListener('click', () => {
      const hud = document.getElementById('legend-hud');
      const chevron = document.getElementById('legend-chevron');
      if (hud) {
        hud.classList.toggle('collapsed');
        const isCollapsed = hud.classList.contains('collapsed');
        if (chevron) chevron.textContent = isCollapsed ? '▸' : '▾';
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

    document.getElementById('menu-item-reset')?.addEventListener('click', () => {
      projectDropdownMenu.classList.remove('visible');
      btnProjectMenu.setAttribute('aria-expanded', 'false');
      resetToCleanData();
    });
  }

  document.getElementById('json-file-input').addEventListener('change', handleImportJson);
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
  let totalNuclei = 0;
  let totalDevotionals = 0;
  let totalStudyCircles = 0;
  let totalChildren = 0;
  let totalJuniorYouth = 0;
  let totalCenters = 0;

  towns.forEach(t => {
    if (t.milestone && t.milestone !== 'none') reachedTowns++;
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

  document.getElementById('stat-towns').textContent = `${reachedTowns} / ${totalTowns}`;
  document.getElementById('stat-nuclei').textContent = totalNuclei;
  document.getElementById('stat-activities').textContent = totalActs;
  document.getElementById('stat-deployments').textContent = totalDeployments;
  document.getElementById('stat-centers').textContent = totalCenters;
}

function openClusterReportModal() {
  const tbody = document.getElementById('report-table-body');
  tbody.innerHTML = '';

  const features = Object.values(AppState.townFeaturesById).sort((a, b) =>
    a.properties.name.localeCompare(b.properties.name)
  );

  features.forEach(f => {
    const id = f.properties.id;
    const town = AppState.towns[id] || { milestone: 'none', nuclei: 0, activities: {} };
    const acts = town.activities || {};
    const totalActs = calculateTotalActivities(acts);
    const districts = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === id);
    const distCount = districts.length;

    const tr = document.createElement('tr');
    tr.className = `report-town-row ${distCount > 0 ? 'has-subpoints' : ''}`;
    tr.innerHTML = `
      <td>
        <strong>${escapeHtml(f.properties.name)}</strong>
        ${distCount > 0 ? `<button type="button" class="town-expand-btn" onclick="toggleReportSubpoints('${id}', this)">▼ ${distCount} Unterpunkte</button>` : ''}
      </td>
      <td><span style="font-size:11px; color:#64748b;">${escapeHtml(f.properties.kreis)}</span></td>
      <td>
        <span style="display:inline-flex; align-items:center; gap:4px; font-weight:600;">
          <span style="width:10px; height:10px; border-radius:50%; background:${getMilestoneColor(town.milestone)};"></span>
          ${getMilestoneLabel(town.milestone)}
        </span>
      </td>
      <td><strong>${town.nuclei || 0}</strong></td>
      <td><strong>${totalActs}</strong></td>
      <td>${town.isCenter ? '<span style="color:var(--system-orange); font-weight:600;">★ Zentrum</span>' : '-'}</td>
      <td>${AppState.deployments.filter(d => d.fromId === id || d.toId === id).length}</td>
      <td>
        <button class="btn btn-secondary" style="padding: 3px 8px; font-size: 11px;" onclick="jumpToTownFromReport('${id}')">Details</button>
      </td>
    `;
    tbody.appendChild(tr);

    if (distCount > 0) {
      districts.forEach(df => {
        const dId = df.properties.id;
        const dist = AppState.districts[dId] || { milestone: 'none', nuclei: 0, activities: {} };
        const dActs = calculateTotalActivities(dist.activities);

        const subTr = document.createElement('tr');
        subTr.className = `report-subpoint-row report-sub-${id}`;
        subTr.innerHTML = `
          <td style="padding-left: 28px;">
            <span class="subpoint-branch-icon">↳</span>
            <span style="font-weight: 500;">${escapeHtml(df.properties.name)}</span>
            <span class="subpoint-label-badge">Nachbarschaft</span>
          </td>
          <td><span style="font-size:11px; color:var(--text-tertiary);">Unterpunkt von ${escapeHtml(f.properties.name)}</span></td>
          <td>
            <span style="display:inline-flex; align-items:center; gap:4px; font-size:11px;">
              <span style="width:8px; height:8px; border-radius:50%; background:${getMilestoneColor(dist.milestone)};"></span>
              ${getMilestoneLabel(dist.milestone)}
            </span>
          </td>
          <td>${dist.nuclei || 0}</td>
          <td>${dActs}</td>
          <td style="color:var(--text-tertiary);">-</td>
          <td>${AppState.deployments.filter(d => d.fromId === dId || d.toId === dId).length}</td>
          <td>
            <button class="btn btn-secondary" style="padding: 2px 7px; font-size: 10px;" onclick="jumpToDistrictFromReport('${id}', '${dId}')">Fokus</button>
          </td>
        `;
        tbody.appendChild(subTr);
      });
    }
  });

  document.getElementById('report-modal').classList.add('visible');
}

window.toggleReportSubpoints = function(townId, btn) {
  const rows = document.querySelectorAll(`.report-sub-${townId}`);
  const isHidden = rows.length > 0 && rows[0].style.display === 'none';
  rows.forEach(r => r.style.display = isHidden ? 'table-row' : 'none');
  const count = rows.length;
  btn.textContent = isHidden ? `▼ ${count} Unterpunkte` : `▶ ${count} Unterpunkte`;
};

window.jumpToTownFromReport = function(townId) {
  document.getElementById('report-modal').classList.remove('visible');
  selectTown(townId, true);
};

window.jumpToDistrictFromReport = function(townId, districtId) {
  document.getElementById('report-modal').classList.remove('visible');
  focusDistrictOnMap(districtId);
};

function exportDataJson() {
  const exportObject = {
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
}

function handleImportJson(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result);
      if (data.towns && Array.isArray(data.deployments)) {
        AppState.towns = data.towns;
        AppState.districts = data.districts || {};
        AppState.deployments = data.deployments;
        saveState();
        refreshAllStyles();
        alert("Projekt erfolgreich importiert!");
      } else {
        alert("Ungültiges Dateiformat.");
      }
    } catch (err) {
      alert("Fehler beim Lesen der JSON: " + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

function exportMapAsPng() {
  if (typeof html2canvas === 'undefined') return;
  const mapElem = document.getElementById('map-container');
  html2canvas(mapElem, { useCORS: true, scale: 2 }).then(canvas => {
    const link = document.createElement('a');
    link.download = `rhein_neckar_karte_${new Date().toISOString().slice(0,10)}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

function resetToCleanData() {
  if (confirm("Möchtest du alle Daten auf den sauberen Anfangszustand (0 / keine Aktivitäten) zurücksetzen?")) {
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
  }
}

function calculateTotalActivities(acts) {
  if (!acts) return 0;
  return (acts.devotionals || 0) + (acts.studyCircles || 0) + (acts.childrenClasses || 0) + (acts.juniorYouth || 0);
}

function getMilestoneLabel(m) {
  switch (m) {
    case 'pg': return 'PG';
    case 'ipg': return 'IPG';
    case 'ipg_plus': return 'IPG+';
    case 'custom': return 'Eigene Farbe';
    default: return 'Noch nicht begonnen';
  }
}

function getMilestoneColor(m) {
  return MILESTONE_COLORS[m] ? MILESTONE_COLORS[m].fill : '#ffffff';
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
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
