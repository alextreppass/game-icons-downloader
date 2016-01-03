# game-icons-downloader

A quick and dirty command-line downloader and organiser of assets from http://game-icons.net/.

Downloads zips for each tag listed on the game-icons tags page and organises / dedupes these for each artist.

This software is provided as-is. The icons themselves are subject to the http://game-icons.net licence conditions, a copy of which will be extracted to the output directory.

If the game-icons page structure changes, this utility is likely to stop working. Pull requests are welcome.

### Installation

Requires [NodeJS](http://nodejs.org)

Command line: ```npm install -g git://github.com/alextreppass/game-icons-downloader.git```


### Usage
```
  Usage: game-icon-downloader -f [zip flavour] -o [output folder] -p [parallel downloads]

  Options:
      f [optional] - Zip flavour: one of "svg-white", "svg-black", "png-white", "png-black". Default is "png-black".
      o [optional] - Output folder. Default is "Downloads" in your home folder.
      p [optional] - Number of parallel downloads. Default is 3.
```

* e.g. with default options: `game-icon-downloader`

* e.g. with all options: `game-icon-downloader -f svg-black -o /path/to/game-icons -p 5`


### Discussion thread on game-icons.net

http://forum.game-icons.net/icon-downloading-utility