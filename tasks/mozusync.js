/*
 * grunt-mozu-appdev-sync
 * 
 *
 * Copyright (c) 2015 James Zetlen, Volusion Inc.
 * Licensed under the MIT license.
 */

'use strict';

var humanize = require('humanize');
var groupBy = require('lodash.groupby');
var appDevUtils = require('mozu-appdev-utils');
var Multipass = require('mozu-multipass');
var inquirer = require('inquirer');
var chalk = require('chalk');
var watchAdapter = require('../watch-adapter');

function PromptingPass(client) {
  var proto = Multipass(client);
  var o = Object.create(proto);
  o.get = function(claimtype, context, callback) {
    return proto.get.call(this, claimtype, context, function(err, ticket) {
      if (claimtype === "developer" && !ticket && !context.developerAccount.password) {
        process.stdout.write('\u0007\n'); // ding!
        inquirer.prompt([{
          type: 'password',
          name: 'password',
          message: chalk.bold.red('Developer password for ' + context.developerAccount.emailAddress + ':'),
          validate: function(str) {
            return !!str;
          }
        }], function(answers) {
          context.developerAccount.password = answers.password;
          callback(null, null);
        });
      } else {
        callback(null, ticket);
      }
    });
  };
  return client.authenticationStorage = o;
};

var customErrors = {
  INVALID_CREDENTIALS: 'Invalid credentials. Please check your mozu.config.json file to see that you are using the right developer account, application key, shared secret, and environment.'
};

function getCustomMessage(err) {
  if (!err) return "Unknown error! Please try again.";
  var errorCode = err.errorCode || err.originalError && err.originalError.errorCode;
  if (errorCode && customErrors[errorCode]) {
    return customErrors[errorCode];
  }
  return err.toString();
}

module.exports = function (grunt) {

  function line(len) {
    return grunt.util.linefeed + grunt.util.repeat(len, '-');
  }

  var actions = {
    upload: {
      run: function(util, options, context, progress) {
        return util.uploadFiles(context.filesSrc, options, progress);
      },
      presentTense: 'Uploading',
      pastTense: 'Uploaded',
      columnHeaders: grunt.log.table([50,10,20], ['file','size','type']) + line(50+10+20),
      logline: function (r) {
        return grunt.log.table([50,10,20], [r.path, humanize.filesize(r.sizeInBytes), r.type]);
      },
      needsToRun: function(options, context) {
        return context.filesSrc.length > 0;
      }
    },
    "delete": {
      run: function(util, options, context, progress) {
        return util.deleteFiles(context.data.remove, options, progress);
      },
      presentTense: 'Deleting',
      pastTense: 'Deleted',
      columnHeaders: grunt.log.table([60], ['file']) + line(60),
      logline: function (r) {
        return grunt.log.table([60], ["deleted " + r.path]);
      },
      needsToRun: function(options, context) {
        return context.data.remove.length > 0;
      }
    },
    "rename": {
      run: function(util, options, context, progress) {

        var filespecs = context.files.map(function(file){
          return {
            oldFullPath: file.src[0],
            newFullPath: file.dest
          };
        });

        return util.renameFiles(filespecs, options, progress)
      },
      presentTense: 'Renaming',
      pastTense: 'Renamed',
      columnHeaders: grunt.log.table([40,40], ['old path','new path']) + line(40+40),
      logline: function(r) {
        return grunt.log.table([40,40], [r.oldPath, r.newPath]);
      },
      needsToRun: function(options, context) {
        return context.filesSrc.length > 0;
      }
    },
    "deleteAll": {
      run: function(util, options, context, progress) {
        return util.deleteAllFiles(options, progress);
      },
      presentTense: 'Deleting all!',
      pastTense: 'Deleted',
      columnHeaders: grunt.log.table([60], ['file']) + line(60),
      logline: function (r) {
        return grunt.log.table([60], ["deleted " + r.path]);
      },
      needsToRun: function() {
        return true;
      }
    }
  };

  function suffering(e) {
    grunt.fail.warn(grunt.log.wraptext(67, getCustomMessage(e && e.body || e)));
  }

  function tableHead(action) {
    return action.presentTense + " progress:" + grunt.util.linefeed + grunt.util.linefeed + action.columnHeaders;
  }

  var watchesComplete = false;

  grunt.registerMultiTask('mozusync', 'Syncs a local project with the Mozu Developer Center.', function (user, password) {

    var done = this.async();

    var events = [];

    var options = this.options({
      action: 'upload'
    });

    if (options.watchAdapters && !watchesComplete) {
      options.watchAdapters.forEach(function(config) {
        watchAdapter(grunt, config);
      });
      watchesComplete = true;
    }

    var plugins;
    var context = options.context;

    if (!options.noStoreAuth) {
      plugins = [PromptingPass];
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

    if (!options.context.developerAccount.emailAddress)  {
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

    if (action.needsToRun(options, this)) {
      
      grunt.log.subhead(tableHead(action));
      action.run(appdev, options, this, log).then(joy, suffering);

    } else {
      grunt.log.ok(action.presentTense + ' canceled; no qualifying files were found.');
      done();
    }

    function log(e) {
      if (e.phase === "before") {
        grunt.verbose.writeln(action.presentTense + " " + JSON.stringify(e));
      } else {
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
        selfcongratulation = action.pastTense + " " + totals.completed.length + " " + grunt.util.pluralize(totals.completed.length,'file/files');
        sizeSum = totals.completed.reduce(function(sum, e) {
          return sum + e.data.sizeInBytes;
        }, 0);
        if (sizeSum > 0) {
          selfcongratulation += " for a total of " + humanize.filesize(sizeSum);
        }
        grunt.log.write(grunt.util.linefeed).oklns(selfcongratulation + " in application \"" + options.applicationKey + "\"")
      }

      delete totals.completed;

      ['omitted','rejected'].forEach(function(type) {
        if (totals[type] && totals[type].length > 0) {
          var evts = groupBy(totals[type], 'reason');
          Object.keys(evts).forEach(function(reason) {
            crow(evts[reason], type, reason);
          });
        }
      });

      function crow(occurrences, type, reason) {
        var str = [occurrences.length,grunt.util.pluralize(occurrences.length,'file was/files were'),type].join(' ');
        if (reason) str += " because " + reason;
        grunt.log.oklns(str);
      }
    }

    function notify() {
      grunt.event.emit('mozusync:' + options.action + ":complete");
    }

    function joy() {
      backpat();
      notify();
      done();
    }

  });

};
