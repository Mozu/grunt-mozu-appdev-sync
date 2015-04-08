# grunt-mozu-appdev-sync

Syncs a local project with the Mozu Developer Center.

## This package is currently a prerelease.
**This contains pre-release code. It may have behaviors or rely on features that don't work in Mozu production environments. Use with caution!**

## Getting Started
This plugin requires Grunt.

If you haven't used [Grunt](http://gruntjs.com/) before, be sure to check out the [Getting Started](http://gruntjs.com/getting-started) guide, as it explains how to create a [Gruntfile](http://gruntjs.com/sample-gruntfile) as well as install and use Grunt plugins. Once you're familiar with that process, you may install this plugin with this command:

```shell
npm install grunt-mozu-appdev-sync --save-dev
```

Once the plugin has been installed, it may be enabled inside your Gruntfile with this line of JavaScript:

```js
grunt.loadNpmTasks('grunt-mozu-appdev-sync');
```

## The "mozusync" task

### Overview
In your project's Gruntfile, add a section named `mozusync` to the data object passed into `grunt.initConfig()`.

```js
grunt.initConfig({
  mozusync: {
    options: {
      // Task-specific options go here.
      applicationKey: 'namespace-applicationname-version-release',
      context: require('./mozu.config.json')
      noclobber: true
    },
    all: {
      // Target-specific file lists and/or options go here.
      src: ['./assets/dist/**/*']
    },
    del: {
      // If you're using the grunt-contrib-watch adapter,
      // a separate task for deletion is usually necessary.
      // The delete task does not use the `files` array.
      options: {
        action: 'delete'
      },
      src: ['./assets/dist/**/*'],
      remove: []
    }
  },
})
```

### Configuration

#### options.applicationKey
Type: `String`
**Required**

The application key of the application, theme, or extension you are working on in Developer Center.

#### options.noStoreAuth
Type: `Boolean`
Default value: `false`

The task will normally prompt you for your password and then store authentication tokens in your home directory using Multipass. It never stores passwords in plaintext. However, if you want to manage your authentication manually instead, you can remove this behavior by setting `noStoreAuth` to `true`.

#### options.action
Type: `String`
Default value: `'upload'`

A string value describing the type of sync action to take. The default is `'upload'`, which both creates and updates files.
The full set of options is:

 - `'upload'` -- create and/or update files in Developer Center
 - `'delete'` -- delete files in Developer Center
 - `'deleteAll'` -- delete all files in Developer Center
 - `'rename'` -- rename files in Developer Center

The different actions use slightly different configuration, so you can think of them as different tasks, though they will share common options.

#### files
Use normal Grunt file specification formats, including globbing.

For the `upload` action, only a `src` is necessary. The `dest` doesn't make sense, since the file destination is Developer Center.

For the `delete` action, **the files collection won't work**. Grunt automatically filters the runtime files array for files that exist. The delete action is often run in the context of a file watch, so by the time the action runs, the relevant files don't exist anymore! For this reason, the `delete` action looks for an array of strings representing filenames under the property `remove`.

For the `rename` action, populate a `files` object with `src`/`dest` mappings of each file you want to rename. **You will probably not configure this manually in your Gruntfile. You'll want to configure a `grunt-contrib-watch` adapter to do it dynamically.**

For the `deleteAll` action, the `files` object is irrelevant. They're all doomed.

#### options.context
Type: 'Object'
**Required**

A context object to use to create a [Mozu Node SDK](https://github.com/mozu/mozu-node-sdk) client. It must contain an application key (different from the working key, this key is connected to your developer sync app that you have created and installed), a shared secret, a developer account ID, developer account login credentials, and a URL indicating the Mozu "home pod" environment to connect to.

#### options.noclobber
Type: `Boolean`
Default value: `false`

This option applies to the `upload` action. If this is set to `true`, then the uploads will include a last modified date from your local file system. If you attempt to upload a file that is older than the one in Developer Center, the upload will fail. If it is set to `false`, then all uploads will override regardless of modified date.

#### options.ignoreChecksum
Type: `Boolean`
Default value: `false`

This option applies to the `upload` action. By default, this action will use checksums to determine if the local file and the remote file are identical, and will skip the upload if they are. Set this to true to override this behavior.

### The `grunt-contrib-watch` adapter

The [grunt-contrib-watch](https://github.com/gruntjs/grunt-contrib-watch) is useful for filesystem watching and synchronizing on save. One common problem is that the watch task can only run other tasks, and other tasks are not aware of which files changed, so by default they will run on all files.

This package includes an adapter function that can connect a task to the `grunt-contrib-watch` events and build file targets dynamically. If you are using `grunt-contrib-watch`, then you can add this to your Gruntfile:

```js
var watchAdapter = require('grunt-mozu-appdev-sync/watch-adapter');

watchAdapter(grunt, {
  src: 'mozusync.upload.src',
  action: 'upload'
});
```

The watch adapter takes two arguments. The first must be the `grunt` instance passed into your Gruntfile. The second must be an object with a `src` property representing the object in the Grunt config to change, and an `action` property representing the type of action this task will take. Optionally, the second config argument may take an `always` property, consisting of an array of paths that should always stay in the `src`, whether they have triggered a change event or not.

Once you run this function, your Gruntfile is listening for `watch` events and updating its files config dynamically.

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Lint and test your code using [Grunt](http://gruntjs.com/).

## License
Copyright (c) Volusion Inc.. Licensed under the MIT license.
