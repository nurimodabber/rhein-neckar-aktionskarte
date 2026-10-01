# AGENTS.md: Architecture, Data Models, Formats & Operational Guide

## 1. System Overview

The **Rhein-Neckar Aktionskarte** (`rhein-neckar-aktionskarte`) is an offline-first strategic growth planning and reflection map for the Bahá'í community in the Rhein-Neckar cluster and adjacent Vorderpfalz areas.

### Core Domain
- **Geographic Coverage**:
  - **133 Municipalities**: 6 Kreisfreie Städte (Mannheim, Heidelberg, Ludwigshafen am Rhein, Frankenthal (Pfalz), Speyer, Neustadt an der Weinstraße), 54 Rhein-Neckar-Kreis municipalities, 25 Rhein-Pfalz-Kreis municipalities, 48 Landkreis Bad Dürkheim municipalities.
  - **162 Stadtteile / Nachbarschaften**: Subdivided neighborhoods across 35 cities/municipalities (including Heidelberg, Mannheim, Ludwigshafen, Neustadt, Speyer, Frankenthal, Weinheim, Sinsheim, Wiesloch, Leimen/St. Ilgen, etc.).
- **Milestone Staging**:
  - `none`: Noch nicht begonnen (uncolored/white with subtle border)
  - `pg`: Programm des Wachstums (Spring Green, `#86efac`, border `#22c55e`)
  - `ipg`: Intensives Programm (Apple Emerald Green, `#34c759`, border `#15803d`)
  - `ipg_plus`: Fortgeschrittenes Intensives Programm (Deep Forest Green, `#15803d`, border `#052e16`)
  - `custom`: Custom color overrides
- **Tracked Metrics per Unit**:
  - Active Nuclei (`nuclei`: integer)
  - Core Activities (`activities`: `{ devotionals, studyCircles, childrenClasses, juniorYouth }`)
  - Sending Center Status (`isCenter`: boolean, orange star ★)
  - Reflection notes & next steps (`notes`: text)
- **Deployments / Entsendungen**:
  - Directed curved arrows connecting source and target municipalities/districts.
  - Attributes: type (Pioniere, Wanderlehrer, Projektbegleitung, Kinderklassen-Lehrer, Junioren-Animateur, Studienkreis-Tutor), count of people, status (`active`, `planned`, `established`), custom color, notes.

---

## 2. Architecture & File Inventory

```
.
├── index.html                 # Main interface, Apple HIG modals, inspector drawer & floating capsules
├── style.css                  # Apple HIG styling, glassmorphism, responsive tokens, map popovers
├── app.js                     # Monolithic application controller, global AppState, AppStorage IndexedDB adapter
├── manifest.json              # Web app manifest for PWA installation
├── sw.js                      # Service Worker (Cache-first offline shell & network fallback)
├── icon.svg                   # Vector application icon
├── server.py                  # Local Python HTTP server (ports 8080/8081)
├── vercel.json                # Vercel deployment configuration with clean URLs & security headers
├── gh-pages-handover.html     # Client-side handover page transferring user storage to Vercel
├── tests/
│   └── test_phase0.js         # Automated headless Chrome integration tests for Phase 0
├── lib/                       # Bundled local offline vendor libraries
│   ├── leaflet.js             # Leaflet 1.9.4
│   ├── leaflet.css            # Leaflet stylesheet
│   ├── html2canvas.min.js     # Client-side map image export
│   └── qrcode.min.js          # Client-side zero-dependency QR code generator (Kazuhiko Arase)
├── rhein_neckar_data.js       # GeoJSON polygons & properties for all 133 municipalities
├── rhein_neckar_districts.js  # GeoJSON polygons & exclaves for 162 Stadtteile
├── surrounding_kreise.js      # Surrounding neighboring counties (Hessen, Pfalz, BW) (141 KB)
├── rivers_data.js             # Rhine and Neckar waterways
└── geographic_landmarks.js    # Autobahn / landmarks
```

---

## 3. Data Model & Storage Specification

