// Konten-Karten: anlegen, laden, speichern, teilen, löschen. Speicher: Upstash Redis (REST).
// Schlüssel: map:<id>:meta (Besitzer, Name, Einladungen, öffentlich), map:<id>:data (Chiffrat), map:<id>:rev,
// user:<sub>:maps und invite:<email>:maps sind nur Verzeichnisse; Zugriff entscheidet immer die Meta.
// Nicht-Mitglieder bekommen 404, damit fremde Karten-IDs nicht bestätigt werden.
const core = require('../server/maps-core.js');
const clerk = require('../server/clerk.js');

const MAX_MAPS_PER_USER = 50;
const MAX_INVITES = 50;
const MAX_NAME = 80;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const metaKey = (id) => `map:${id}:meta`;
const dataKey = (id) => `map:${id}:data`;
const revKey = (id) => `map:${id}:rev`;
const userKey = (sub) => `user:${sub}:maps`;
const inviteKey = (email) => `invite:${email}:maps`;

// Vergleichen-und-Setzen in einem Schritt, damit zwei gleichzeitige Speicherungen sich nicht überschreiben.
const CAS_SCRIPT = [
  "if redis.call('EXISTS', KEYS[3]) == 0 then return -2 end",
  "local cur = tonumber(redis.call('GET', KEYS[1]) or '0')",
  "if cur ~= tonumber(ARGV[1]) then return -1 end",
  "redis.call('SET', KEYS[2], ARGV[2])",
  "redis.call('SET', KEYS[1], cur + 1)",
  'return cur + 1'
].join('\n');

function upstashFromEnv(env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const base = url.replace(/\/+$/, '');
  const call = async (path, body) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000)
    });
    const json = await r.json().catch(() => null);
    if (!r.ok || !json || json.error) throw new Error(`Upstash: ${(json && json.error) || r.status}`);
    return json;
  };
  return {
    cmd: async (c) => (await call('', c)).result,
    multi: async (cs) => (await call('/multi-exec', cs)).map(x => {
      if (x.error) throw new Error(`Upstash: ${x.error}`);
      return x.result;
    })
  };
}

const send = (res, status, body) => res.status(status).json(body);
const fail = (res, status, error) => send(res, status, { ok: false, error });
const notFound = (res) => fail(res, 404, 'Karte nicht gefunden');

function parseBody(req) {
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch (e) { return null; }
  }
  return req.body && typeof req.body === 'object' ? req.body : null;
}

const parse = (raw) => (raw ? JSON.parse(raw) : null);

function cleanName(name) {
  const n = String(name || '').trim();
  return n && n.length <= MAX_NAME ? n : null;
}

