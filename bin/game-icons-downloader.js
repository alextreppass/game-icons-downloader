#!/usr/bin/env node
'use strict';

var _ = require('lodash');
var $ = require('cheerio');
var async = require('async');
var Class = require('../lib/class');
var fs = require('fs-extra');
var parseArgs = require('minimist');
var path = require('path');
var Promise = require('bluebird');
var request = Promise.promisifyAll(require('request'), { multiArgs: true });
var yauzl = require('yauzl');

var BASE_URL = 'http://game-icons.net';
var TAGS_URL = BASE_URL + '/tags.html';

var TAG_LINK_PATTERN = /(.+?)\s\(\d+\)/;
var FILE_ARTIST_PATTERN = /icons\/([\w-]+)\//;
var FILE_LICENSE_PATTERN = /icons\/license\.txt/

var ZIP_FLAVOURS = {
  'svg-white': 'white on black SVG icons',
  'svg-black': 'black on transparent SVG icons',
  'png-white': 'white on black PNG icons',
  'png-black': 'black on transparent PNG icons'
};

function getUserHome () {
  return process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'];
};

var Downloader = Class({

  defaults: {
    parallelDownloads: 3,
    zipFlavour: 'png-black',
    outputFolder: path.resolve(getUserHome(), 'Downloads', 'game-icons')
  },

  constructor: function (config) {
    this._config = _.defaultsDeep(config, this.defaults);
    this._tags = {}; // tags to tag page urls
    this._zips = {}; // tags to zip files
    this._tagPages = {}; // tags to cheerio-parsed pages
    this._wroteLicense = false;
  },

  // grab tag page urls from master tag list
  getTags: function () {
    var self = this;

    return this.loadTagsPage()
      .then(function () {
        _.extend(self._tags, self.parseTags());
      });
  },

  loadTagsPage: function () {
    var self = this;

    return request.getAsync({ url: TAGS_URL })
      .spread(function (response, body) {
        if (response.statusCode != 200) {
          throw 'Got unexpected response back from tags page: ' + response.statusCode;
        }
        self.$tagsPage = $.load(body);
      });
  },

  parseTags: function () {
    var tagLinks = this.$tagsPage('.tags a');

    return _.reduce(tagLinks, function (memo, link) {
      link = $(link);
      var tag = this.parseTagName(link.text());
      var href = link.attr('href');
      memo[tag] = href;
      return memo;
    }, {}, this);
  },

  parseTagName: function (tagText) {
    var match = tagText.match(TAG_LINK_PATTERN);

    if (match != null) {
      tagText = match[1];
    }
    return _.trim(tagText).toLowerCase();
  },

  // download the zip file for each tag
  downloadZips: function () {
    var self = this;
    var tasks = _.map(this._tags, this.downloadZipTask, this);

    return new Promise(function (resolve) {
      return async.parallelLimit(tasks, self._config.parallelDownloads, function (err) {
        if (err) throw err;
        resolve();
      });
    });
  },

  downloadZipTask: function (tagPage, tag) {
    var self = this;

    return function (asyncDone) {
      self.loadTagPage(tag, tagPage)
        .then(function () {
          return self.downloadTagZip(tag);
        })
        .then(function () {
          asyncDone();
        });
    };
  },

  loadTagPage: function (tag, tagPage) {
    var self = this;

    return request.getAsync({ url: BASE_URL + tagPage })
      .spread(function (response, body) {
        if (response.statusCode != 200) {
          throw 'Got unexpected response back from tag page: ' + tag + response.statusCode;
        }
        self._tagPages[tag] = $.load(body);
      });
  },

  downloadTagZip: function (tag) {
    var $tagPage = this._tagPages[tag];
    var zipFlavourHint = ZIP_FLAVOURS[this._config.zipFlavour];
    var zipLink = $($tagPage('.download .hint--top[data-hint="' + zipFlavourHint + '"] a'));
    var zipUrl = zipLink.attr('href');
    var target = path.join(this._config.outputFolder, tag + '.zip');

    this._zips[tag] = target;

    if (fs.existsSync(target)) {
      // already downloaded
      return Promise.resolve(target);
    }

    fs.mkdirpSync(this._config.outputFolder);

    return new Promise(function (resolve) {
      request.get({ url: BASE_URL + zipUrl, encoding: null })
      .pipe(fs.createWriteStream(target))
      .on('close', function () {
        console.log('Downloaded zip for', tag);
        resolve(target);
      });
    });
  },

  // unzip the tag and place files under artist folders
  organiseFiles: function () {
    var self = this;
    var tasks = _.map(this._zips, this.extractZipTask, this);

    return new Promise(function (resolve) {
      return async.parallelLimit(tasks, self._config.parallelDownloads, function (err) {
        if (err) throw err;
        resolve();
      });
    });
  },

  extractZipTask: function (zipPath, tag) {
    var self = this;

    return function (asyncDone) {
      return self.extractZip(zipPath, tag)
        .then(function () {
          asyncDone();
        });
    };
  },

  extractZip: function (zipPath, tag) {
    var self = this;

    return new Promise(function (resolve) {
      yauzl.open(zipPath, { lazyEntries: true }, function (err, zipfile) {
        if (err) throw err;
        var next = zipfile.readEntry.bind(zipfile);
        zipfile.on('entry', function (entry) {
          // ignore dirs
          if (!/\/$/.test(entry.fileName)) {
            self.handleZipFile(entry, zipfile, next);
          }
        });
        zipfile.on('end', function () {
          console.log('Processed zip for', tag);
          resolve();
        });
        next();
      });
    });
  },

  handleZipFile: function (entry, zipfile, next) {
    var artistMatch = entry.fileName.match(FILE_ARTIST_PATTERN);
    if (artistMatch != null) {
      var artistDir = path.join(this._config.outputFolder, artistMatch[1]);
      this.unzipFile(artistDir, entry, zipfile, next);
      return;
    }

    if (!this._wroteLicense) {
      var licenseMatch = entry.fileName.match(FILE_LICENSE_PATTERN);
      if (licenseMatch != null) {
        this.unzipFile(this._config.outputFolder, entry, zipfile, next);
        this._wroteLicense = true;
        console.log('Wrote license file');
        return;
      }
    }

    // ignore
    next();
  },

  unzipFile: function (dir, entry, zipfile, next) {
    if (!fs.existsSync(dir)) {
      fs.mkdirpSync(dir);
    }
    var icon = path.basename(entry.fileName);
    var target = path.join(dir, icon);
    if (fs.existsSync(target)) {
      next();
      return;
    }
    zipfile.openReadStream(entry, function (err, readStream) {
      if (err) throw err;
      readStream.pipe(fs.createWriteStream(target));
      readStream.on('end', function() {
        next();
      });
    });
  },

  // clean up downloaded zips
  deleteZips: function () {
    _.each(this._zips, function (zip, tag) {
      fs.unlink(zip, function (err) {
        if (err) throw err;
      });
    });
  },

  run: function () {
    var self = this;

    return this.getTags()
      .then(function () {
        return self.downloadZips();
      })
      .then(function () {
        return self.organiseFiles();
      })
      .then(function () {
        return self.deleteZips();
      })
      .then(function () {
        console.log('Done. Extracted all icons to', self._config.outputFolder);
      })
      .catch(fatalError);
  }

});

