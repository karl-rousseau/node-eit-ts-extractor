node-eit-ts-extractor
=====================

[![Release](https://img.shields.io/badge/release-v0.1-red.svg)]()
[![NodeJS](https://img.shields.io/badge/node.js-v6+-green.svg)](https://nodejs.org)
[![No Dependencies](https://img.shields.io/badge/no-dependencies-yellow.svg)]()
[![License:MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/karl-rousseau/node-eit-ts-extractor/blob/master/LICENSE)
[![HitCount](http://hits.dwyl.io/karl-rousseau/node-eit-ts-extractor.svg)](http://hits.dwyl.io/karl-rousseau/node-eit-ts-extractor)

MPEG-2 TS packet analyser which enables parsing, decoding and low level analysis of ISO/DVB transport streams.

This PoC purpose was to quickly **extract EIT tables** for example from a captured DTT **transport stream file** without having the whole PSI tables also extracted. It can enable the output of those EIT present & following events in [JSON format](https://en.wikipedia.org/wiki/JSON) which can be easily used in browser applications.

## Usage Example

```bash
# node -v
8.15.1

# node eit_extractor.js stream-dvbt.ts
...
TOTAL number of services found: 37
TOTAL number of EIT found: 63
TOTAL time spent: 11s
```

> Note: this one gigabyte TS file has been captured with dvbstream 0.8.2 on the French DTT broadcast network using a Pinnacle USB tuner key.

## Benchmarks

| Software  | Version | Development language | Parsing time ⏱ | Note |
| --------- |:-------:| -------------------- |:---------------:| ---- |
| VLC [dvb_print_si](https://www.videolan.org/developers/bitstream.html) | 1.4 | [<img  src="https://img.shields.io/badge/C-99-blue.svg">](https://en.wikipedia.org/wiki/C99) standard | <span style="color:green;">0:01</span> | **Fastest** raw parser<br>(but without EIT only filtering) |
| [DVB inspector](https://www.digitalekabeltelevisie.nl/dvb_inspector/) | 1.10 | [<img  src="https://img.shields.io/badge/JAVA-1.8-red.svg">](https://en.wikipedia.org/wiki/Java_%28programming_language%29) with Oracle JIT | <span style="color:red;">0:37</span> | Boosted with BufferedInputStream<br>but not yet with [NIO 2.0](https://en.wikipedia.org/wiki/Non-blocking_I/O_%28Java%29) API |
| node-eit-ts-extractor | 0.1 | [<img  src="https://img.shields.io/badge/ES-5-green.svg">](https://en.wikipedia.org/wiki/ECMAScript) under NodeJS v8 | <span style="color:orange;">0:11</span> | Pretty fast I/O access with C++ AoT<br>(Chrome [V8 engine](https://v8.dev/) inside) |
|| <span style="color:gray;">0.2</span> | [<img  src="https://img.shields.io/badge/ES-6-yellow.svg">](https://en.wikipedia.org/wiki/ECMAScript) <span style="color:gray;"> under NodeJS v10+</span> | <span style="color:gray;">?</span> | <span style="color:gray;">Handling multi-cores CPU<br>using (NodeJS ~~Cluster~~[worker threads](https://nodejs.org/api/worker_threads.html) no more experimental)</span> |

> Note: those benchmarks were done on Ubuntu 16.04 LTS using linux time command on an old Core2Duo (2Ghz) laptop with a 7200rpm HDD formatted in standard ext4 filesystem.

## Improvements

- [x] Add TODO comments
- [ ] Migrate from JShint to ESlint
- [ ] Convert ES5 notation to ES6 with async/await, rest/spread operator, arrow functions, ...
- [ ] Try to use ES6 array destructing assignment within binary extractor methods and some binary structures like [construct-js](https://github.com/francisrstokes/construct-js)
- [ ] Split the parsing algorithm into pieces that will be sent to Worker threads using NodeJS v10+
- [ ] Test everything on multi-core CPU + SSD (more I/O bandwidth than standard HDD)

[![Open Source Love](https://badges.frapsoft.com/os/v1/open-source.svg?v=103)]() Sending a big 🐮 MeuhMeuh to C.Massiot creator of dvb_print_si