function createHandler(deps = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const env = deps.env || process.env;
    const key = core.loadKey(env);
    const store = deps.store || upstashFromEnv(env);
    const auth = deps.auth || clerk.fromEnv(env);
    if (!key || !store || !auth) return fail(res, 503, 'Konten sind noch nicht eingerichtet');

    const q = req.query || {};
    const id = q.id;
    if (id !== undefined && !core.isMapId(id)) return notFound(res);

    try {
      if (req.method === 'GET' && id && q.view === 'public') {
        const [metaRaw, dataRaw] = await store.cmd(['MGET', metaKey(id), dataKey(id)]);
        const meta = parse(metaRaw);
        if (!meta || meta.public !== true || !dataRaw) return notFound(res);
        const data = core.decrypt(parse(dataRaw).env, key, id);
        return send(res, 200, { ok: true, id, name: meta.name, data: core.publicView(data) });
      }

      const authHeader = String((req.headers && req.headers.authorization) || '');
      if (!authHeader.startsWith('Bearer ')) return fail(res, 401, 'Anmeldung erforderlich');
      let sub;
      try {
        sub = (await auth.verify(authHeader.slice(7).trim())).sub;
      } catch (e) {
        return fail(res, 401, 'Anmeldung ungültig');
      }

      // Besitzer brauchen keinen Clerk-Aufruf; nur Eingeladene werden über ihre bestätigten Adressen erkannt.
      const roleFor = async (meta) => {
        if (!meta) return null;
        if (meta.ownerId === sub) return 'owner';
        return core.roleOf(meta, sub, await auth.emailsOf(sub));
      };

      if (!id && req.method === 'GET') {
        const emails = await auth.emailsOf(sub);
        const ids = await store.cmd(['SUNION', userKey(sub), ...emails.map(inviteKey)]);
        if (!ids || !ids.length) return send(res, 200, { ok: true, maps: [] });
        const metas = await store.cmd(['MGET', ...ids.map(metaKey)]);
        const maps = [];
        ids.forEach((mid, i) => {
          const meta = parse(metas[i]);
          const role = core.roleOf(meta, sub, emails);
          if (role) maps.push({ id: mid, name: meta.name, role, public: meta.public === true });
        });
        maps.sort((a, b) => a.name.localeCompare(b.name, 'de'));
        return send(res, 200, { ok: true, maps });
      }

      if (!id && req.method === 'POST') {
        const body = parseBody(req) || {};
        const name = cleanName(body.name);
        if (!name) return fail(res, 400, 'Name fehlt oder ist zu lang');
        const data = body.data === undefined ? { towns: {}, districts: {}, deployments: [] } : body.data;
        const invalid = core.validateData(data);
        if (invalid) return fail(res, 400, invalid);
        if ((await store.cmd(['SCARD', userKey(sub)])) >= MAX_MAPS_PER_USER) return fail(res, 409, 'Zu viele Karten');
        const newId = core.newMapId();
        const meta = { ownerId: sub, name, invites: {}, public: false };
        const updatedAt = new Date().toISOString();
        await store.multi([
          ['SET', metaKey(newId), JSON.stringify(meta)],
          ['SET', dataKey(newId), JSON.stringify({ updatedAt, env: core.encrypt(data, key, newId) })],
          ['SET', revKey(newId), '0'],
          ['SADD', userKey(sub), newId]
        ]);
        return send(res, 201, { ok: true, id: newId, rev: 0, updatedAt });
      }

      if (!id) return fail(res, 405, 'Methode nicht erlaubt');

      if (req.method === 'GET') {
        // Mit ?rev= kostet eine unveränderte Karte nur einen Befehl (für das Abfragen im Hintergrund).
        const since = q.rev !== undefined ? Number(q.rev) : null;
        const keys = since === null ? [metaKey(id), revKey(id), dataKey(id)] : [metaKey(id), revKey(id)];
        const [metaRaw, revRaw, dataRaw0] = await store.cmd(['MGET', ...keys]);
        const meta = parse(metaRaw);
        const role = await roleFor(meta);
        if (!core.canRead(role)) return notFound(res);
        const rev = Number(revRaw) || 0;
        if (since !== null && since === rev) return send(res, 200, { ok: true, id, rev, unchanged: true });
        const dataRaw = since === null ? dataRaw0 : await store.cmd(['GET', dataKey(id)]);
        const stored = parse(dataRaw);
        const out = { ok: true, id, name: meta.name, role, rev, updatedAt: stored.updatedAt, data: core.decrypt(stored.env, key, id) };
        if (role === 'owner') Object.assign(out, { invites: meta.invites || {}, public: meta.public === true });
        return send(res, 200, out);
      }

      const meta = parse(await store.cmd(['GET', metaKey(id)]));
      const role = await roleFor(meta);
      if (!core.canRead(role)) return notFound(res);

      if (req.method === 'PUT') {
        if (!core.canWrite(role)) return fail(res, 403, 'Nur Lesezugriff');
        const body = parseBody(req) || {};
        const invalid = core.validateData(body.data);
        if (invalid) return fail(res, 400, invalid);
        if (!Number.isInteger(body.rev) || body.rev < 0) return fail(res, 400, 'rev fehlt');
        const updatedAt = new Date().toISOString();
        const value = JSON.stringify({ updatedAt, env: core.encrypt(body.data, key, id) });
        const rev = await store.cmd(['EVAL', CAS_SCRIPT, 3, revKey(id), dataKey(id), metaKey(id), body.rev, value]);
        if (rev === -2) return notFound(res);
        if (rev === -1) return fail(res, 409, 'Karte wurde inzwischen geändert');
        return send(res, 200, { ok: true, id, rev, updatedAt });
      }

      if (!core.canShare(role)) return fail(res, 403, 'Nur der Besitzer darf das');

      if (req.method === 'PATCH') {
        const body = parseBody(req) || {};
        const next = { ...meta, invites: { ...(meta.invites || {}) } };
        const added = [], removed = [];
        if (body.name !== undefined) {
          next.name = cleanName(body.name);
          if (!next.name) return fail(res, 400, 'Name fehlt oder ist zu lang');
        }
        if (body.public !== undefined) {
          if (typeof body.public !== 'boolean') return fail(res, 400, 'public ungültig');
          next.public = body.public;
        }
        if (body.invites !== undefined) {
          if (!body.invites || typeof body.invites !== 'object' || Array.isArray(body.invites)) return fail(res, 400, 'invites ungültig');
          for (const [raw, r] of Object.entries(body.invites)) {
            const email = String(raw).trim().toLowerCase();
            if (email.length > 254 || !EMAIL_RE.test(email)) return fail(res, 400, `Ungültige E-Mail: ${raw}`);
            if (r === null) {
              if (next.invites[email]) removed.push(email);
              delete next.invites[email];
            } else if (r === 'view' || r === 'edit') {
              if (!next.invites[email]) added.push(email);
              next.invites[email] = r;
            } else {
              return fail(res, 400, 'Rolle muss view oder edit sein');
            }
          }
          if (Object.keys(next.invites).length > MAX_INVITES) return fail(res, 400, 'Zu viele Einladungen');
        }
        await store.multi([
          ['SET', metaKey(id), JSON.stringify(next)],
          ...added.map(e => ['SADD', inviteKey(e), id]),
          ...removed.map(e => ['SREM', inviteKey(e), id])
        ]);
        return send(res, 200, { ok: true, id, name: next.name, invites: next.invites, public: next.public === true });
      }

      if (req.method === 'DELETE') {
        await store.multi([
          ['DEL', metaKey(id), dataKey(id), revKey(id)],
          ['SREM', userKey(sub), id],
          ...Object.keys(meta.invites || {}).map(e => ['SREM', inviteKey(e), id])
        ]);
        return send(res, 200, { ok: true });
      }

      return fail(res, 405, 'Methode nicht erlaubt');
    } catch (e) {
      console.error('maps:', e.message);
      return fail(res, 500, 'Serverfehler');
    }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.CAS_SCRIPT = CAS_SCRIPT;
