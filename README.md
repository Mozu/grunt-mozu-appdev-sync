# grunt-mozu-appdev-sync

Syncs a local project with the Mozu Developer Center.

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
      applicationKey: 'namespace.applicationname.1.0.0.Release',
      context: {
        developerAccount: {
          emailAddress: 'user@example.com'
        },
        developerAccountId: 2
      },
      noclobber: true
    },
    upload: {
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

### A Common Way To Do It

The above depicted configuration is nice and simple, but it does hardcode specific Mozu environment information into the Gruntfile. You may be moving your project work from theme to theme in your Mozu account, or sharing your work with other developers. It's best to keep your Mozu environment information separate from the Gruntfile itself.

If you used the [Mozu Yeoman theme generator][1] to scaffold your theme project folder, or you are familiar with the Mozu Node SDK, you know that it likes to store credentials in a file called `mozu.config.json`. You can maintain this file, and then hook it up to the Grunt task, using the following pattern, which takes advantage of Grunt's template interpolation:

```js
grunt.initConfig({

  mozuconfig: require('./mozu.config.json'),

  mozusync: {
    options: {
      applicationKey: '<%= mozuconfig.workingApplicationKey %>',
      context: '<%= mozuconfig %>',
      noclobber: true
    },
    // individual mozusync task config below
  }

});
```

The [Yeoman theme generator][1] will put this in a Gruntfile for you, either by creating a new one or modifying your existing one.

**You can also install the [Mozu App generator][2] and use it to create a `mozu.config.json` file.**

To install the generator, run
```sh
npm install -g generator-mozu-app
```

And then, in any directory, you can create or modify your `mozu.config.json` environment file by running:
```sh
yo mozu-app --config
```

### Configuration

#### options.applicationKey
Type: `String`
**Required**

The application key of the application, theme, or extension you are working on in Developer Center.

#### options.context
Type: `Object`
**Required**

A context object to use to create a [Mozu Node SDK](https://github.com/mozu/mozu-node-sdk) client. It should include:
 - `developerAccountId`: a developer account ID. You can see your developer account ID in the Mozu Launchpad when you select which Dev Center to login to. This is required.
 - `developerAccount`: an object representing your user login. Unless you are supplying this information at the command line as described below, this is required. It should be an object with an `emailAddress` property containing your user email, as shown above. You can also supply a `password` here to avoid being prompted, but be careful not to put a plaintext password in your Gruntfile. You could, for instance, use `process.env` to assign the value of an environment variable.
 - `baseUrl`: a URL representing the Mozu environment. Unless you have special access to an internal preproduction Mozu environment, you don't need to provide this.

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

#### options.soloOnly
Type: `Boolean`
Default value: `false` for the `upload` and `rename` actions, `true` for the `delete` and `deleteAll` actions

Some actions are destructive, such as `delete` and `deleteAll`, so this options serves as a safety measure: the task will only run if it was called directly from the command line, as in `grunt mozusync:del`, instead of as part of a grouped task, such as `grunt` or `grunt build`.

#### options.noclobber
Type: `Boolean`
Default value: `false`

This option applies to the `upload` action. If this is set to `true`, then the uploads will include a last modified date from your local file system. If you attempt to upload a file that is older than the one in Developer Center, the upload will fail. If it is set to `false`, then all uploads will override regardless of modified date.

#### options.ignoreChecksum
Type: `Boolean`
Default value: `false`

This option applies to the `upload` action. By default, this action will use checksums to determine if the local file and the remote file are identical, and will skip the upload if they are. Set this to true to override this behavior.

### Authentication with command line arguments

By default, the task will pause Grunt execution and prompt the user to input a password in the terminal. If Grunt is running on a continuous integration server and/or you are using this task in an automated deployment, it would be more appropriate to supply a password as part of the scripted environment. **You can provide username and password information as command-line arguments to Grunt instead.**

Assuming that you have configured a `mozusync` task target called `upload`, as in the example above, you can supply the username and password like this:
```sh
grunt mozusync:upload:user@example.com:my_password_123
```

Or, you can set the `developerAccount.emailAddress` in `mozu.config.json` and supply only the password:
```sh
grunt mozusync:upload:my_password_123
```

Note that you must run the `mozusync` task separately to use command-line authentication; you cannot run it as part of an aggregate task or default build, to avoid exposing password information to untrusted code. If `mozusync` is part of your default task, just configure a separate aggregate task that doesn't include `mozusync`, and configure your CI server to run that task, before running `grunt mozusync` separately with the provided authentication.

### Using with `grunt-contrib-watch` and other watch plugins

The [grunt-contrib-watch](https://github.com/gruntjs/grunt-contrib-watch) is useful for filesystem watching and synchronizing on save. One common problem is that the watch task can only run other tasks, and other tasks are not aware of which files changed, so by default they will run on all files. The task already checks with the Mozu App Dev APIs and compares file checksums to avoid unnecessary uploads, but the act of checking this for every file in your theme is itself slow.

Earlier versions of this plugin had "watch adapters", meant to hook directly in to `grunt-contrib-watch`. This had a number of disadvantages, so it has been removed. The new recommendation is to use the [`grunt-newer`](https://github.com/tschaub/grunt-newer) plugin in conjunction with `grunt-contrib-watch` and `grunt-mozu-appdev-sync`, which will optimize your workflow by only uploading necessary files.

An example optimal workflow:
```js
    watch: {
      javascript: {
        files: [
          'scripts/**/*.js'
        ],
        tasks: [
          'newer:jshint:develop',
          'mozutheme:quickcompile',
          'newer:mozusync:upload'
        ]
      },
      sync: {
        files: [
          'admin/**/*',
          'labels/**/*',
          'resources/**/*',
          'packageconfig.xml',
          'scripts/**/*',
          'stylesheets/**/*',
          'templates/**/*',
          'theme.json',
          '*thumb.png',
          '*thumb.jpg',
          'theme-ui.json',
          '!*.orig',
          '!.inherited'
        ],
        tasks: [
          'newer:mozusync:upload'
        ]
      }
    },
```

## The "manifest" task (Arc.js apps)

Builds `assets/functions.json` for an Arc.js (API Extension) app. It writes:
- `exports`: one entry per action in each `assets/src/**/*.manifest.js`;
- `arcjs`: whether each compiled bundle may reuse a warm context across requests, read from `kibo.json`.

```js
manifest: { all: { files: '<%= browserify.all.files %>' } }  // same file mapping as browserify
```

### `kibo.json` (required)

`kibo.json` sits at the project root, next to `Gruntfile.js`, and is committed. It is not under `assets/`, so `mozusync` never uploads it.

```json
{
  "contextReuse": "none",
  "functions": {
    "assets/src/storefront.manifest.js": { "contextReuse": "warm" },
    "assets/src/platform.applications.manifest.js": { "contextReuse": "none" }
  }
}
```

- **Required:** a top-level `contextReuse`, plus an entry for **every** manifest in the build, keyed by its path from the project root. Values are `"warm"` or `"none"`.
- **`warm` takes effect once uploaded.** Use it only for bundles that passed the Arc.js shared-context audit. The task writes no `attestation`, so `warm` is not pinned to the bundle's bytes: a rebuilt bundle keeps being reused until you re-audit it. An engine running in hardened mode only pools bundles that carry an attestation, so it ignores `warm` from `kibo.json`.
- **One mapping per manifest.** The task needs one source per output file, one `manifest` target, and output paths the engine can tell apart (it compares them after removing `assets` and every non-alphanumeric character). Otherwise it fails.
- **The build fails when `kibo.json` is wrong.** The task stops with `grunt.fail.fatal` and leaves `functions.json` untouched when `kibo.json`:
  - is missing or isn't valid JSON;
  - has no top-level value;
  - has no entry for a manifest, or has an invalid value;
  - has an unknown option, or a key that matches no manifest.
- **`grunt build --kibo-init`** asks for any missing values and writes `kibo.json`. An empty answer means `none`. With no input, as in CI, it fails.
- **`functions.json` is the build's output.** Never edit it by hand. An `arcjs` block, `attestation` or `nodeVersion` written there by other means is replaced by the next build. The task warns when `mozuconfig.nodeVersion` is set, because it does not write `nodeVersion`.
- **Failures stop the build.** A failed build leaves the previous `functions.json` in place, including when output is redirected to a file.

### Upgrading an app that has its own `tasks/manifest.js`

Apps generated by `generator-mozu-actions` carry a copy of this task in `tasks/manifest.js`. Grunt loads `./tasks` first, and this plugin never replaces a `manifest` task that is already registered, so **upgrading the plugin alone changes nothing.** To switch:

1. **Delete `tasks/manifest.js`.** If you changed that file, carry your changes over first. A local `nodeVersion` stamp, for example, is dropped.
2. **Run `grunt build --kibo-init`**, or write `kibo.json` by hand.
3. **Commit `kibo.json` and upload as usual.** The `arcjs` block is the only intended change to `functions.json`. Check the diff before uploading.

## Contributing
In lieu of a formal styleguide, take care to maintain the existing coding style. Add unit tests for any new or changed functionality. Run them with `npm test`.

## License
Copyright (c) Volusion Inc.. Licensed under the MIT license.

[1]: https://www.npmjs.com/package/generator-mozu-theme "Mozu Yeoman Theme Generator"
[2]: https://www.npmjs.com/package/generator-mozu-app "Mozu Yeoman App Generator"
