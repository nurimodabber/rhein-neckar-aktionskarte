// Kern für Konten-Karten, unabhängig vom Speicher: Verschlüsselung, Rollen, öffentliche Ansicht.
// Personendaten (Art. 9 DSGVO) liegen nur verschlüsselt im Speicher; der Schlüssel kommt aus der Umgebung, nie aus dem Speicher.
const crypto = require('crypto');

const MAX_DATA_BYTES = 2 * 1024 * 1024;
const MAP_ID_RE = /^[A-Za-z0-9_-]{22}$/;

// Ohne gültigen Schlüssel liefert die API 503 statt unverschlüsselt zu speichern.
function loadKey(env = process.env) {
  const raw = env.MAPS_ENC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

// 128 Bit Zufall: Karten-IDs sind nicht erratbar.
function newMapId() {
  return crypto.randomBytes(16).toString('base64url');
}

function isMapId(id) {
  return typeof id === 'string' && MAP_ID_RE.test(id);
}

// AES-256-GCM; die Karten-ID ist AAD, damit ein Chiffrat nicht unter eine andere Karte kopiert werden kann.
function encrypt(obj, key, mapId) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(mapId, 'utf8'));
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { v: 1, iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function decrypt(env, key, mapId) {
  if (!env || env.v !== 1) throw new Error('Unbekanntes Format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'base64'), { authTagLength: 16 }); // keine gekürzten Tags
  decipher.setAAD(Buffer.from(mapId, 'utf8'));
  decipher.setAuthTag(Buffer.from(env.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(env.ct, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

// meta: { ownerId, shares: { [userId]: 'view'|'edit' }, invites: { [email]: 'view'|'edit' }, public }
// emails: nur bestätigte Adressen des angemeldeten Kontos.
function roleOf(meta, userId, emails = []) {
  if (!meta) return null;
  if (userId && meta.ownerId === userId) return 'owner';
  const byId = userId && meta.shares && meta.shares[userId];
  if (byId === 'edit' || byId === 'view') return byId;
  for (const e of emails) {
    const r = meta.invites && meta.invites[String(e).toLowerCase()];
    if (r === 'edit' || r === 'view') return r;
  }
  return null;
}

const canRead = (role) => role === 'owner' || role === 'edit' || role === 'view';
const canWrite = (role) => role === 'owner' || role === 'edit';
const canShare = (role) => role === 'owner';

// Öffentliche Ansicht per Positivliste: neue Felder bleiben automatisch privat.
const PUBLIC_UNIT_FIELDS = ['milestone', 'customColor', 'isCenter', 'nuclei', 'activities'];
const PUBLIC_ACT_FIELDS = ['devotionals', 'studyCircles', 'childrenClasses', 'juniorYouth'];
const PUBLIC_DEP_FIELDS = ['id', 'fromId', 'toId', 'fromName', 'toName', 'type', 'count', 'status', 'color', 'createdAt'];

function pick(obj, fields) {
  const out = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
}

function publicUnits(units) {
  const out = {};
  for (const [id, u] of Object.entries(units || {})) {
    const p = pick(u, PUBLIC_UNIT_FIELDS);
    if (p.activities) p.activities = pick(p.activities, PUBLIC_ACT_FIELDS);
    out[id] = p;
  }
  return out;
}

function publicView(data) {
  return {
    towns: publicUnits(data.towns),
    districts: publicUnits(data.districts),
    deployments: (data.deployments || []).map(d => pick(d, PUBLIC_DEP_FIELDS))
  };
}

// Prüfung an der Vertrauensgrenze: nur die erwartete Form und Größe.
function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'Daten fehlen';
  for (const k of ['towns', 'districts']) {
    if (data[k] !== undefined && (typeof data[k] !== 'object' || Array.isArray(data[k]))) return `${k} ungültig`;
  }
  if (data.deployments !== undefined && !Array.isArray(data.deployments)) return 'deployments ungültig';
  if (Buffer.byteLength(JSON.stringify(data), 'utf8') > MAX_DATA_BYTES) return 'Karte zu groß';
  return null;
}

module.exports = { loadKey, newMapId, isMapId, encrypt, decrypt, roleOf, canRead, canWrite, canShare, publicView, validateData };
