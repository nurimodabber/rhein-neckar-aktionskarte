// Endpunkt-Tests mit Fake-Redis und zwei Konten: B darf A's Karte weder sehen noch ändern.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { createHandler, CAS_SCRIPT } = require('../api/maps.js');
const clerk = require('../server/clerk.js');

// Kleines Redis im Speicher, nur die Befehle, die der Endpunkt nutzt.
function fakeRedis() {
  const kv = new Map();
  const set = (k) => { if (!kv.has(k)) kv.set(k, new Set()); return kv.get(k); };
  const run = (c) => {
    const [op, ...a] = c;
    switch (op) {
      case 'GET': return kv.has(a[0]) ? kv.get(a[0]) : null;
      case 'SET': kv.set(a[0], String(a[1])); return 'OK';
      case 'DEL': a.forEach(k => kv.delete(k)); return a.length;
      case 'MGET': return a.map(k => (kv.has(k) ? kv.get(k) : null));
      case 'SADD': set(a[0]).add(a[1]); return 1;
      case 'SREM': return kv.has(a[0]) ? Number(kv.get(a[0]).delete(a[1])) : 0;
      case 'SCARD': return kv.has(a[0]) ? kv.get(a[0]).size : 0;
      case 'SUNION': return [...new Set(a.flatMap(k => (kv.has(k) ? [...kv.get(k)] : [])))];
      case 'EVAL': {
        assert.strictEqual(a[0], CAS_SCRIPT);
        const [, , rk, dk, mk, expected, value] = a;
        if (!kv.has(mk)) return -2;
        const cur = Number(kv.get(rk) || 0);
        if (cur !== Number(expected)) return -1;
        kv.set(dk, value);
        kv.set(rk, String(cur + 1));
        return cur + 1;
      }
      default: throw new Error('unbekannter Befehl ' + op);
    }
  };
  return { kv, cmd: async (c) => run(c), multi: async (cs) => cs.map(run) };
}

// Token "tok-<user>" steht für ein gültiges Clerk-Token; emails sind die bestätigten Adressen.
function fakeAuth(emails) {
  return {
    verify: async (t) => { if (!/^tok-/.test(t)) throw new Error('ungültig'); return { sub: t.slice(4) }; },
    emailsOf: async (sub) => emails[sub] || []
  };
}

function setup(emails = { user_A: ['a@example.org'], user_B: ['b@example.org'] }) {
  const store = fakeRedis();
  const env = { MAPS_ENC_KEY: crypto.randomBytes(32).toString('base64') };
  const handler = createHandler({ env, store, auth: fakeAuth(emails) });
  const call = async (method, user, query = {}, body) => {
    const res = {
      statusCode: 0, body: null, headers: {},
      status(c) { this.statusCode = c; return this; },
      json(b) { this.body = b; return this; },
      setHeader(k, v) { this.headers[k] = v; }
    };
    const headers = user ? { authorization: `Bearer tok-${user}` } : {};
    await handler({ method, query, body, headers }, res);
    return res;
  };
  return { store, call, emails };
}

const DATA = {
  towns: { t1: { milestone: 'pg', nuclei: 3, notes: 'intern', people: [{ name: 'Person X', believer: true }] } },
  districts: {},
  deployments: [{ id: 'd1', fromId: 't1', toId: 't2', count: 1, notes: 'Name Z' }]
};

async function mapOfA(ctx) {
  const r = await ctx.call('POST', 'user_A', {}, { name: 'Cluster', data: DATA });
  assert.strictEqual(r.statusCode, 201);
  return r.body.id;
}

test('Besitzer: anlegen, laden, speichern, auflisten', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  const got = await ctx.call('GET', 'user_A', { id });
  assert.strictEqual(got.statusCode, 200);
  assert.deepStrictEqual(got.body.data, DATA);
  assert.strictEqual(got.body.role, 'owner');
  const put = await ctx.call('PUT', 'user_A', { id }, { rev: 0, data: { ...DATA, deployments: [] } });
  assert.strictEqual(put.body.rev, 1);
  const list = await ctx.call('GET', 'user_A');
  assert.deepStrictEqual(list.body.maps.map(m => m.id), [id]);
  assert.strictEqual(got.headers['Cache-Control'], 'no-store');
});

test('Speicher enthält keinen Klartext', async () => {
  const ctx = setup();
  await mapOfA(ctx);
  const dump = JSON.stringify([...ctx.store.kv.values()].map(v => (v instanceof Set ? [...v] : v)));
  for (const s of ['Person X', 'intern', 'Name Z']) assert.ok(!dump.includes(s), s);
});

