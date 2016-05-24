/*
 * grunt-mozu-appdev-sync
 *
 *
 * Copyright (c) 2015 James Zetlen, Volusion Inc.
 * Licensed under the MIT license.
 */

'use strict';

var humanize = require('humanize');
var groupBy = require('group-by');
var appDevUtils = require('mozu-appdev-utils');
var Multipass = require('mozu-multipass');
var prompt = require('prompt');
var currentPassword = null;

module.exports = function(grunt) {
    function PromptForPassword(client) {
        var proto = Multipass(client);
        var promptingPass = Object.create(proto);
        promptingPass.get = function(claimtype, context, callback) {
            return proto.get.call(this, claimtype, context, function(err, ticket) {
                if (claimtype === 'developer' && !ticket && !context.developerAccount.password) {
                    var passwordProps = {
                        required: true,
                        name: 'password',
                        hidden: true,
                        message: 'Developer Account Password'
                    };
                    if (currentPassword) {
                        context.developerAccount.password = currentPassword;
                    }
                    process.stdout.write('\u0007'); // ding!
                    prompt.get(passwordProps, function(err, result) {
                        context.developerAccount.password = currentPassword = result.password;
                        prompt.stop();
                        callback(err, null);
                    });
                }
                else {
                    callback(err, ticket);
                }
            });
        };
        client.authenticationStorage = promptingPass;
        return
    }
    ;

    var customErrors = {
        INVALID_CREDENTIALS: 'Invalid credentials. Please re-enter your username and password, and/or check your mozu.config.json file to see that you are using the right developer account ID and environment.'
    };

    function getCustomMessage(err) {
        if (!err) return "Unknown error! Please try again.";
        var errorCode = err.errorCode || err.originalError && err.originalError.errorCode;
        if (errorCode && customErrors[errorCode]) {
            return customErrors[errorCode];
        }
        return err.toString();
    }
    function line(len) {
        return grunt.util.linefeed + grunt.util.repeat(len, '-');
    }

    var actions = {
        upload: {
            run: function(util, options, context, progress) {
                return util.uploadFiles(options.uploadList, options, progress);
            },
            presentTense: 'Uploading',
            pastTense: 'Uploaded',
            columnHeaders: grunt.log.table([50, 10, 20], ['file', 'size', 'type']) + line(50 + 10 + 20),
            logline: function(r) {
                return grunt.log.table([50, 10, 20], [r.path, humanize.filesize(r.sizeInBytes), r.type]);
            },
            needsToRun: function(options, context) {
                return options.uploadList.length > 0;
            },
            soloOnly: false
        },
        "delete": {
            run: function(util, options, context, progress) {
                return util.deleteFiles(context.data.remove, options, progress);
            },
            presentTense: 'Deleting',
            pastTense: 'Deleted',
            columnHeaders: grunt.log.table([60], ['file']) + line(60),
            logline: function(r) {
                return grunt.log.table([60], ["deleted " + r.path]);
            },
            needsToRun: function(options, context) {
                return context.data.remove.length > 0;
            },
            soloOnly: true
        },
        "rename": {
            run: function(util, options, context, progress) {

                var filespecs = context.files.map(function(file) {
                    return {
                        oldFullPath: file.src[0],
                        newFullPath: file.dest
                    };
                });

                return util.renameFiles(filespecs, options, progress)
            },
            presentTense: 'Renaming',
            pastTense: 'Renamed',
            columnHeaders: grunt.log.table([40, 40], ['old path', 'new path']) + line(40 + 40),
            logline: function(r) {
                return grunt.log.table([40, 40], [r.oldPath, r.newPath]);
            },
            needsToRun: function(options, context) {
                return context.filesSrc.length > 0;
            },
            soloOnly: false
        },
        "deleteAll": {
            run: function(util, options, context, progress) {
                return util.deleteAllFiles(options, progress);
            },
            presentTense: 'Deleting all!',
            pastTense: 'Deleted',
            columnHeaders: grunt.log.table([60], ['file']) + line(60),
            logline: function(r) {
                return grunt.log.table([60], ["deleted " + r.path]);
            },
            needsToRun: function() {
                return true;
            },
            soloOnly: true
        }
    };

    var stigmata = 0;
    function predictSuffering(hubris) {
        return function suffering(err) {
            var errorCode = err.errorCode || err.originalError && err.originalError.errorCode;
            if (errorCode === "INVALID_CREDENTIALS" && stigmata < 3) {
                stigmata++;
                currentPassword = null;
            // invalidateKeychain().then(hubris).catch(woe);
            }
            else {
                woe(err);
            }
            function woe(err) {
                var errorCode = err.errorCode || err.originalError && err.originalError.errorCode;
                grunt.verbose.error(err)
                grunt.fail.warn(grunt.log.wraptext(67, getCustomMessage(err && err.body || err)));
            }
        }
    }

    function tableHead(action) {
        return action.presentTense + " progress:" + grunt.util.linefeed + grunt.util.linefeed + action.columnHeaders;
    }

    grunt.registerMultiTask('mozusync', 'Syncs a local project with the Mozu Developer Center.', function(user, password) {

        var self = this;

        var done = this.async();

        var events = [];

        var options = this.options({
            action: 'upload'
        });

        var plugins;
        var context = options.context;

        if (!options.noStoreAuth) {
            plugins = [PromptForPassword];
        }

        if (!options.applicationKey) {
            return done(new Error('The `mozusync` task requires an `applicationKey` config property containing the application key of the theme in order to sync.'));
        }

        if (!context) {
            return done(new Error('The `mozusync` task requires a `context` config property containing a full context for a Mozu Node SDK client in order to sync.'));
        }

        context.baseUrl = context.baseUrl || 'https://home.mozu.com';

        context.developerAccount = context.developerAccount || {};

        if (user && !password) {
            password = user;
            user = null;
        }

        if (user) {
            grunt.verbose.ok('Using developer account `' + user + '`, provided at command line.');
            context.developerAccount.emailAddress = user;
        }

        if (!options.context.developerAccount.emailAddress) {
            return done(new Error('The `mozusync` task requires a `context.developerAccount.emailAddress` property, either provided in mozu.config.json or at the command line as the first argument to the task, e.g. `grunt mozusync:upload:user@example.com:Password123`.'));
        }

        if (password) {
            grunt.verbose.ok('Password provided at command line.');
            context.developerAccount.password = password;
        }

        var appdev = appDevUtils(options.applicationKey, context, {
            plugins: plugins
        });

        var action = actions[options.action];

        if (!action) {
            return done(new Error("Unknown mozusync action " + options.action + ".\nSpecify a valid action in your task config options under the `action` property. \nValid actions are: " + grunt.log.wordlist(Object.keys(actions))));
        }

        var soloTaskName = 'mozusync:' + this.target;
        var lastArg = process.argv[process.argv.length - 1];
        if (
            (options.hasOwnProperty('soloOnly') ? options.soloOnly : action.soloOnly)
            &&
            lastArg !== soloTaskName
        ) {
            grunt.fail.warn(
                'The `' + soloTaskName + '` task is meant to be run only by itself, ' +
                'but it was run as part of the task `' + lastArg + '`. Use the config ' +
                '"soloOnly: false" to override.'
            );
        }

        // TODO: this should go into the upload action as a "preprocess"
        if (options.action === "upload") {
            options.uploadList = self.filesSrc.filter(function(src) {
                return grunt.file.exists(src) && !grunt.file.isDir(src);
            });
        }


        // add a single get call to initialize the credentials.
        // Paralallezing calls caused issues reading  from the console .
        var init = function() {
            return appdev.getMetadata(['./assets/functions.json']).then(function() {
                if (!appdev.client.context['user-claims']) {
                    grunt.fail.fatal('failed to authenticate to Mozu');
                    done();
                    return false;
                }
                return false;
            }).catch(
                function(err) {
                    grunt.fail.fatal('failed to authenticate to Mozu');
                    done();
                    return true;
                });
        }
        var tryAction = function() {
            return init().then(function() {
                return action.run(appdev, options, self, log);
            });
        }

        if (action.needsToRun(options, this)) {

            grunt.log.subhead(tableHead(action));

            tryAction().then(joy, predictSuffering(tryAction));

        }
        else {
            grunt.log.ok(action.presentTense + ' canceled; no qualifying files were found.');
            done();
        }

        function log(e) {
            if (e.phase === "before") {
                grunt.verbose.writeln(action.presentTense + " " + JSON.stringify(e));
            }
            else {
                grunt.log.writeln(action.logline(e.data));
            }
            events.push(e);
            return e;
        }

        function backpat() {

            var totals = groupBy(events, 'type');

            var selfcongratulation;

            var sizeSum;

            if (totals.completed) {
                selfcongratulation = action.pastTense + " " + totals.completed.length + " " + grunt.util.pluralize(totals.completed.length, 'file/files');
                sizeSum = totals.completed.reduce(function(sum, e) {
                    return sum + e.data.sizeInBytes;
                }, 0);
                if (sizeSum > 0) {
                    selfcongratulation += " for a total of " + humanize.filesize(sizeSum);
                }
                grunt.log.write(grunt.util.linefeed).oklns(selfcongratulation + " in application \"" + options.applicationKey + "\"")
            }

            delete totals.completed;

            ['omitted', 'rejected'].forEach(function(type) {
                if (totals[type] && totals[type].length > 0) {
                    var evts = groupBy(totals[type], 'reason');
                    Object.keys(evts).forEach(function(reason) {
                        crow(evts[reason], type, reason);
                    });
                }
            });

            function crow(occurrences, type, reason) {
                var str = [occurrences.length, grunt.util.pluralize(occurrences.length, 'file was/files were'), type].join(' ');
                if (reason)
                    str += " because " + reason;
                grunt.log.oklns(str);
            }
        }

        function notify() {
            grunt.event.emit('mozusync:' + options.action + ":complete");
        }

        function joy() {
            stigmata--;
            backpat();
            notify();
            done();
        }

    });

};
