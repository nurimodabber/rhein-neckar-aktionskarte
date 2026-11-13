const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const core = require('../server/maps-core.js');

const key = crypto.randomBytes(32);
const sample = {
  towns: { a: { milestone: 'pg', nuclei: 2, notes: 'intern', people: [{ name: 'X', believer: true }], activities: { devotionals: 1, secret: 9 } } },
  districts: { d: { milestone: 'ipg', notes: 'n', people: [{ name: 'Y' }] } },
  deployments: [{ id: 'dep1', fromId: 'a', toId: 'b', type: 'Pioniere', count: 2, notes: 'Name Z' }]
};

test('Schlüssel: fehlt oder falsche Länge → null', () => {
  assert.strictEqual(core.loadKey({}), null);
  assert.strictEqual(core.loadKey({ MAPS_ENC_KEY: Buffer.alloc(16).toString('base64') }), null);
  assert.strictEqual(core.loadKey({ MAPS_ENC_KEY: key.toString('base64') }).length, 32);
});

test('Karten-ID: 128 Bit, eindeutig, Format geprüft', () => {
  const id = core.newMapId();
  assert.ok(core.isMapId(id));
  assert.notStrictEqual(id, core.newMapId());
  assert.ok(!core.isMapId('../rooms/x'));
});

test('Verschlüsselung: Rundweg, kein Klartext, an Karten-ID gebunden', () => {
  const id = core.newMapId();
  const env = core.encrypt(sample, key, id);
  assert.ok(!JSON.stringify(env).includes('intern'));
  assert.deepStrictEqual(core.decrypt(env, key, id), sample);
  assert.throws(() => core.decrypt(env, key, core.newMapId()));
  assert.throws(() => core.decrypt(env, crypto.randomBytes(32), id));
  const tampered = { ...env, ct: Buffer.from(env.ct, 'base64').map((b, i) => i === 0 ? b ^ 1 : b).toString('base64') };
  assert.throws(() => core.decrypt(tampered, key, id));
});

test('Rollen: zweites Konto hat keinen Zugriff auf fremde Karte', () => {
  const meta = { ownerId: 'user_A', shares: { user_B: 'view' }, invites: { 'c@example.org': 'edit' } };
  assert.strictEqual(core.roleOf(meta, 'user_A'), 'owner');
  assert.strictEqual(core.roleOf(meta, 'user_B'), 'view');
  assert.strictEqual(core.roleOf(meta, 'user_C', ['C@Example.org']), 'edit');
  assert.strictEqual(core.roleOf(meta, 'user_X'), null);
  assert.strictEqual(core.roleOf(meta, null), null);
  assert.strictEqual(core.roleOf({ ownerId: 'user_A', shares: { user_B: 'admin' } }, 'user_B'), null);
  assert.ok(!core.canRead(null) && !core.canWrite('view') && core.canWrite('edit') && !core.canShare('edit'));
});

test('Öffentliche Ansicht: keine Personen, Notizen oder unbekannten Felder', () => {
  const pub = JSON.stringify(core.publicView(sample));
  for (const s of ['people', 'notes', 'intern', 'Name Z', 'secret', '"X"', '"Y"']) assert.ok(!pub.includes(s), s);
  assert.strictEqual(core.publicView(sample).towns.a.nuclei, 2);
  assert.strictEqual(core.publicView(sample).deployments[0].count, 2);
});

test('Validierung an der Vertrauensgrenze', () => {
  assert.strictEqual(core.validateData(sample), null);
  assert.ok(core.validateData(null));
  assert.ok(core.validateData([]));
  assert.ok(core.validateData({ deployments: {} }));
  assert.ok(core.validateData({ towns: { a: { notes: 'x'.repeat(3 * 1024 * 1024) } } }));
});