test('Fremdes Konto: GET, PUT, PATCH, DELETE und Abfrage-Poll ergeben 404', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  const results = [
    await ctx.call('GET', 'user_B', { id }),
    await ctx.call('GET', 'user_B', { id, rev: '0' }),
    await ctx.call('PUT', 'user_B', { id }, { rev: 0, data: {} }),
    await ctx.call('PATCH', 'user_B', { id }, { public: true }),
    await ctx.call('DELETE', 'user_B', { id })
  ];
  for (const r of results) assert.deepStrictEqual([r.statusCode, r.body], [404, { ok: false, error: 'Karte nicht gefunden' }]);
  assert.strictEqual((await ctx.call('GET', 'user_A', { id })).body.rev, 0, 'Karte unverändert');
});

test('Verzeichnis ist nur ein Hinweis: fremde ID im Set von B wird nicht gelistet', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  ctx.store.kv.set('user:user_B:maps', new Set([id]));
  ctx.store.kv.set('invite:b@example.org:maps', new Set([id]));
  assert.deepStrictEqual((await ctx.call('GET', 'user_B')).body.maps, []);
});

test('Einladung per E-Mail: Rollen, unbestätigte Adresse, Widerruf', async () => {
  const ctx = setup({ user_A: [], user_B: ['b@example.org'], user_C: [] });
  const id = await mapOfA(ctx);
  const p = await ctx.call('PATCH', 'user_A', { id }, { invites: { 'B@Example.org': 'view', 'c@example.org': 'edit' } });
  assert.deepStrictEqual(p.body.invites, { 'b@example.org': 'view', 'c@example.org': 'edit' });

  const b = await ctx.call('GET', 'user_B', { id });
  assert.strictEqual(b.body.role, 'view');
  assert.strictEqual(b.body.invites, undefined, 'Eingeladene sehen keine Einladungsliste');
  assert.strictEqual((await ctx.call('PUT', 'user_B', { id }, { rev: 0, data: DATA })).statusCode, 403);
  assert.strictEqual((await ctx.call('PATCH', 'user_B', { id }, { public: true })).statusCode, 403);
  assert.deepStrictEqual((await ctx.call('GET', 'user_B')).body.maps.map(m => m.role), ['view']);

  // C hat die Adresse nicht bestätigt → keine bestätigten Adressen → kein Zugriff.
  assert.strictEqual((await ctx.call('GET', 'user_C', { id })).statusCode, 404);

  await ctx.call('PATCH', 'user_A', { id }, { invites: { 'b@example.org': null } });
  assert.strictEqual((await ctx.call('GET', 'user_B', { id })).statusCode, 404);
  assert.deepStrictEqual((await ctx.call('GET', 'user_B')).body.maps, []);
  assert.ok(!ctx.store.kv.get('invite:b@example.org:maps').has(id), 'Verzeichnis bereinigt');
});

test('PATCH prüft Eingaben', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  for (const body of [{ invites: { 'kein-mail': 'view' } }, { invites: { 'x@y.de': 'owner' } }, { invites: [] },
    { name: '' }, { name: 'x'.repeat(81) }, { public: 'ja' }]) {
    assert.strictEqual((await ctx.call('PATCH', 'user_A', { id }, body)).statusCode, 400, JSON.stringify(body));
  }
  const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`p${i}@x.de`, 'view']));
  assert.strictEqual((await ctx.call('PATCH', 'user_A', { id }, { invites: many })).statusCode, 400);
});

test('Gleichzeitiges Speichern: veraltete rev ergibt 409', async () => {
  const ctx = setup({ user_A: [], user_B: ['b@example.org'] });
  const id = await mapOfA(ctx);
  await ctx.call('PATCH', 'user_A', { id }, { invites: { 'b@example.org': 'edit' } });
  assert.strictEqual((await ctx.call('PUT', 'user_B', { id }, { rev: 0, data: DATA })).body.rev, 1);
  assert.strictEqual((await ctx.call('PUT', 'user_A', { id }, { rev: 0, data: DATA })).statusCode, 409);
  const poll = await ctx.call('GET', 'user_A', { id, rev: '1' });
  assert.deepStrictEqual([poll.body.unchanged, poll.body.data], [true, undefined]);
});

test('Öffentliche Ansicht: nur wenn freigegeben, ohne Personen, Notizen oder Meta', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  await ctx.call('PATCH', 'user_A', { id }, { invites: { 'b@example.org': 'view' } });
  const off = await ctx.call('GET', null, { id, view: 'public' });
  assert.deepStrictEqual([off.statusCode, off.body], [404, { ok: false, error: 'Karte nicht gefunden' }]);
  await ctx.call('PATCH', 'user_A', { id }, { public: true });
  const on = await ctx.call('GET', null, { id, view: 'public' });
  assert.strictEqual(on.statusCode, 200);
  const s = JSON.stringify(on.body);
  for (const x of ['people', 'notes', 'Person X', 'intern', 'Name Z', 'user_A', 'example.org', 'invites', 'ownerId']) assert.ok(!s.includes(x), x);
  assert.strictEqual(on.body.data.towns.t1.nuclei, 3);
});

