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
        AppState.towns[id] = {
          milestone: 'none',
          customColor: '#86efac',
          nuclei: 0,
          activities: { devotionals: 0, studyCircles: 0, childrenClasses: 0, juniorYouth: 0 },
          isCenter: false,
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
    navigator.serviceWorker.register('./sw.js').catch(err => {
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

// --- Map Setup ---
function initMap() {
  AppState.map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    boxZoom: false,
    minZoom: 9,
    maxZoom: 16
  }).setView([49.38, 8.75], 10);

  L.control.zoom({ position: 'topright' }).addTo(AppState.map);

  AppState.map.createPane('townPerimeterPane');
  AppState.map.getPane('townPerimeterPane').style.zIndex = 415;
  AppState.map.getPane('townPerimeterPane').style.pointerEvents = 'none';

  AppState.markersLayer = L.layerGroup().addTo(AppState.map);

  AppState.map.on('click', () => {
    closeArrowQuickHUD();
  });

  AppState.map.on('zoomend', () => {
    refreshAllStyles();
    refreshMarkers();
    updateNavigationHUD();
  });

  AppState.map.on('move viewreset resize', () => {
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
    { name: "Rheinhessen-Pfalz", coords: [49.46, 8.25], isRegion: true },
    { name: "Darmstadt-Aschaffenburg", coords: [49.65, 8.70], isRegion: true },
    { name: "Heilbronn-Tauber", coords: [49.30, 9.12], isRegion: true },
    { name: "Baden-Nordschwarzwald", coords: [49.12, 8.55], isRegion: true },
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

  const banner = document.getElementById('focus-banner');
  const bannerText = document.getElementById('focus-banner-text');
  const distCount = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === townId).length;

  banner.style.display = 'flex';
  if (distCount > 0) {
    bannerText.textContent = `Stadtteile: ${feat.properties.name} (${distCount} Stadtteile)`;
  } else {
    bannerText.textContent = `Gemeinde: ${feat.properties.name} (Einheitliche Kommune)`;
  }

  selectTown(townId, false);
  if (distCount > 0) {
    switchDrawerTab('districts');
  }

  refreshAllStyles();
  refreshMarkers();
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

  const banner = document.getElementById('focus-banner');
  const bannerText = document.getElementById('focus-banner-text');
  if (banner && bannerText) {
    bannerText.textContent = `${feat.properties.townName} › ${feat.properties.name}`;
    banner.style.display = 'flex';
  }

  selectDistrict(districtId, false);
  refreshAllStyles();
  refreshMarkers();
}

function exitDistrictFocus() {
  AppState.focusedTownId = null;
  AppState.selectedDistrictId = null;

  document.getElementById('focus-banner').style.display = 'none';

  if (AppState.map) {
    AppState.map.setView([49.38, 8.75], 10, { animate: true });
  }

  if (AppState.selectedTownId) {
    selectTown(AppState.selectedTownId, false);
    switchDrawerTab('overview');
  }

  refreshAllStyles();
  refreshMarkers();
}

// --- SVG Arrow Layer ---
function initArrowSvgLayer() {
  const mapPane = AppState.map.getPanes().overlayPane;
  
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
  
  mapPane.appendChild(svg);
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
  // Otherwise only expand in deep local zoom (level 14+)
  const currentZoom = AppState.map ? AppState.map.getZoom() : 10;
  return currentZoom >= 14;
}

// --- Navigation Breadcrumb HUD Sync ---
function updateNavigationHUD() {
  const banner = document.getElementById('focus-banner');
  const bannerText = document.getElementById('focus-banner-text');
  if (!banner || !bannerText) return;

  const currentZoom = AppState.map ? AppState.map.getZoom() : 10;
  if (AppState.focusedTownId) {
    const feat = AppState.townFeaturesById[AppState.focusedTownId];
    const distCount = Object.values(AppState.districtFeaturesById).filter(df => df.properties.townId === AppState.focusedTownId).length;
    banner.style.display = 'flex';
    bannerText.textContent = `Stadtteile: ${feat ? feat.properties.name : 'Ortschaft'} (${distCount} Nachbarschaften)`;
  } else if (currentZoom >= 14) {
    banner.style.display = 'flex';
    bannerText.textContent = 'Detailansicht: Stadtteile & Nachbarschaften';
  } else {
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

  AppState.map.fitBounds(AppState.geoJsonLayer.getBounds(), { padding: [25, 25] });
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
  svg.style.width = mapSize.x + "px";
  svg.style.height = mapSize.y + "px";

  const topLeft = AppState.map.containerPointToLayerPoint([0, 0]);
  L.DomUtil.setPosition(svg, topLeft);

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

    const pA = AppState.map.latLngToLayerPoint(fromFeat.properties.center);
    const pB = AppState.map.latLngToLayerPoint(toFeat.properties.center);

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

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    path.setAttribute("class", `arrow-path ${dep.status || 'active'}`);
    path.setAttribute("stroke", arrowColor);
    path.setAttribute("stroke-width", dep.status === 'established' ? "3.5" : "3");
    if (dashStyle) path.setAttribute("stroke-dasharray", dashStyle);
    path.setAttribute("marker-end", `url(#${markerId})`);
    path.setAttribute("data-dep-id", dep.id);

    path.addEventListener("click", (e) => {
      e.stopPropagation();
      openArrowQuickHUD(dep);
    });

    svg.appendChild(path);

    // Animated dash for active arrows
    if (dep.status !== 'planned') {
      const flowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
      flowPath.setAttribute("d", pathData);
      flowPath.setAttribute("class", "arrow-flow-dash");
      svg.appendChild(flowPath);
    }

    // Midpoint Node Badge
    const midX = 0.25 * pA.x + 0.5 * cpX + 0.25 * endX;
    const midY = 0.25 * pA.y + 0.5 * cpY + 0.25 * endY;

    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", "arrow-midpoint-node");
    group.setAttribute("transform", `translate(${midX}, ${midY})`);
    group.addEventListener("click", (e) => {
      e.stopPropagation();
      openArrowQuickHUD(dep);
    });

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
  AppState.activeQuickDeployment = dep;
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

function closeArrowQuickHUD() {
  AppState.activeQuickDeployment = null;
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
  if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
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
    ? `${feature.properties.kreis} • ${distCount} Nachbarschaften` 
    : `${feature.properties.kreis} • Gesamtgemeinde`;

  renderDistrictsListForTown(townId);

  // Sync zoom button in drawer
  const btnZoomTown = document.getElementById('btn-zoom-to-town');
  if (btnZoomTown) {
    if (distCount > 0) {
      btnZoomTown.style.display = 'flex';
      const isFocused = AppState.focusedTownId === townId;
      btnZoomTown.innerHTML = isFocused 
        ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px;"><polyline points="20 6 9 17 4 12"></polyline></svg> Stadtteile auf Karte aktiv`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;margin-right:6px;"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Auf Karte heranzoomen &amp; Stadtteile anzeigen`;
      btnZoomTown.classList.toggle('btn-primary', isFocused);
      btnZoomTown.classList.toggle('btn-secondary', !isFocused);
    } else {
      btnZoomTown.style.display = 'none';
    }
  }

  updateMilestoneUISelection(town.milestone);
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

        const banner = document.getElementById('focus-banner');
        const bannerText = document.getElementById('focus-banner-text');
        if (banner && bannerText) {
          bannerText.textContent = `Gemeinde: ${feature.properties.name}`;
          banner.style.display = 'flex';
        }
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
  updateMilestoneUISelection(dist.milestone);
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

    const card = document.createElement('div');
    card.className = `district-subcard ${isSelected ? 'active expanded' : ''}`;
    card.id = `subcard-${dId}`;

    card.innerHTML = `
      <div class="district-subcard-header">
        <div class="district-subcard-left">
          <span class="subcard-chevron">${isSelected ? '▼' : '▶'}</span>
          <span style="width:9px; height:9px; border-radius:50%; background:${getMilestoneColor(dData.milestone)}; flex-shrink:0;"></span>
          <span class="district-subcard-title">${escapeHtml(df.properties.name)}</span>
          <span class="subpoint-tag">Unterpunkt</span>
        </div>
        <div class="district-subcard-badges">
          <span class="subcard-badge milestone">${getMilestoneLabel(dData.milestone)}</span>
          <span class="subcard-badge">${dData.nuclei || 0} Nuklei</span>
          <span class="subcard-badge">${actsTotal} Akt.</span>
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

    // Wire header click to toggle or select
    const header = card.querySelector('.district-subcard-header');
    header.addEventListener('click', () => {
      if (AppState.selectedDistrictId === dId) {
        const body = card.querySelector('.district-subcard-body');
        const isExp = body.style.display !== 'none';
        body.style.display = isExp ? 'none' : 'block';
        card.classList.toggle('expanded', !isExp);
        card.querySelector('.subcard-chevron').textContent = isExp ? '▶' : '▼';
      } else {
        selectDistrict(dId);
      }
    });

    // Milestone buttons
    card.querySelectorAll('.subcard-m-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const m = btn.dataset.m;
        pushHistory(`Stadtteil ${df.properties.name}: Meilenstein auf ${getMilestoneLabel(m)} geändert`);
        dData.milestone = m;
        saveState();
        refreshAllStyles();
        renderDistrictsListForTown(townId);
        if (AppState.selectedDistrictId === dId) {
          updateMilestoneUISelection(m);
        }
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

  btnOverview.classList.toggle('active', tab === 'overview');
  btnDistricts.classList.toggle('active', tab === 'districts');

  viewOverview.style.display = tab === 'overview' ? 'block' : 'none';
  viewDistricts.style.display = tab === 'districts' ? 'block' : 'none';
}

function updateMilestoneUISelection(milestone) {
  document.querySelectorAll('.milestone-card').forEach(card => {
    card.classList.toggle('active', card.dataset.milestone === milestone);
  });
  const customRow = document.getElementById('drawer-custom-color-row');
  customRow.style.display = milestone === 'custom' ? 'flex' : 'none';
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
      <div>
        <div class="dep-info-title">
          <span>→ Nach ${escapeHtml(d.toName)}</span>
          <span style="background:rgba(0,122,255,0.1); color:var(--system-blue); padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">${d.count || 1} Pers.</span>
        </div>
        <div class="dep-info-sub">${escapeHtml(d.type)} • <span class="dep-status-pill ${d.status}">${statusText}</span></div>
      </div>
      <div class="dep-actions">
        <button class="btn-icon-del" title="Entsendung löschen" onclick="deleteDeployment('${d.id}')">✕</button>
      </div>
    `;
    container.appendChild(card);
  });

  incoming.forEach(d => {
    const card = document.createElement('div');
    card.className = 'deployment-card';
    card.style.borderLeftColor = d.status === 'planned' ? 'var(--system-orange)' : (d.status === 'established' ? 'var(--system-green)' : 'var(--system-green)');
    const statusText = d.status === 'planned' ? 'Geplant' : (d.status === 'established' ? 'Etabliert' : 'Aktiv');
    card.innerHTML = `
      <div>
        <div class="dep-info-title">
          <span>← Von ${escapeHtml(d.fromName)}</span>
          <span style="background:rgba(52,199,89,0.12); color:var(--system-green); padding:1px 6px; border-radius:4px; font-size:10px; font-weight:600;">${d.count || 1} Pers.</span>
        </div>
        <div class="dep-info-sub">${escapeHtml(d.type)} • <span class="dep-status-pill ${d.status}">${statusText}</span></div>
      </div>
      <div class="dep-actions">
        <button class="btn-icon-del" title="Entsendung löschen" onclick="deleteDeployment('${d.id}')">✕</button>
      </div>
    `;
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
  saveState();
  refreshAllStyles();
  if (AppState.selectedTownId === townId && !AppState.selectedDistrictId) {
    updateMilestoneUISelection(town.milestone);
  }
}

function applyPaintToDistrict(districtId) {
  const dist = AppState.districts[districtId];
  if (!dist) return;
  const name = AppState.districtFeaturesById[districtId]?.properties?.name || 'Stadtteil';
  pushHistory(`Stadtteil ${name} eingefärbt`);
  dist.milestone = AppState.activePaintMilestone;
  if (AppState.activePaintMilestone === 'custom') dist.customColor = AppState.activePaintColor;
  saveState();
  refreshAllStyles();
  if (AppState.selectedDistrictId === districtId) {
    updateMilestoneUISelection(dist.milestone);
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
  document.getElementById('new-arrow-modal').classList.remove('visible');
  refreshAllStyles();

  if (AppState.selectedDistrictId) renderDeploymentsList(AppState.selectedDistrictId);
  else if (AppState.selectedTownId) renderDeploymentsList(AppState.selectedTownId);
}

function cancelArrowDrawing() {
  AppState.arrowSourceId = null;
  AppState.arrowSourceIsDistrict = false;
  document.getElementById('arrow-instruction-text').textContent = "1. Start-Ort auf Karte anklicken → 2. Ziel-Ort anklicken";
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
  document.getElementById('view-dep-title').textContent = `${dep.fromName} → ${dep.toName}`;
  document.getElementById('view-dep-type').textContent = dep.type;
  document.getElementById('view-dep-count').textContent = dep.count ? `${dep.count} Person(en)` : '1 Person';
  
  const statusLabel = dep.status === 'planned' ? 'In Planung (Gestrichelt)' : (dep.status === 'established' ? 'Etabliert & Konsolidiert' : 'Aktiv (Laufende Begleitung)');
  document.getElementById('view-dep-frequency').textContent = statusLabel;
  document.getElementById('view-dep-notes').textContent = dep.notes || 'Keine Notiz hinterlegt.';
  
  const delBtn = document.getElementById('view-dep-del-btn');
  delBtn.onclick = () => {
    document.getElementById('view-dep-modal').classList.remove('visible');
    deleteDeployment(dep.id);
  };

  document.getElementById('view-dep-modal').classList.add('visible');
}

// --- UI Event Listeners ---
function initUIEventListeners() {
  document.getElementById('btn-zoom-cluster').addEventListener('click', exitDistrictFocus);
  document.getElementById('btn-exit-focus').addEventListener('click', exitDistrictFocus);
  document.getElementById('btn-zoom-to-town').addEventListener('click', () => {
    if (AppState.selectedTownId) focusTownDistricts(AppState.selectedTownId);
  });

  document.getElementById('tab-btn-overview').addEventListener('click', () => switchDrawerTab('overview'));
  document.getElementById('tab-btn-districts').addEventListener('click', () => switchDrawerTab('districts'));

  const btnInspect = document.getElementById('mode-btn-inspect');
  const btnPaint = document.getElementById('mode-btn-paint');
  const btnArrow = document.getElementById('mode-btn-arrow');
  const paintBar = document.getElementById('paint-palette-bar');
  const arrowBanner = document.getElementById('arrow-instruction-banner');

  function setMode(mode) {
    AppState.currentMode = mode;
    btnInspect.classList.toggle('active', mode === 'inspect');
    btnPaint.classList.toggle('active', mode === 'paint');
    btnArrow.classList.toggle('active', mode === 'arrow');

    paintBar.classList.toggle('visible', mode === 'paint');
    arrowBanner.classList.toggle('visible', mode === 'arrow');

    if (mode !== 'arrow') cancelArrowDrawing();
  }

  btnInspect.addEventListener('click', () => setMode('inspect'));
  btnPaint.addEventListener('click', () => setMode('paint'));
  btnArrow.addEventListener('click', () => setMode('arrow'));
  document.getElementById('btn-cancel-arrow').addEventListener('click', cancelArrowDrawing);

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
    document.getElementById('details-drawer').classList.add('collapsed');
    AppState.selectedTownId = null;
    AppState.selectedDistrictId = null;
    refreshAllStyles();
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
      pushHistory(`Meilenstein auf ${getMilestoneLabel(m)} geändert`);
      if (AppState.selectedDistrictId) {
        AppState.districts[AppState.selectedDistrictId].milestone = m;
      } else if (AppState.selectedTownId) {
        AppState.towns[AppState.selectedTownId].milestone = m;
      }
      updateMilestoneUISelection(m);
      saveState();
      refreshAllStyles();
    });
  });

  document.getElementById('drawer-custom-color').addEventListener('change', (e) => {
    pushHistory('Farbe angepasst');
    if (AppState.selectedDistrictId) {
      AppState.districts[AppState.selectedDistrictId].customColor = e.target.value;
    } else if (AppState.selectedTownId) {
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

  // Global Keyboard Shortcuts (⌘Z / ⇧⌘Z / ⌘Y)
  window.addEventListener('keydown', (e) => {
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

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box-card')) searchResults.classList.remove('visible');
  });

  document.getElementById('btn-save-new-arrow').addEventListener('click', saveNewArrowFromModal);
  document.getElementById('btn-close-new-arrow-modal').addEventListener('click', () => {
    document.getElementById('new-arrow-modal').classList.remove('visible');
    cancelArrowDrawing();
  });
  document.getElementById('btn-cancel-new-arrow-modal').addEventListener('click', () => {
    document.getElementById('new-arrow-modal').classList.remove('visible');
    cancelArrowDrawing();
  });

  document.getElementById('btn-close-view-dep-modal').addEventListener('click', () => {
    document.getElementById('view-dep-modal').classList.remove('visible');
  });

  document.getElementById('btn-open-report').addEventListener('click', openClusterReportModal);
  document.getElementById('btn-close-report-modal').addEventListener('click', () => {
    document.getElementById('report-modal').classList.remove('visible');
  });

  document.getElementById('btn-export-json').addEventListener('click', exportDataJson);
  document.getElementById('btn-import-json').addEventListener('click', () => document.getElementById('json-file-input').click());
  document.getElementById('json-file-input').addEventListener('change', handleImportJson);
  document.getElementById('btn-export-png').addEventListener('click', exportMapAsPng);
  document.getElementById('btn-reset-demo').addEventListener('click', resetToCleanData);
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
  const totalTowns = Object.keys(AppState.townFeaturesById).length || 71;
  
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
