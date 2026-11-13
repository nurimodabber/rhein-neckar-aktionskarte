const test = require('node:test');
const assert = require('node:assert');
const { sanitizePeople, mergeMaps } = require('../accounts.js');

test('sanitizePeople kürzt, verwirft Leere und erzwingt boolean', () => {
  const out = sanitizePeople([
    { name: '  Anna ', note: 'x', believer: true },
    { name: '   ' },
    null,
    { name: 'B'.repeat(150), note: 'n'.repeat(600), believer: 'yes' }
  ]);
  assert.deepStrictEqual(out[0], { name: 'Anna', note: 'x', believer: true });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out[1].name.length, 100);
  assert.strictEqual(out[1].note.length, 500);
  assert.strictEqual(out[1].believer, false);
  assert.deepStrictEqual(sanitizePeople('kaputt'), []);
  assert.strictEqual(sanitizePeople(Array(600).fill({ name: 'x' })).length, 500);
});

test('mergeMaps übernimmt fremde und eigene Änderungen an verschiedenen Orten', () => {
  const base = { towns: { a: { milestone: 'none' }, b: { milestone: 'none' } }, districts: {}, deployments: [] };
  const mine = { towns: { a: { milestone: 'pg' }, b: { milestone: 'none' } }, districts: {}, deployments: [] };
  const theirs = { towns: { a: { milestone: 'none' }, b: { milestone: 'ipg' } }, districts: {}, deployments: [{ id: 'd1' }] };
  const r = mergeMaps(base, mine, theirs);
  assert.strictEqual(r.data.towns.a.milestone, 'pg');
  assert.strictEqual(r.data.towns.b.milestone, 'ipg');
  assert.deepStrictEqual(r.data.deployments, [{ id: 'd1' }]);
  assert.strictEqual(r.lost, 0);
});

test('mergeMaps: gleicher Ort von beiden geändert → eigene Version, lost zählt', () => {
  const base = { towns: { a: { nuclei: 0 } }, districts: {}, deployments: [] };
  const mine = { towns: { a: { nuclei: 1 } }, districts: {}, deployments: [{ id: 'm' }] };
  const theirs = { towns: { a: { nuclei: 2 } }, districts: {}, deployments: [{ id: 't' }] };
  const r = mergeMaps(base, mine, theirs);
  assert.strictEqual(r.data.towns.a.nuclei, 1);
  assert.deepStrictEqual(r.data.deployments, [{ id: 'm' }]);
  assert.strictEqual(r.lost, 2);
});