var configFromArgv = function () {
  var argv = parseArgs(process.argv.slice(2));
  var anonArgs = argv._;

  if (_.any(anonArgs)) {
    printUsage();
    process.exit(1);
  }

  var config = {};

  if (_.has(argv, 'h') || _.has(argv, 'help')) {
    printUsage();
    process.exit(1);
  }

  if (typeof argv.f === 'string') {
    if (!_.has(ZIP_FLAVOURS, argv.f)) {
      printUsage();
      process.exit(1);
    }
    config.zipFlavour = argv.f;
  }
  if (typeof argv.o === 'string') {
    config.outputFolder = argv.o;
  }
  if (typeof argv.p === 'number') {
    config.parallelDownloads = argv.p;
  }

  return config;
};

var printUsage = function () {
  console.log([
    '',
    'Usage: game-icon-downloader -p [num]',
    '',
    'Options: ',
    '\t  f [optional] - Zip flavour: one of "svg-white", "svg-black", "png-white", "png-black". Default is "png-black".',
    '\t  o [optional] - Output folder. Default is "Downloads" in your home folder.',
    '\t  p [optional] - Number of parallel downloads. Default is 3.',
    ''
  ].join('\n'));
};

var fatalError = function (err) {
  console.err('Error:', err.message);
  process.exit(1);
};

if (require.main === module) {
  var dl = new Downloader(configFromArgv());
  dl.run()
}
