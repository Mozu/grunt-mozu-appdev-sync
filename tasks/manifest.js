/*
 * "manifest" task: compiles assets/functions.json (exports + the ArcJs "arcjs" block from kibo.json).
 * A project that registers its own "manifest" task (e.g. a legacy tasks/manifest.js) keeps it.
 */

'use strict';

var path = require('path');
var readline = require('readline');

var KIBO_JSON = 'kibo.json';
var REUSE_VALUES = ['warm', 'none'];

function normalizeReuse(v) {
    if (typeof v !== 'string') { return null; }
    v = v.trim().toLowerCase();
    return REUSE_VALUES.indexOf(v) === -1 ? null : v;
}

function isObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

function own(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
}

function stripDot(p) {
    return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

// Same cleaning the engine applies before comparing a functions.json file key with a bundle path
// (CustomFunction.Clearn): drop "assets", drop every non-alphanumeric, compare case-insensitively.
function engineKey(p) {
    return p.replace(/assets/g, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

// "./dist/x.all.js" whatever the OS separator: grunt hands back "/" but path.relative uses "\\" on Windows.
function toVirtualPath(rel) {
    return './' + rel.replace(/\\/g, '/');
}

// Pure: validates kibo.json against the bundles of this build and returns the
// functions.json "arcjs" block, or every problem found (never a partial block).
// bundles: [{ src: 'assets/src/x.manifest.js', virtualPath: './dist/x.manifest.all.js' }]
function resolveArcjs(config, bundles) {
    var errors = [];
    if (!isObject(config)) {
        return { errors: [KIBO_JSON + ' is missing or is not a JSON object'], arcjs: null };
    }
    var top = normalizeReuse(config.contextReuse);
    if (config.contextReuse === undefined) {
        errors.push('missing top-level "contextReuse" (use "warm" or "none")');
    } else if (!top) {
        errors.push('top-level "contextReuse": invalid ' + JSON.stringify(config.contextReuse) + ' (use "warm" or "none")');
    }
    var fns = config.functions === undefined ? {} : config.functions;
    if (!isObject(fns)) {
        errors.push('"functions" must be an object keyed by manifest path');
        fns = {};
    }
    var files = Object.create(null);
    var bySrc = Object.create(null);
    bundles.forEach(function (b) {
        bySrc[b.src] = b;
        var entry = own(fns, b.src) ? fns[b.src] : undefined;
        var label = 'functions["' + b.src + '"]';
        if (entry === undefined) {
            errors.push('no entry for bundle ' + b.src + ' (add ' + label + ': { "contextReuse": "warm" | "none" })');
            return;
        }
        if (!isObject(entry)) {
            errors.push(label + ' must be an object like { "contextReuse": "none" }');
            return;
        }
        Object.keys(entry).forEach(function (k) {
            if (k !== 'contextReuse') { errors.push(label + ': unknown option "' + k + '"'); }
        });
        var v = normalizeReuse(entry.contextReuse);
        if (!v) {
            errors.push(label + '.contextReuse: invalid ' + JSON.stringify(entry.contextReuse) + ' (use "warm" or "none")');
        } else {
            files[b.virtualPath] = { contextReuse: v };
        }
    });
    Object.keys(fns).forEach(function (k) {
        if (bySrc[k]) { return; }
        var msg = 'functions["' + k + '"]: no such manifest in this build';
        var match = bundles.filter(function (b) { return stripDot(b.virtualPath) === stripDot(k); })[0];
        if (match) { msg += ' (key by the source manifest: "' + match.src + '")'; }
        errors.push(msg + '. Valid keys: ' + bundles.map(function (b) { return b.src; }).join(', '));
    });
    return { errors: errors, arcjs: errors.length ? null : { contextReuse: top, files: Object.assign({}, files) } };
}

// Two bundles the engine cannot tell apart would share one entry there, so one could run with the other's setting.
// Returns error strings (about the build's file mapping, not about kibo.json).
function findCollisions(bundles) {
    var seen = Object.create(null);
    var errors = [];
    bundles.forEach(function (b) {
        var ek = engineKey(b.virtualPath);
        if (seen[ek]) {
            errors.push(seen[ek] + ' and ' + b.src + ' compile to ' + b.virtualPath + ' (or a path the engine treats as the same); give each manifest its own output file');
        }
        seen[ek] = b.src;
    });
    return errors;
}

// Entries --kibo-init must ask about: a missing/invalid top-level value, then each bundle without a valid entry.
function missingAnswers(config, bundles) {
    var asks = [];
    if (!normalizeReuse(config.contextReuse)) { asks.push(null); }
    var fns = isObject(config.functions) ? config.functions : {};
    bundles.forEach(function (b) {
        var e = own(fns, b.src) ? fns[b.src] : undefined;
        if ((!isObject(e) || !normalizeReuse(e.contextReuse)) && asks.indexOf(b.src) === -1) { asks.push(b.src); }
    });
    return asks;
}

// config plus the answers --kibo-init collected ('' is the top-level default). Existing entry options are kept.
function applyAnswers(base, answers) {
    var merged = JSON.parse(JSON.stringify(base));
    if (answers[''] !== undefined) { merged.contextReuse = answers['']; }
    merged.functions = isObject(merged.functions) ? merged.functions : {};
    Object.keys(answers).forEach(function (src) {
        if (!src) { return; }
        var old = own(merged.functions, src) && isObject(merged.functions[src]) ? merged.functions[src] : {};
        merged.functions[src] = Object.assign({}, old, { contextReuse: answers[src] });
    });
    return merged;
}

// True when asking the --kibo-init questions would produce a kibo.json that builds. config: parsed file or null.
function canInitFix(config, bundles) {
    if (config !== null && !isObject(config)) { return false; }
    if (config && config.functions !== undefined && !isObject(config.functions)) { return false; }
    var base = config || {};
    var asks = missingAnswers(base, bundles);
    if (!asks.length) { return false; }
    var answers = {};
    asks.forEach(function (a) { answers[a === null ? '' : a] = 'none'; });
    return resolveArcjs(applyAnswers(base, answers), bundles).errors.length === 0;
}

function askAll(asks, done) {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    var answers = {};
    var finished = false;
    rl.on('close', function () {
        if (!finished) { finished = true; done(new Error('input ended before all questions were answered')); }
    });
    console.log('Choose "warm" only for bundles that passed the ArcJs shared-context audit; "none" otherwise.');
    (function next(i) {
        if (i === asks.length) { finished = true; rl.close(); return done(null, answers); }
        var what = asks[i] === null ? 'Default contextReuse (top level)' : 'contextReuse for ' + asks[i];
        rl.question(what + ' [warm/none] (none): ', function (a) {
            var v = a.trim() === '' ? 'none' : normalizeReuse(a);
            if (!v) { console.log('  please answer "warm" or "none"'); return next(i); }
            answers[asks[i] === null ? '' : asks[i]] = v;
            next(i + 1);
        });
    })(0);
}

module.exports = function (grunt) {
    // Gruntfiles load ./tasks before load-grunt-tasks, and registerTask silently replaces: never shadow the project's task.
    if (grunt.task.exists('manifest')) {
        if (grunt.file.exists(KIBO_JSON)) {
            grunt.log.warn(KIBO_JSON + ' is ignored: this project registers its own "manifest" task, so functions.json gets no arcjs block. ' +
                'Delete tasks/manifest.js to use the grunt-mozu-appdev-sync task.');
        }
        return;
    }
    grunt.registerMultiTask('manifest', 'Compiles the `functions.json` manifest for the Kibo Api Extension Framework to read which custom functions are extended.', function () {
        // Every failure below is `return fail(...)`: grunt.fail.fatal does not stop the code when stdout is a file
        // (the exit module waits for the stream to drain), so a failed build must also not carry on to the write.
        function fail(msg) { grunt.fail.fatal(msg); }

        var targets = Object.keys(grunt.config('manifest') || {}).filter(function (k) { return k !== 'options'; });
        if (targets.length > 1) {
            return fail('manifest: configure one target (found ' + targets.join(', ') + '); kibo.json covers every bundle of the build and each target would reject the other\'s bundles.');
        }
        if (!this.files.length) {
            return fail('manifest: no manifest files matched the task config, so there is nothing to write.');
        }
        var noDest = this.files.filter(function (conf) { return typeof conf.dest !== 'string'; })[0];
        if (noDest) {
            return fail('manifest: each mapping needs a dest under assets/ (found none for ' + noDest.src.join(', ') + ').');
        }
        var bad = this.files.filter(function (conf) { return conf.src.length !== 1; })[0];
        if (bad) {
            return fail(bad.src.length === 0
                ? 'manifest: no source file found for ' + bad.dest + ' (check the path or glob).'
                : 'manifest: each mapping must compile one manifest to one file; ' + bad.dest + ' has ' + bad.src.length + ' sources.');
        }
        var outside = this.files.filter(function (conf) {
            var rel = path.relative('assets', conf.dest);
            return rel === '' || rel.split(/[\\/]/)[0] === '..' || path.isAbsolute(rel);
        })[0];
        if (outside) {
            return fail('manifest: ' + outside.dest + ' is not under assets/, so it cannot be a functions.json virtualPath.');
        }

        var done = this.async();
        var bundles = this.files.map(function (conf) {
            return {
                conf: conf,
                src: stripDot(conf.src[0]),
                virtualPath: toVirtualPath(path.relative('assets', conf.dest))
            };
        });

        var collisions = findCollisions(bundles);
        if (collisions.length) {
            collisions.forEach(function (e) { grunt.log.error('manifest: ' + e); });
            return fail('manifest: two manifests compile to output files the engine treats as one; fix the dest mapping in the Gruntfile.');
        }

        var manifest = [];
        for (var i = 0; i < bundles.length; i++) {
            var b = bundles[i];
            var file = path.resolve(b.conf.src[0]); // from the project (grunt's cwd), not from this file inside node_modules
            var index;
            try {
                delete require.cache[require.resolve(file)]; // grunt watch re-runs in one process
                index = require(file);
            } catch (e) {
                return fail('manifest: cannot load ' + b.src + ': ' + e.message);
            }
            if (!isObject(index)) {
                return fail('manifest: ' + b.src + ' must export an object of actions.');
            }
            var badAction = null;
            Object.keys(index).forEach(function (key) {
                if (!isObject(index[key])) {
                    grunt.log.warn('manifest: ' + b.src + ' export "' + key + '" is not an action definition; skipped.');
                    return;
                }
                if (typeof index[key].actionName !== 'string' || !index[key].actionName) { badAction = badAction || key; }
                manifest.push({ id: key, virtualPath: b.virtualPath, actionId: index[key].actionName });
            });
            if (badAction) {
                return fail('manifest: ' + b.src + ' export "' + badAction + '" has no actionName.');
            }
        }

        if (grunt.config('mozuconfig.nodeVersion') !== undefined) {
            grunt.log.warn('manifest: mozuconfig.nodeVersion is set but this task does not write nodeVersion to functions.json.');
        }

        var config = null;
        if (grunt.file.exists(KIBO_JSON)) {
            var text;
            try {
                text = grunt.file.read(KIBO_JSON);
            } catch (e) {
                return fail(KIBO_JSON + ' cannot be read: ' + e.message);
            }
            try {
                config = JSON.parse(text.replace(/^﻿/, ''));
            } catch (e) {
                return fail(KIBO_JSON + ' is not valid JSON: ' + e.message);
            }
        }

        // Validates, then writes functions.json only when there is no error.
        function finish(cfg) {
            var result = resolveArcjs(cfg, bundles);
            if (result.errors.length) {
                result.errors.forEach(function (e) { grunt.log.error('kibo.json: ' + e); });
                var fixable = canInitFix(cfg, bundles);
                return fail(KIBO_JSON + ' must declare a top-level "contextReuse" and an entry for every bundle. ' +
                    (fixable ? 'Run "grunt build --kibo-init" to be asked for the missing values.' : 'Fix the entries listed above.'));
            }
            grunt.file.write('./assets/functions.json', JSON.stringify({ exports: manifest, arcjs: result.arcjs }, null, 2));
            grunt.log.ok('Wrote ' + manifest.length + ' custom functions to functions.json');
            grunt.log.ok('arcjs: default contextReuse ' + result.arcjs.contextReuse);
            bundles.forEach(function (b) {
                grunt.log.ok('arcjs: ' + b.src + ' -> ' + result.arcjs.files[b.virtualPath].contextReuse);
            });
            done();
        }

        if (!grunt.option('kibo-init')) { return finish(config); }

        if (config !== null && !isObject(config)) {
            return fail(KIBO_JSON + ' is not a JSON object; fix it by hand (--kibo-init will not overwrite it).');
        }
        if (config && config.functions !== undefined && !isObject(config.functions)) {
            return fail(KIBO_JSON + ' "functions" is not an object; fix it by hand (--kibo-init will not overwrite it).');
        }
        var base = config || {};
        var asks = missingAnswers(base, bundles);
        // Nothing to ask, or answering cannot make it build (mistyped key etc.): report the errors without prompting.
        if (!asks.length || !canInitFix(config, bundles)) { return finish(config); }
        askAll(asks, function (err, answers) {
            if (err) { return fail('kibo-init: ' + err.message); }
            var merged = applyAnswers(base, answers);
            // Only save what builds: a config that still fails (e.g. a mistyped key) is left for the author to fix.
            // canInitFix said these answers make it build; if not, never save a file that fails.
            if (resolveArcjs(merged, bundles).errors.length) { return finish(merged); }
            grunt.file.write(KIBO_JSON, JSON.stringify(merged, null, 2) + '\n');
            grunt.log.ok('Updated ' + KIBO_JSON);
            finish(merged);
        });
    });
};

module.exports.resolveArcjs = resolveArcjs;
module.exports.missingAnswers = missingAnswers;
module.exports.toVirtualPath = toVirtualPath;
module.exports.engineKey = engineKey;
module.exports.findCollisions = findCollisions;
module.exports.canInitFix = canInitFix;
