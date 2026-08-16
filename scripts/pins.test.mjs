import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');

const block = html.match(/\/\*PURE-START\*\/([\s\S]*?)\/\*PURE-END\*\//);
assert.ok(block, 'index.html must contain a /*PURE-START*/ ... /*PURE-END*/ block');

function load(stored) {
  const store = new Map(stored ? [['camper-report:pins', JSON.stringify(stored)]] : []);
  const sandbox = {
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    // Share this realm's Set constructor with the vm context. Without it,
    // `new Set(...)` inside the sandbox produces a cross-realm Set that
    // assert.deepEqual can't compare against a Set built out here.
    Set,
  };
  vm.createContext(sandbox);
  vm.runInContext(block[1] + '\n;({DEFAULT_PINS, loadPins, savePins, togglePin, visibleRows})', sandbox);
  return vm.runInContext('({DEFAULT_PINS, loadPins, savePins, togglePin, visibleRows})', sandbox);
}

const V = [
  { id: 'a', class: 'SUV' },
  { id: 'b', class: 'Minivan' },
  { id: 'c', class: 'SUV' },
];
const suvOnly = v => v.class === 'SUV';

test('default pins seed on first load', () => {
  const m = load(null);
  assert.deepEqual(m.loadPins(), new Set(m.DEFAULT_PINS));
});

test('default pins include the Mazda5 and the Bolt', () => {
  const m = load(null);
  assert.ok(m.DEFAULT_PINS.includes('mazda5-gen3'));
  assert.ok(m.DEFAULT_PINS.includes('chevrolet-bolt-ev-gen1'));
});

test('stored pins override the defaults, including an empty set', () => {
  assert.deepEqual(load([]).loadPins(), new Set());
  assert.deepEqual(load(['b']).loadPins(), new Set(['b']));
});

test('togglePin adds and removes', () => {
  const m = load([]);
  assert.deepEqual(m.togglePin('a'), new Set(['a']));
  assert.deepEqual(m.togglePin('a'), new Set());
});

test('visibleRows is the union of filter matches and pins', () => {
  const m = load(['b']);
  const rows = m.visibleRows(V, suvOnly, new Set(['b']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['a', 'b', 'c']);
});

test('visibleRows does not duplicate a pinned vehicle that also matches', () => {
  const m = load(['a']);
  const rows = m.visibleRows(V, suvOnly, new Set(['a']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['a', 'c']);
});

test('visibleRows preserves source order so the caller can sort', () => {
  const m = load(['b']);
  const rows = m.visibleRows(V, () => false, new Set(['b']), false, new Set());
  assert.deepEqual(rows.map(v => v.id), ['b']);
});

test('compare mode ignores pins entirely', () => {
  const m = load(['a']);
  const rows = m.visibleRows(V, suvOnly, new Set(['a']), true, new Set(['b']));
  assert.deepEqual(rows.map(v => v.id), ['b']);
});
