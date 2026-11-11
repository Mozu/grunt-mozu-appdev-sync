// Runs the real grunt "manifest" task against a tiny app that loads this plugin the way apps do
// (loadNpmTasks from the app's node_modules). Offline. Run: node --test test/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const gruntBin = path.join(repo, 'node_modules/grunt/bin/grunt');
const created = [];
// 'exit', not after(): older node:test runners skip top-level after hooks.
process.on('exit', () => created.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

const MANIFESTS = {
  'assets/src/storefront.manifest.js':
    "module.exports = { 'http.storefront.pages.global.request.after': { actionName: 'http.storefront.pages.global.request.after' }, 'contextReuse': 'warm' };\n",
  'assets/src/platform.applications.manifest.js':
    "module.exports = { 'platform.applications.onInstall': { actionName: 'platform.applications.install' } };\n",
  'assets/src/sub/commerce.carts.manifest.js':
    "module.exports = { 'cart.get.after': { actionName: 'embedded.commerce.carts.get.after' } };\n",
};
const SF = 'assets/src/storefront.manifest.js';
const PA = 'assets/src/platform.applications.manifest.js';
const CART = 'assets/src/sub/commerce.carts.manifest.js';
const fullKibo = () => ({ contextReuse: 'warm', functions: { [SF]: { contextReuse: 'warm' }, [PA]: { contextReuse: 'none' }, [CART]: { contextReuse: 'none' } } });

// localTask: register a project "manifest" task before the plugin loads (as Gruntfiles do with ./tasks).
// manifests: files to write (default MANIFESTS); mapping: replaces the manifest target's files config.
function makeApp({ kibo, localTask, manifests = MANIFESTS, mapping, kiboRaw, extraConfig = '', extraTasks = '', extraTarget = '' } = {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), 'mozusync-manifest-'));
  created.push(app);
  Object.keys(manifests).forEach((f) => {
    fs.mkdirSync(path.dirname(path.join(app, f)), { recursive: true });
    fs.writeFileSync(path.join(app, f), manifests[f]);
  });
  fs.mkdirSync(path.join(app, 'assets/src'), { recursive: true });
  fs.mkdirSync(path.join(app, 'node_modules'));
  fs.symlinkSync(path.join(repo, 'node_modules/grunt'), path.join(app, 'node_modules/grunt'), 'junction');
  fs.symlinkSync(repo, path.join(app, 'node_modules/grunt-mozu-appdev-sync'), 'junction');
  const files = mapping || "[{ expand: true, cwd: 'assets/src/', src: ['**/*.manifest.js'], dest: 'assets/dist/', ext: '.all.js', extDot: 'last' }]";
  fs.writeFileSync(path.join(app, 'Gruntfile.js'), `module.exports = function (grunt) {
  ${localTask ? "grunt.registerMultiTask('manifest', 'local', function () { grunt.file.write('local-ran', 'yes'); });" : ''}
  grunt.loadNpmTasks('grunt-mozu-appdev-sync');
  ${extraTasks}
  grunt.initConfig({ ${extraConfig} manifest: { all: { files: ${files} }${extraTarget} } });
};
`);
  if (kiboRaw !== undefined) { fs.writeFileSync(path.join(app, 'kibo.json'), kiboRaw); }
  else if (kibo) { fs.writeFileSync(path.join(app, 'kibo.json'), JSON.stringify(kibo)); }
  return app;
}

