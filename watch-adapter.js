var assert = require('assert');
var debounce = require('lodash.debounce');

var eventsFor = {
  'upload': ['changed','added'],
  'delete': ['deleted']
};

var delay = 200;

module.exports = function(grunt, options) {

  var changed;
  function resetChanged() {
    changed = Object.create(null);
    if (options.always) {
      options.always.forEach(function(p) {
        changed[p] = true;
      });
    }
  }

  assert(options.src && options.action, 'Please supply a src and action path to modify in the grunt config.');

  resetChanged();

  var onChange = debounce(function() {
    var src = Object.keys(changed);
    grunt.verbose.ok('Updating change hash in ' + options.src + ' to include ' + grunt.log.wordlist(src));
    grunt.config(options.src, src);
    resetChanged();
  }, delay, { leading: true, trailing: true });

  grunt.verbose.ok('Attaching grunt watch task to mozusync ' + options.action);

  grunt.event.on('watch', function(action, filepath) {
    if (eventsFor[options.action].indexOf(action) !== -1) {
      changed[filepath] = action;
    }
    onChange();
  });

};