var _ = require('lodash');
var util = require('util');

/**
  A stopgap ES6 class.

  `class Foo { ... }` ----> `var Foo = Class({ ... })`
  `class Foo extends Bar { ... } ` ----> `var Foo = Class.extend(Bar, { ... })`
*/
var _class = function (superClass, properties) {
  if (!arguments.length) {
    return new function () {};
  }
  else if (arguments.length === 1) {
    // no extending
    properties = superClass;
    superClass = null;
  }

  var constructor = properties.constructor || new function () {};
  constructor.prototype = Object.create(properties);

  constructor.prototype.constructor = constructor;
  delete properties.constructor;

  if (superClass) {
    // inherit protptype methods
    util.inherits(constructor, superClass);
    // ensure 'defaults' are overwritten
    _.extend(constructor.prototype, properties);
  }

  return constructor;
};

var Class = function (properties) {
  return _class(properties);
};

Class.extend = function (base, properties) {
  return _class(base, properties);
};

module.exports = Class;