function grunt(app, args = [], input = '') {
  const r = spawnSync(process.execPath, [gruntBin, 'manifest', '--no-color', '--gruntfile', path.join(app, 'Gruntfile.js'), '--base', app, ...args],
    { input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout + r.stderr };
}

// Same, with stdout/stderr redirected to a FILE (`grunt build > log 2>&1`): grunt.fail.fatal then does not stop the code.
function gruntToFile(app, args = []) {
  const log = path.join(app, 'grunt.log');
  const fd = fs.openSync(log, 'w');
  const r = spawnSync(process.execPath, [gruntBin, 'manifest', '--no-color', '--gruntfile', path.join(app, 'Gruntfile.js'), '--base', app, ...args],
    { stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  return { code: r.status, out: fs.readFileSync(log, 'utf8') };
}
const read = (app, f) => JSON.parse(fs.readFileSync(path.join(app, f), 'utf8'));
const exists = (app, f) => fs.existsSync(path.join(app, f));

test('builds exports and the arcjs block for several manifests, one nested, with the top-level default', () => {
  const app = makeApp({ kibo: fullKibo() });
  const r = grunt(app);
  assert.equal(r.code, 0, r.out);
  const fj = read(app, 'assets/functions.json');
  fj.exports.sort((a, b) => a.id.localeCompare(b.id)); // glob order is not part of the contract
  assert.deepEqual(fj, {
    exports: [
      { id: 'cart.get.after', virtualPath: './dist/sub/commerce.carts.manifest.all.js', actionId: 'embedded.commerce.carts.get.after' },
      { id: 'http.storefront.pages.global.request.after', virtualPath: './dist/storefront.manifest.all.js', actionId: 'http.storefront.pages.global.request.after' },
      { id: 'platform.applications.onInstall', virtualPath: './dist/platform.applications.manifest.all.js', actionId: 'platform.applications.install' },
    ],
    arcjs: {
      contextReuse: 'warm',
      files: {
        './dist/sub/commerce.carts.manifest.all.js': { contextReuse: 'none' },
        './dist/platform.applications.manifest.all.js': { contextReuse: 'none' },
        './dist/storefront.manifest.all.js': { contextReuse: 'warm' },
      },
    },
  });
  assert.match(r.out, /export "contextReuse" is not an action definition/);
});

// Every failing setup: build must exit non-zero and leave the previous functions.json byte-identical,
// both with a normal stdout and with stdout redirected to a file.
const FAILURES = [
  ['kibo.json is missing', {}, /kibo\.json is missing/],
  ['kibo.json is not valid JSON', { kiboRaw: '{ nope' }, /not valid JSON/],
  ['kibo.json is a directory (cannot be read)', null, /cannot be read/],
  ['no top-level contextReuse', { kibo: { functions: fullKibo().functions } }, /missing top-level "contextReuse"/],
  ['invalid top-level contextReuse', { kibo: { ...fullKibo(), contextReuse: 'hot' } }, /top-level "contextReuse": invalid "hot"/],
  ['a bundle has no entry', { kibo: { contextReuse: 'none', functions: { [SF]: { contextReuse: 'warm' } } } }, /no entry for bundle assets\/src\/platform\.applications\.manifest\.js/],
  ['a mistyped key, with no wrong --kibo-init hint', { kibo: { ...fullKibo(), functions: { ...fullKibo().functions, 'assets/src/typo.manifest.js': { contextReuse: 'none' } } } }, /no such manifest in this build/],
  ['a manifest throws on require', { manifests: { ...MANIFESTS, [PA]: "throw new Error('boom');" }, kibo: fullKibo() }, /cannot load assets\/src\/platform\.applications\.manifest\.js: boom/],
  ['a mapping with several sources', { mapping: "{ 'assets/dist/all.js': ['assets/src/storefront.manifest.js', 'assets/src/platform.applications.manifest.js'] }", kibo: fullKibo() }, /has 2 sources/],
  ['two manifests compile to the same file', { mapping: "{ 'assets/dist/x.js': 'assets/src/storefront.manifest.js', 'assets/dist/X.js': 'assets/src/platform.applications.manifest.js' }", kibo: fullKibo() }, /give each manifest its own output file/],
  ['a mapping whose source file does not exist', { mapping: "{ 'assets/dist/x.js': 'assets/src/nope.manifest.js' }", kibo: fullKibo() }, /no source file found for assets\/dist\/x\.js/],
  ['output not under assets/', { mapping: "{ 'dist/x.js': 'assets/src/storefront.manifest.js' }", kibo: fullKibo() }, /not under assets\//],
  ['a manifest exports null', { manifests: { ...MANIFESTS, [PA]: 'module.exports = null;' }, kibo: fullKibo() }, /platform\.applications\.manifest\.js must export an object of actions/],
  ['an action without actionName', { manifests: { ...MANIFESTS, [PA]: "module.exports = { 'a.b': {} };" }, kibo: fullKibo() }, /export "a\.b" has no actionName/],
  ['two manifest targets', { extraTarget: ', other: { files: [] }', kibo: fullKibo() }, /configure one target/],
  ['output file is assets itself', { mapping: "{ 'assets': 'assets/src/storefront.manifest.js' }", kibo: fullKibo() }, /not under assets\//],
  ['a mapping without dest', { mapping: "[{ src: ['assets/src/storefront.manifest.js'] }]", kibo: fullKibo() }, /needs a dest under assets/],
  ['no manifest matches', { manifests: {}, kibo: fullKibo() }, /no manifest files matched/],
];
FAILURES.forEach(([name, opts, re]) => {
  [['normal stdout', grunt, false], ['stdout redirected to a file', gruntToFile, false], ['fatal that does not exit', grunt, true]].forEach(([mode, run, noExit]) => {
    test(`fails and leaves functions.json untouched: ${name} (${mode})`, () => {
      // noExit: grunt.fail.fatal only logs (what a file stdout does in effect), so any code after a missing `return` runs.
      const o = { ...(opts || {}) };
      if (noExit) { o.extraTasks = (o.extraTasks || '') + " grunt.fail.fatal = function (m) { grunt.log.error('Fatal error: ' + m); };"; }
      const app = makeApp(o);
      if (opts === null) { fs.mkdirSync(path.join(app, 'kibo.json')); }
      fs.mkdirSync(path.join(app, 'assets'), { recursive: true });
      fs.writeFileSync(path.join(app, 'assets/functions.json'), '{"previous":true}');
      const r = run(app);
      if (!noExit) { assert.notEqual(r.code, 0, r.out); }
      assert.match(r.out, re);
      assert.equal(fs.readFileSync(path.join(app, 'assets/functions.json'), 'utf8'), '{"previous":true}');
    });
  });
});

test('the --kibo-init hint is only shown when it can help', () => {
  const typo = makeApp({ kibo: { ...fullKibo(), functions: { ...fullKibo().functions, 'assets/src/typo.manifest.js': { contextReuse: 'none' } } } });
  assert.doesNotMatch(grunt(typo).out, /--kibo-init/);
  const missing = makeApp({ kibo: { contextReuse: 'none', functions: {} } });
  assert.match(grunt(missing).out, /--kibo-init/);
});

test('--kibo-init does not prompt when answering could not fix kibo.json (renamed key, functions not an object)', () => {
  const renamed = fullKibo();
  renamed.functions['./dist/storefront.manifest.all.js'] = renamed.functions[SF];
  delete renamed.functions[SF];
  [renamed, { contextReuse: 'none', functions: [] }].forEach((cfg) => {
    const app = makeApp({ kibo: cfg });
    const r = grunt(app, ['--kibo-init'], 'none\nnone\nnone\nnone\n');
    assert.notEqual(r.code, 0, r.out);
    assert.doesNotMatch(r.out, /\[warm\/none\]/); // no question was asked
    assert.doesNotMatch(r.out, /Run "grunt build --kibo-init"/);
  });
  assert.match(grunt(makeApp()).out, /Run "grunt build --kibo-init"/); // no kibo.json at all: init creates it
});

test('--kibo-init keeps unknown options of an entry it fills in, so the build still reports them', () => {
  const cfg = fullKibo();
  cfg.functions[SF] = { contextReuse: 'hot', note: 'keep me' };
  const app = makeApp({ kibo: cfg });
  const before = fs.readFileSync(path.join(app, 'kibo.json'), 'utf8');
  const r = grunt(app, ['--kibo-init'], 'warm\n');
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /unknown option "note"/);
  assert.equal(fs.readFileSync(path.join(app, 'kibo.json'), 'utf8'), before);
});

test('--kibo-init asks for missing values (re-asking invalid ones), and fails when input ends', () => {
  const app = makeApp();
  assert.notEqual(grunt(app, ['--kibo-init'], '').code, 0);
  assert.ok(!exists(app, 'kibo.json'));
  // top level blank -> none; then bundles in glob order: platform ("hot" is re-asked), storefront, nested carts
  const r = grunt(app, ['--kibo-init'], '\nhot\nnone\nwarm\nwarm\n');
  assert.equal(r.code, 0, r.out);
  assert.deepEqual(read(app, 'kibo.json'), { contextReuse: 'none', functions: { [CART]: { contextReuse: 'warm' }, [PA]: { contextReuse: 'none' }, [SF]: { contextReuse: 'warm' } } });
  assert.equal(read(app, 'assets/functions.json').arcjs.files['./dist/storefront.manifest.all.js'].contextReuse, 'warm');
});

test('--kibo-init refuses to overwrite a kibo.json that is not an object, or has non-object functions', () => {
  ['[1, 2]', '{"contextReuse":"none","functions":[]}'].forEach((raw) => {
    const app = makeApp({ kiboRaw: raw });
    const r = grunt(app, ['--kibo-init'], 'none\nnone\nnone\nnone\n');
    assert.notEqual(r.code, 0, r.out);
    assert.match(r.out, /fix it by hand/);
    assert.equal(fs.readFileSync(path.join(app, 'kibo.json'), 'utf8'), raw);
  });
});

test('a ./-prefixed source is the same key as without it', () => {
  const app = makeApp({ kibo: fullKibo(), mapping: "[{ src: ['./assets/src/storefront.manifest.js'], dest: 'assets/dist/s.all.js' }, { src: ['assets/src/platform.applications.manifest.js'], dest: 'assets/dist/p.all.js' }, { src: ['assets/src/sub/commerce.carts.manifest.js'], dest: 'assets/dist/c.all.js' }]" });
  const r = grunt(app);
  assert.equal(r.code, 0, r.out);
});

test('--kibo-init does not write kibo.json when it would still fail to build', () => {
  const bad = { contextReuse: 'none', functions: { 'assets/src/typo.manifest.js': { contextReuse: 'none' } } };
  const app = makeApp({ kibo: bad });
  const before = fs.readFileSync(path.join(app, 'kibo.json'), 'utf8');
  const r = grunt(app, ['--kibo-init'], 'none\nnone\nnone\n');
  assert.notEqual(r.code, 0);
  assert.equal(fs.readFileSync(path.join(app, 'kibo.json'), 'utf8'), before);
  assert.doesNotMatch(r.out, /\[warm\/none\]/); // not even asked
  assert.ok(!exists(app, 'assets/functions.json'));
});

test('warns when mozuconfig.nodeVersion is set, since the task does not write it', () => {
  const app = makeApp({ kibo: fullKibo(), extraConfig: 'mozuconfig: { nodeVersion: 24 },' });
  const r = grunt(app);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /mozuconfig\.nodeVersion is set/);
});

test("a project's own manifest task wins, and warns when kibo.json is present", () => {
  const app = makeApp({ localTask: true, kibo: fullKibo() });
  const r = grunt(app);
  assert.equal(r.code, 0, r.out);
  assert.ok(exists(app, 'local-ran'));
  assert.ok(!exists(app, 'assets/functions.json'));
  assert.match(r.out, /kibo\.json is ignored/);
  assert.doesNotMatch(grunt(makeApp({ localTask: true })).out, /kibo\.json is ignored/);
});

test('a second run in one process (grunt watch) sees edited manifests', () => {
  const app = makeApp({
    kibo: fullKibo(),
    extraTasks: `grunt.registerTask('edit', function () {
    grunt.file.write('assets/src/platform.applications.manifest.js', "module.exports = { 'platform.applications.onInstall': { actionName: 'platform.applications.install' }, 'second.run': { actionName: 'second.run.action' } };");
  });
  grunt.registerTask('twice', ['manifest', 'edit', 'manifest']);`,
  });
  const r = spawnSync(process.execPath, [gruntBin, 'twice', '--no-color', '--gruntfile', path.join(app, 'Gruntfile.js'), '--base', app], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(read(app, 'assets/functions.json').exports.some((e) => e.id === 'second.run'));
});
