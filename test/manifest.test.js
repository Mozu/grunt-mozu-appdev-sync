// Unit tests for the kibo.json -> arcjs logic. Run: node --test test/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveArcjs, missingAnswers, toVirtualPath, engineKey, findCollisions, canInitFix } = require('../tasks/manifest');

const bundles = [
  { src: 'assets/src/storefront.manifest.js', virtualPath: './dist/storefront.manifest.all.js' },
  { src: 'assets/src/platform.applications.manifest.js', virtualPath: './dist/platform.applications.manifest.all.js' },
];
const full = () => ({
  contextReuse: 'none',
  functions: {
    'assets/src/storefront.manifest.js': { contextReuse: 'warm' },
    'assets/src/platform.applications.manifest.js': { contextReuse: 'none' },
  },
});
const errs = (c) => resolveArcjs(c, bundles).errors.join('\n');

test('complete kibo.json produces the arcjs block keyed by virtualPath, without attestation', () => {
  const r = resolveArcjs(full(), bundles);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.arcjs, {
    contextReuse: 'none',
    files: {
      './dist/storefront.manifest.all.js': { contextReuse: 'warm' },
      './dist/platform.applications.manifest.all.js': { contextReuse: 'none' },
    },
  });
  assert.ok(!JSON.stringify(r.arcjs).includes('attestation'));
});

test('missing kibo.json, top-level value or bundle entry each fail with no block', () => {
  assert.match(resolveArcjs(null, bundles).errors[0], /kibo\.json is missing/);
  const noTop = full(); delete noTop.contextReuse;
  assert.match(errs(noTop), /missing top-level "contextReuse"/);
  const noEntry = full(); delete noEntry.functions['assets/src/storefront.manifest.js'];
  assert.equal(resolveArcjs(noEntry, bundles).arcjs, null);
  assert.match(errs(noEntry), /no entry for bundle assets\/src\/storefront\.manifest\.js/);
});

test('values are trimmed and case-insensitive; anything but warm/none fails', () => {
  const c = full();
  c.contextReuse = ' NONE ';
  c.functions['assets/src/storefront.manifest.js'].contextReuse = 'Warm';
  assert.deepEqual(resolveArcjs(c, bundles).errors, []);
  c.functions['assets/src/storefront.manifest.js'].contextReuse = 'hot';
  assert.match(errs(c), /invalid "hot"/);
});

test('unknown keys and options fail; a dist-path key suggests the source path', () => {
  const c = full();
  c.functions['./dist/storefront.manifest.all.js'] = { contextReuse: 'warm' };
  c.functions['assets/src/platform.applications.manifest.js'].minInstances = 1;
  assert.match(errs(c), /no such manifest.*key by the source manifest: "assets\/src\/storefront\.manifest\.js"/);
  assert.match(errs(c), /unknown option "minInstances"/);
});

test('resolveArcjs keys files by the virtualPath it is given', () => {
  const win = [{ src: 'assets/src/storefront.manifest.js', virtualPath: './dist\\storefront.manifest.all.js' }];
  const r = resolveArcjs({ contextReuse: 'none', functions: { 'assets/src/storefront.manifest.js': { contextReuse: 'warm' } } }, win);
  assert.deepEqual(Object.keys(r.arcjs.files), ['./dist\\storefront.manifest.all.js']);
});

test('missingAnswers lists the top level (null), then bundles without a valid entry', () => {
  assert.deepEqual(missingAnswers({}, bundles), [null, bundles[0].src, bundles[1].src]);
  const c = full(); c.functions['assets/src/storefront.manifest.js'].contextReuse = 'hot';
  assert.deepEqual(missingAnswers(c, bundles), [bundles[0].src]);
  assert.deepEqual(missingAnswers(full(), bundles), []);
});

test('invalid top-level value and a non-object "functions" fail', () => {
  assert.match(errs({ ...full(), contextReuse: 'hot' }), /top-level "contextReuse": invalid "hot"/);
  assert.ok(resolveArcjs({ ...full(), contextReuse: 'hot' }, bundles).arcjs === null);
  assert.match(errs({ contextReuse: 'none', functions: [] }), /"functions" must be an object/);
  assert.match(errs({ contextReuse: 'none', functions: 'x' }), /"functions" must be an object/);
});