test('Löschen räumt Karte und Verzeichnisse auf', async () => {
  const ctx = setup();
  const id = await mapOfA(ctx);
  await ctx.call('PATCH', 'user_A', { id }, { invites: { 'b@example.org': 'view' } });
  assert.strictEqual((await ctx.call('DELETE', 'user_A', { id })).statusCode, 200);
  assert.strictEqual((await ctx.call('GET', 'user_A', { id })).statusCode, 404);
  for (const k of [`map:${id}:meta`, `map:${id}:data`, `map:${id}:rev`]) assert.ok(!ctx.store.kv.has(k), k);
  assert.ok(!ctx.store.kv.get('user:user_A:maps').has(id));
  assert.ok(!ctx.store.kv.get('invite:b@example.org:maps').has(id));
});

test('Ohne Anmeldung 401, falsche ID 404', async () => {
  const ctx = setup();
  assert.strictEqual((await ctx.call('GET', null)).statusCode, 401);
  const r = await ctx.call('GET', 'user_A', { id: '../x' });
  assert.strictEqual(r.statusCode, 404);
});

test('Fehlende Konfiguration ergibt 503 statt Speichern ohne Schutz', async () => {
  const res = () => ({ status(c) { this.statusCode = c; return this; }, json() { return this; }, setHeader() {} });
  const key = crypto.randomBytes(32).toString('base64');
  const cases = [
    { env: {}, store: fakeRedis(), auth: fakeAuth({}) },
    { env: { MAPS_ENC_KEY: key } , auth: fakeAuth({}) },
    { env: { MAPS_ENC_KEY: key, KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't' } },
    { env: { MAPS_ENC_KEY: key, KV_REST_API_URL: 'https://x', KV_REST_API_TOKEN: 't', CLERK_PUBLISHABLE_KEY: 'pk_test_' + Buffer.from('x.clerk.accounts.dev$').toString('base64') } }
  ];
  for (const deps of cases) {
    const r = res();
    await createHandler(deps)({ method: 'GET', query: {}, headers: {} }, r);
    assert.strictEqual(r.statusCode, 503, JSON.stringify(deps.env));
  }
});

// ─── Clerk-Token-Prüfung mit eigenem RSA-Schlüssel ───

test('Clerk: Signatur, Ablauf, Issuer und azp werden geprüft', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1' };
  const config = { issuer: 'https://x.clerk.accounts.dev', jwksUrl: 'jwks', parties: ['https://app.example'] };
  const jwks = async () => [jwk];
  const now = Math.floor(Date.now() / 1000);
  const sign = (payload, key = privateKey, header = { alg: 'RS256', kid: 'k1' }) => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${h}.${p}.${crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
  };
  const good = { sub: 'user_A', iss: config.issuer, azp: 'https://app.example', exp: now + 60 };
  assert.strictEqual((await clerk.verifyToken(sign(good), config, jwks)).sub, 'user_A');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const bad of [
    sign(good, other),
    sign({ ...good, exp: now - 600 }),
    sign({ ...good, iss: 'https://evil.example' }),
    sign({ ...good, azp: 'https://evil.example' }),
    sign({ ...good, azp: undefined }),
    sign({ ...good, sub: undefined }),
    sign(good, privateKey, { alg: 'none', kid: 'k1' }),
    sign(good, privateKey, { alg: 'RS256', kid: 'unbekannt' }),
    'kein.token'
  ]) {
    await assert.rejects(clerk.verifyToken(bad, config, jwks));
  }
});

test('Clerk: Konfiguration ohne Fremd-Standard, nur bestätigte Adressen', () => {
  assert.strictEqual(clerk.configFromEnv({}), null);
  assert.strictEqual(clerk.configFromEnv({ CLERK_SECRET_KEY: 'sk' }), null);
  const pk = 'pk_test_' + Buffer.from('x.clerk.accounts.dev$').toString('base64');
  const c = clerk.configFromEnv({ CLERK_PUBLISHABLE_KEY: pk, CLERK_SECRET_KEY: 'sk' });
  assert.strictEqual(c.issuer, 'https://x.clerk.accounts.dev');
  assert.deepStrictEqual(c.parties, ['https://rhein-neckar-aktionskarte.vercel.app']);
  assert.deepStrictEqual(clerk.verifiedEmailsOf({ email_addresses: [
    { email_address: 'A@X.de', verification: { status: 'verified' } },
    { email_address: 'b@x.de', verification: { status: 'unverified' } },
    { email_address: 'c@x.de', verification: null }
  ] }), ['a@x.de']);
});
