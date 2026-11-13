# AGENTS.md: Architecture, Data Models, Formats & Operational Guide

## 1. System Overview

The **Rhein-Neckar Aktionskarte** (`rhein-neckar-aktionskarte`) is an offline-first strategic growth planning and reflection map for the Bahá'í community in the Rhein-Neckar cluster and adjacent Vorderpfalz areas.

### Core Domain
- **Geographic Coverage**:
  - **133 Municipalities**: 6 Kreisfreie Städte (Mannheim, Heidelberg, Ludwigshafen am Rhein, Frankenthal (Pfalz), Speyer, Neustadt an der Weinstraße), 54 Rhein-Neckar-Kreis municipalities, 25 Rhein-Pfalz-Kreis municipalities, 48 Landkreis Bad Dürkheim municipalities.
  - **162 Stadtteile / Nachbarschaften**: Subdivided neighborhoods across 35 cities/municipalities (including Heidelberg, Mannheim, Ludwigshafen, Neustadt, Speyer, Frankenthal, Weinheim, Sinsheim, Wiesloch, Leimen/St. Ilgen, etc.).
- **Milestone Staging**:
  - `none`: Noch nicht begonnen (uncolored/white with subtle border)
  - `pg`: 1. MS (Wachstumsprogramm) (Spring Green, `#86efac`, border `#22c55e`)
  - `ipg`: 2. MS (Intensives Wachstumsprogramm) (Apple Emerald Green, `#34c759`, border `#15803d`)
  - `ipg_plus`: 3. MS (Fortgeschrittenes Wachstumsprogramm) (Deep Forest Green, `#15803d`, border `#052e16`)
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
├── accounts.js                # window.Accounts: Clerk sign-in, account maps via /api/maps, people lists, read-only gating
├── api/maps.js                # Vercel function: account maps (create/list/load/save with CAS/share/public/delete) on Upstash Redis
├── api/sync.js                # Legacy: read-only import of retired #room= Blob rooms
├── server/maps-core.js        # AES-256-GCM encryption, map ids, roles, validation, publicView()
├── server/clerk.js            # Clerk session JWT verification (JWKS, azp) and verified e-mail lookup
├── manifest.json              # Web app manifest for PWA installation
├── sw.js                      # Service Worker (Cache-first offline shell & network fallback)
├── icon.svg                   # Vector application icon
├── server.py                  # Local Python HTTP server (ports 8080/8081)
├── vercel.json                # Vercel deployment configuration with clean URLs & security headers
├── gh-pages-handover.html     # Client-side handover page transferring user storage to Vercel
├── tests/
│   ├── test_maps_core.js      # node --test: crypto, roles, validation
│   ├── test_maps_api.js       # node --test: /api/maps with in-memory store (second account gets 404)
│   ├── test_accounts.js       # node --test: sanitizePeople, mergeMaps
│   └── test_phase0.js         # Headless Chrome integration tests (its static server answers /api/maps with ready:false)
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
     people?: { name: string; note: string; believer: boolean }[]; // only in account maps, never stored locally
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

### Account Maps (replaces the retired online rooms)
- **Setup (Vercel env)**: `MAPS_ENC_KEY` (32 bytes, base64), `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_AUTHORIZED_PARTIES`,
  and `KV_REST_API_URL`/`KV_REST_API_TOKEN` (or `UPSTASH_REDIS_REST_URL`/`_TOKEN`). `GET /api/maps?config` reports `ready`.
- **Without accounts set up** (`ready:false`) the local map stays editable as before. **With accounts** (or `/api` unknown/offline)
  the local map is view-only; editing happens in an account map (`blockLocalEdit()` rolls back and opens the dialog).
- **Storage**: Redis keys `map:<id>:meta|data|rev`, `user:<sub>:maps`, `invite:<email>:maps`. Data is encrypted server-side with
  AES-256-GCM bound to the map id. Access is decided by the meta only; non-members get 404.
- **Roles**: owner, edit, view (invited by verified e-mail), public (`#public=<id>`, only `publicView()`: no people, no notes).
- **Client**: `AppState.remote = { id, rev, role, name }` while an account map is open (`#map=<id>`). Edits PUT after 1.2 s with
  `rev`; a 409 runs the three-way `mergeMaps()`. Poll every 30 s with `?rev=`.
- **Rooms** (`#room=`) are retired; `api/sync.js` only lets old room states be imported once.

---

## 5. Critical Gotchas & Edge Cases

1. **Storage Deletion Risk (Safari 7-Day Cap)**:
   - Safari on iOS/macOS wipes `localStorage` and `IndexedDB` after 7 days of non-use unless the web application is installed to the Home Screen or persistent storage is requested (`navigator.storage.persist()`).
2. **Third-Party Data Leaks (QR Code Service)**:
   - *Fixed in Phase 0*: The QR generator must run locally (`qrcode` or bundled canvas generator); never transmit the payload to external servers like `api.qrserver.com`.
3. **GDPR / Privacy by Design**:
   - Religious affiliation is special-category data under Art. 9 GDPR. People (name, note, believer flag) exist **only in account maps**,
     encrypted on the server. While `AppState.remote` is set, nothing is written to localStorage, IndexedDB, backups or CacheStorage
     (guards in `saveState`/`persistLocal`/`AppStorage`). People must never reach `#share=` links, Blob rooms, the PNG export, the
     report/CSV, the JSON export or a public map. The privacy text in `#legal-modal` names Clerk, Google, Vercel and Upstash; keep it current.
4. **Exclave & Multi-Polygon Districting**:
   - Certain municipalities (e.g. Leimen / St. Ilgen, Schwetzingen) possess non-contiguous territorial exclaves. `rhein_neckar_districts.js` contains `exclaveCenter` and special multi-polygon features.
5. **Arrow Layer Canvas/SVG Sync**:
   - Deployments are drawn as SVG Bézier paths in a dedicated Leaflet overlay layer (`#arrow-svg-layer`). When zooming or panning, arrow endpoints must re-project via `AppState.map.latLngToLayerPoint()`.
6. **No Silent State Overwrites**:
   - When importing from a share link or migrating across origins, always trigger an automatic safety backup before committing changes to storage.