test('toVirtualPath always uses "/" (Windows path.relative gives backslashes)', () => {
  assert.equal(toVirtualPath('dist\\sub\\x.all.js'), './dist/sub/x.all.js');
  assert.equal(toVirtualPath('dist/x.all.js'), './dist/x.all.js');
});

test('two bundles the engine cannot tell apart are reported, using the engine\'s own cleaning rule', () => {
  assert.equal(engineKey('./dist/a-b.js'), engineKey('./dist/AB.js'));
  assert.equal(engineKey('./dist/a/bc.js'), engineKey('./dist/ab/c.js'));
  const twins = [
    { src: 'assets/src/a.manifest.js', virtualPath: './dist/a/bc.js' },
    { src: 'assets/src/b.manifest.js', virtualPath: './dist/ab/c.js' },
  ];
  assert.match(findCollisions(twins).join('\n'), /give each manifest its own output file/);
  assert.deepEqual(findCollisions(bundles), []);
});

test('Object.prototype names are not treated as entries or bundles', () => {
  const c = full();
  c.functions.constructor = { contextReuse: 'none' };
  c.functions.toString = { contextReuse: 'none' };
  assert.match(errs(c), /functions\["constructor"\]: no such manifest/);
  assert.match(errs(c), /functions\["toString"\]: no such manifest/);
  const odd = [{ src: 'assets/src/constructor', virtualPath: './dist/constructor' }];
  assert.deepEqual(missingAnswers({ contextReuse: 'none' }, odd), ['assets/src/constructor']);
  assert.match(resolveArcjs({ contextReuse: 'none', functions: {} }, odd).errors.join('\n'), /no entry for bundle assets\/src\/constructor/);
  assert.deepEqual(findCollisions([{ src: 'a', virtualPath: './dist/constructor' }]), []);
});

test('missingAnswers asks once per source', () => {
  const twice = [bundles[0], { src: bundles[0].src, virtualPath: './dist/other.js' }];
  assert.deepEqual(missingAnswers({ contextReuse: 'none' }, twice), [bundles[0].src]);
});

test('findCollisions: an "assets" path segment and Object.prototype names behave as in the engine', () => {
  assert.equal(findCollisions([{ src: 'a', virtualPath: './dist/assets/x.js' }, { src: 'b', virtualPath: './dist/x.js' }]).length, 1);
  assert.deepEqual(findCollisions([{ src: 'a', virtualPath: './constructor' }]), []);
});

test('a bundle source named like an Object.prototype member still needs its own entry', () => {
  const odd = [{ src: 'constructor', virtualPath: './dist/c.js' }];
  assert.match(resolveArcjs({ contextReuse: 'none', functions: {} }, odd).errors.join('\n'), /no entry for bundle constructor/);
  assert.deepEqual(missingAnswers({ contextReuse: 'none', functions: {} }, odd), ['constructor']);
});

test('canInitFix: only when answering the questions would make kibo.json build', () => {
  assert.equal(canInitFix(null, bundles), true);                       // no file: init creates it
  assert.equal(canInitFix({}, bundles), true);
  assert.equal(canInitFix(full(), bundles), false);                    // nothing to ask
  const missingOne = full(); delete missingOne.functions['assets/src/storefront.manifest.js'];
  assert.equal(canInitFix(missingOne, bundles), true);
  const renamed = full(); renamed.functions['./dist/storefront.manifest.all.js'] = renamed.functions['assets/src/storefront.manifest.js'];
  delete renamed.functions['assets/src/storefront.manifest.js'];
  assert.equal(canInitFix(renamed, bundles), false);                   // a stale key: init cannot fix it
  assert.equal(canInitFix({ contextReuse: 'none', functions: [] }, bundles), false);
  assert.equal(canInitFix([1], bundles), false);
});
