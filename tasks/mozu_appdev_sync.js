/*
 * grunt-mozu-appdev-sync
 * 
 *
 * Copyright (c) 2015 James Zetlen, Volusion Inc.
 * Licensed under the MIT license.
 */

'use strict';

var path = require('path');
var fs = require('fs');
var when = require('when');
var SDK = require('mozu-node-sdk');
var humanize = require('humanize');

var MOZU_PATH_SEP = "|";

module.exports = function (grunt) {

  function line(len) {
    return grunt.util.linefeed + grunt.util.repeat(len, '-');
  }

  var actions = {
    upload: {
      run: function upsertFile(client, options, filepath) {
        return client.upsertPackageFile({
          applicationKey: options.applicationKey,
          lastModifiedTime: options.noclobber && fs.statSync(filepath).mtime.toISOString(),
          filepath: formatPath(filepath)
        }, {
          scope: 'DEVELOPER',
          body: grunt.file.read(filepath)
        });
      },
      presentTense: 'Upload',
      pastTense: 'Uploaded',
      columnHeaders: grunt.log.table([50,10,20], ['file','size','type']) + line(50+10+20),
      logline: function (r) {
        return grunt.log.table([50,10,20], [r.path, humanize.filesize(r.sizeInBytes), r.type]);
      }
    },
    "delete": {
      run: function deleteFile(client, options, filepath) {
        return client.deletePackageFile({
          applicationKey: options.applicationKey,
          filepath: formatPath(filepath)
        }, {
          scope: 'DEVELOPER'
        }).then(function(r) {
          return {
            path: filepath
          };
        })
      },
      presentTense: 'Delete',
      pastTense: 'Deleted',
      columnHeaders: grunt.log.table([50], ['file']) + line(50),
      logline: function (r) {
        return grunt.log.table([50], ["deleted " + r.path]);
      }
    },
    "rename": {
      run: function renameFile(client, options, filepath, destpath) {
        var config = {
          applicationKey: options.applicationKey,
          oldFullPath: formatPath(filepath),
          newFullPath: formatPath(destpath)
        };
        return client.renamePackageFile(config, {
          scope: 'DEVELOPER'
        }).then(function(r) {
          return {
            oldPath: formatPath(filepath,'/'),
            newPath: r.path
          }
        })
      },
      presentTense: 'Rename',
      pastTense: 'Renamed',
      columnHeaders: grunt.log.table([40,40], ['old path','new path']) + line(40+40),
      logline: function(r) {
        return grunt.log.table([40,40], [r.oldPath, r.newPath]);
      }
    }
  };

  function createAppDevClient(options) {
    var client = SDK.client(options.context).platform().application();
    if (process.env.USE_FIDDLER) {
      client.defaultRequestOptions = {
        proxy: 'http://127.0.0.1:8888',
        rejectUnauthorized: false
      };
    }
    return client;
  }

  function formatPath(pathstring, sep) {
    return path.join('assets',pathstring).split(path.sep).join(sep || MOZU_PATH_SEP);
  }

  function suffering(e) {
    grunt.fail.fatal(e.body || e);
  }

  function tableHead(action) {
    return action.presentTense + " progress:" + grunt.util.linefeed + grunt.util.linefeed + action.columnHeaders;
  }

  grunt.registerMultiTask('mozusync', 'Syncs a local project with the Mozu Developer Center.', function () {

    var done = this.async();

    var options = this.options({
      action: 'upload'
    });

    var client = createAppDevClient(options);

    var action = actions[options.action];

    if (!action) {
      grunt.fail.fatal("Unknown mozusync action " + options.action + ".\nSpecify a valid action in your task config options under the `action` property. \nValid actions are: " + grunt.log.wordlist(Object.keys(actions)));
    }

    grunt.log.subhead(tableHead(action));

    grunt.verbose.writeln('creating tasks for ' + this.files.length + " file mappings");

    var tasks = this.files.reduce(function(memo, file) {
      grunt.verbose.writeln(grunt.util.linefeed + 'running ' + options.action + ' on ' + file.src.join(', '));
      return memo.concat(file.src.map(function(src) {
        return action.run(client, options, src, file.dest).then(log);
      }));
    }, []);

    grunt.verbose.writeln('waiting on ' + tasks.length + ' tasks');

    when.all(tasks).then(joy, suffering);

    var total = {
      num: 0,
      size: 0
    };

    function log(r) {
      grunt.log.writeln(action.logline(r));
      total.num += 1;
      total.size += r.sizeInBytes;
      return r;
    }

    function backpat() {
      var selfcongratulation = action.pastTense + " " + total.num + " " + grunt.util.pluralize(total.num,'file/files');
      if (total.size) {
        selfcongratulation += " for a total of " + humanize.filesize(total.size);
      }
      grunt.log.write(grunt.util.linefeed).ok(selfcongratulation + " in application \"" + options.applicationKey + "\"")
    }

    function joy() {
      backpat();
      done();
    }

  });

};