### Storage Architecture
- **Primary Engine**: `IndexedDB` (`RheinNeckarClusterDB`, Object stores: `state`, `backups`) via `AppStorage`.
- **Fast Synchronous Fallback & Cache**: `localStorage` (`STORAGE_KEY = 'rhein_neckar_cluster_clean_v7'`).
- **Automatic Migration**: Transparent migration on startup from `localStorage` to `IndexedDB`.
- **Persistent Storage**: Auto-requested via `navigator.storage.persist()`.
- **Metadata & Safety Tracking**: `rn_cluster_meta_v1` (`lastExportedAt` timestamp and 7-day export reminder).
   - **Schema**:
   ```typescript
   interface StoredAppState {
     towns: Record<string, TownData>;
     districts: Record<string, DistrictData>;
     deployments: DeploymentRecord[];
     updatedAt: string; // ISO 8601 timestamp
   }

   interface TownData {
     milestone: 'none' | 'pg' | 'ipg' | 'ipg_plus' | 'custom';
     customColor?: string;
     isCenter?: boolean;
     nuclei?: number;
     activities?: {
       devotionals?: number;
       studyCircles?: number;
       childrenClasses?: number;
       juniorYouth?: number;
     };
     notes?: string;
   }

   interface DistrictData extends TownData {}

   interface DeploymentRecord {
     id: string; // "dep_<timestamp>_<random>"
     fromId: string;
     toId: string;
     fromName: string;
     toName: string;
     type: string;
     count: number;
     status: 'active' | 'planned' | 'established';
     color: string;
     notes?: string;
     createdAt?: string;
   }
   ```

2. **Automatic Backups**: `rn_cluster_backups_v1`
   - Array of up to 12 snapshots:
   ```typescript
   interface BackupSnapshot {
     id: string;
     timestamp: number;
     desc: string;
     data: {
       towns: Record<string, TownData>;
       districts: Record<string, DistrictData>;
       deployments: DeploymentRecord[];
     };
   }
   ```

---

## 4. Shareable Link & Serialization Protocol

### URL Structure
`https://<domain>/#share=<payload>`

### Encoding Algorithm (`encodeShareData`)
1. Filter dataset using `getExportableData()`:
   - Serializes **only modified** entities (non-empty milestones, custom colors, positive nuclei, activities > 0, centers, or non-empty notes) and active deployments.
   - Minimal JSON dictionary keys:
     - `v`: format version (`1`)
     - `ts`: generation timestamp
     - `t`: compressed towns dictionary (`{ [id]: { m, n, c, a, nt, col } }`)
     - `dp`: compressed districts dictionary
     - `d`: compressed deployments array (`[ { id, f, t, fn, tn, tp, c, s, col, nt } ]`)
2. Compression & Encoding:
   - Primary: `CompressionStream('deflate-raw')` on UTF-8 JSON stream → convert to binary string → `btoa()` → URL-safe Base64 (`+` → `-`, `/` → `_`, remove `=`) → prefix with **`z_`**.
   - Universal Fallback: URI-encoded Base64url → prefix with **`b_`**.
3. Typical size: 180–400 characters for typical active cluster stages, well within SMS/WhatsApp URL limits.

### Collaborative Online Room Synchronization Protocol
- **URL Structure**: `https://<domain>/#room=<roomId>`
- **Storage Backend**: Vercel Serverless Function `/api/sync` backed by private Vercel Blob (`rooms/<roomId>.json`, Frankfurt `fra1` region).
- **Engine**: `SyncEngine` in `app.js`:
  - **Multi-Device & Long-Term Persistence**: Persistent cloud room storage allowing teams to edit together simultaneously or asynchronously across days and weeks on phone, tablet, and PC.
  - **Debounced Auto-Save Push**: 1.2s debounce after local edits, updating cloud state with version increments.
  - **Low-Overhead Polling**: 4.0s background check via HTTP `ETag` / `If-None-Match` (304 Not Modified when idle, zero bandwidth waste). Instant sync on window focus (`visibilitychange`).
  - **Safety First**: Automatic local backup (`rn_cluster_backups_v1`) created before joining any new room to guarantee zero data loss.

---

## 5. Critical Gotchas & Edge Cases

1. **Storage Deletion Risk (Safari 7-Day Cap)**:
   - Safari on iOS/macOS wipes `localStorage` and `IndexedDB` after 7 days of non-use unless the web application is installed to the Home Screen or persistent storage is requested (`navigator.storage.persist()`).
2. **Third-Party Data Leaks (QR Code Service)**:
   - *Fixed in Phase 0*: The QR generator must run locally (`qrcode` or bundled canvas generator); never transmit the payload to external servers like `api.qrserver.com`.
3. **GDPR / Privacy by Design**:
   - Religious affiliation is special-category data under Art. 9 GDPR. Never store names or personal phone numbers in notes or deployment cards.
4. **Exclave & Multi-Polygon Districting**:
   - Certain municipalities (e.g. Leimen / St. Ilgen, Schwetzingen) possess non-contiguous territorial exclaves. `rhein_neckar_districts.js` contains `exclaveCenter` and special multi-polygon features.
5. **Arrow Layer Canvas/SVG Sync**:
   - Deployments are drawn as SVG Bézier paths in a dedicated Leaflet overlay layer (`#arrow-svg-layer`). When zooming or panning, arrow endpoints must re-project via `AppState.map.latLngToLayerPoint()`.
6. **No Silent State Overwrites**:
   - When importing from a share link or migrating across origins, always trigger an automatic safety backup before committing changes to storage.
