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


module.exports = function (grunt) {

  var actions = {
    upsert: function upsertFile(client, options, filepath) {
      return client.upsertPackageFile({
        applicationKey: options.applicationKey,
        lastModifiedTime: options.noclobber && fs.statSync(filepath).mtime.toISOString(),
        filepath: formatPath(filepath)
      }, {
        scope: 'DEVELOPER',
        body: grunt.file.read(filepath)
      });
    }
  }

  function createAppDevClient(options) {
    var client = SDK.client().platform().applications(options.context);
    if (process.env.DEBUG) {
      client.defaultRequestOptions = {
        proxy: 'http://127.0.0.1:8888',
        rejectUnauthorized: false
      };
    }
    return client;
  }

  function formatPath(pathstring) {
    return path.join('assets',pathstring.split(path.sep).join('|'));
  }

  grunt.registerMultiTask('mozusync', 'Syncs a local project with the Mozu Developer Center.', function () {

    this.requiresConfig('applicationKey');

    var done = this.async();

    var options = this.options({
      action: 'upsert'
    });

    var client = createAppDevClient(options);

    when.all(this.filesSrc.map(function(filepath) {
      return actions[options.action](client, options, filepath);
    }).then(done, grunt.fail);

  });

};
