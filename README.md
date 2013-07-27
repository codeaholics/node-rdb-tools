# node-redis-tools

### Tools for parsing, filtering and creating Redis RDB files

[![Build Status](https://travis-ci.org/codeaholics/node-rdb-tools.png?branch=master)](https://travis-ci.org/codeaholics/node-rdb-tools)

This module currently provides:

*   an [RDB parser](#parser) - a "streams2" [transformer](http://nodejs.org/api/stream.html#stream_class_stream_transform) which understands Redis RDB files and produces objects representing the keys and values
*   an [RDB writer](#writer) - a transformer which consumes the objects produced by the [parser](#parser) and produces a Redis RDB file
*   a ["protocol emitter"](#protocol-emitter) - a transformer which takes arrays of Redis commands and produces raw Redis network protocol

In future it will also provide tools for modifying RDB files - for example deleting keys, moving keys to different spaces, merging/splitting RDB files, etc.

These tools are perfect for situations where you want to do analysis on your Redis data, but don't want to do it online on the server. Typically, if you have a Redis instance with many millions of keys, then doing a `keys *` or similar will block your server for a long time. In cases like these, taking a recent dump (or forcing a current one with `BGSAVE`) and then analysing that file offline is a useful technique.

## Installation

```bash
$ npm install rdb-tools
```

## Example

There is a script in the `bin` directory which dumps the contents of your RDB file to `stdout` as a series of JSON objects. It looks like this:

```javascript
var Parser = require('../rdb-tools').Parser,
    parser = new Parser(),
    Writable = require('stream').Writable;

var writable = new Writable({objectMode: true});
writable._write = function(chunk, encoding, cb) {
    console.log(chunk);
    cb();
};

// Deal cleanly with stdout suddenly closing (e.g. if piping through 'head')
process.stdout.on('error', function(err) {
    if (err.code === 'EPIPE') {
        process.exit(0);
    }
})

process.stdin.pipe(parser).pipe(writable);
```

Use it like this:

```bash
$ node script.js < myrdb.rdb
```

In this example, you can see we take `stdin`, pipe it through the parser and pipe the parser output into a `Writable` which dumps the object it receives to `stdout`. Note that the parser produces objects as output rather than `Buffers`. This means the downstream pipe components need `objectMode` set to `true`.

## Speed

On my laptop (a Lenovo X1 Carbon running Ubuntu 12.10 with a `Intel(R) Core(TM) i7-3667U CPU @ 2.00GHz` CPU), I can chew through around 20,000 - 25,000 keys per second. This performance is dependent on the types of data in your file. For example, keys with simple string values are much faster to parse than keys with large composite data structures (hashes, lists, sets, sorted sets). My laptop also has an SSD, so I'm not disk-bound, but I doubt disk speed is going to be an issue.

## Parser

The parser works as a Node "streams2" transformer. You feed it a stream of bytes (typically from `process.stdin` or a [file read stream](http://nodejs.org/api/fs.html#fs_fs_createreadstream_path_options)), and it produces a stream of objects representing your keys and values (and other miscellaneous structural information about the file).

### Constructor options

```javascript
var parser = new Parser(options);
```

`options` is an object with the following:

*   `encoding`: the character encoding to use when converting to and from `String` (see below). Defaults to `utf8`.

### File formats

Redis RDB files come in a number of formats. [Sripathi Krishnan (@sripathikrishnan)](https://github.com/sripathikrishnan) does an excellent job of documenting the [internal structure](https://github.com/sripathikrishnan/redis-rdb-tools/blob/master/docs/RDB_File_Format.textile) and what the differences are between [different versions](https://github.com/sripathikrishnan/redis-rdb-tools/blob/master/docs/RDB_Version_History.textile).

The parser currently doesn't pay any attention to the version of the file format. It understands (almost) all of the structures that can be found in the file and will handle them appropriately.

### Output

As mentioned above, the parser produces objects as its output. The following objects are produced:

#### Events

The parser emits an `error` event when it detects a problem with the RDB file.

#### Header

This object is produced when the "magic header" at the beginning of the file is parsed. It is of little use to downstream components, but is provided for completeness and in anticipation of creating an RDB writer component.

```javascript
{
    type: 'header',
    version: <version number - typically 6 for modern Redis installs>,
    offset: <byte offset where this record begins in the stream>
}
```

#### Database

This object is produced when a "database" record is found. This indicates that any subsequent keys belong to the given database. This object can be produced multiple times in the following sequence: `database: 0`, `key-value`, `key-value`, `key-value`, `database:1`, `key-value`, `key-value`, etc. Downstream components have little use for this object because the subsequent key objects also carry the database information.

```javascript
{
    type: 'database',
    number: <database number - typically 0-15>,
    offset: <byte offset where this record begins in the stream>
}
```

#### Key

This is the primary output of the parser. One key record is produced for each key-value pair found in the store.

```javascript
{
    type: 'key',
    rtype: <redis type>
    database: <database number>,
    key: <string>,
    expiry: <number or undefined>,
    value: <see below>,
    offset: <byte offset where this record begins in the stream>
}
```

`rtype` contains the underlying Redis datatype and is one of: `string`, `list`, `set`, `zset` or `hash`

`value` can have the following types depending on the underlying Redis datastructure:

*   Simple values are `Strings`
*   Lists and sets are `Arrays` of Strings
*   Hashes are `Objects` whose keys and values map to the keys and values of the Redis hash
*   Sorted sets (zsets) are `Objects` whose keys are the sorted set keys and whose values are the scores

##### String interpretation

Redis keys and values are "binary safe". This means that Redis treats them as just arrays of bytes and places no further interpretation on them - in particular it doesn't attempt to interpret them as strings with particular character encodings. (This isn't quite true, as Redis does understand keys and values which consist wholly of the ASCII characters '0'-'9' as in encodes them specially in RDB files and provides commands such as `INCR` and `HINCRBY` which understand the semantics of numeric values. But let's move on...)

Javascript isn't great with binary data. Early drafts of the parser produced keys and values as `Buffers`, but this was felt to be too restrictive to users of the parser. In particular, the Javascript `Object` is a natural mapping for Redis hashes, and this mapping wouldn't have been possible with `Buffers` as keys.

Therefore, the parser does two things which you'll probably never notice, but might do if you're making use of Redis's "binary safe" abilities!

1.  If a key or value is encoded in the RDB file using one of several special "numeric" encodings, the parser will interpret the number and convert it to a `String` in the output object
2.  All other keys and values are converted to `String`

The parser uses the character encoding specified on construction (default `utf8`) to interpret keys and values as `Strings` and to convert numeric keys and values to `Strings`.

In this way, the parser presents a consistent view of the Redis store - all primitives are `Strings`.

##### Expiry magic

RDB files have two different encodings of key expiry - either seconds or milliseconds since ["Unix epoch"](http://en.wikipedia.org/wiki/Unix_epoch).

For consistency, expiries are always presented to the user in milliseconds. If the key doesn't have an expiry, the expiry is `undefined`.

However... Redis stores milliseconds in an 8 byte (64 bit) number. Javascript doesn't support 64 bit numbers! Javascript numbers are all [IEEE 754 floating point](https://www.inkling.com/read/javascript-definitive-guide-david-flanagan-6th/chapter-3/numbers) numbers. These numbers can precisely represent all integers in the range &plusmn;2<sup>53</sup>. Numbers outside of this range start to lose precision.

A Javascript date can accept millisecond timestamps [up to 100,000,000 days from Unix epoch](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date#Description).

100,000,000 days &times; 86,400,000 milliseconds / day = 8.64 &times; 10<sup>15</sup> &cong; 2<sup>53</sup>.

So, in practice, unless you are working with expiries out near Sep 13 275760, this probably won't be a problem for you!

### End

This object represents the end of the file (almost... a CRC may follow). It is of little use to downstream components.

```javascript
{
    type: 'end',
    offset: <byte offset where this record begins in the stream>
}
```

### CRC

Some versions of the RDB file format can contain a CRC checksum at the end of the file. If it is present and correctly validates the file data, the following object is produced:

```javascript
{
    type: 'crc',
    offset: <byte offset where this record begins in the stream>
}
```

Redis has a configuration option to disable the CRC (`rdbchecksum no`). If CRC is disabled, this object will still be produced.

## Writer

The writer is also a transformer. If you pass it objects in the form produced by the [parser](#parser), it will produce a byte stream consisting of an RDB file. Probably the best thing to do with this is write it to disk by piping the writer to a [file writer stream](http://nodejs.org/api/fs.html#fs_fs_createwritestream_path_options).

### Constructor options

```javascript
var writer = new Writer(options);
```

`options` is an object with the following:

*   `encoding`: the character encoding to use when converting to and from `String` (see the [parser documentation](#string-interpretation)). Defaults to `utf8`.
*   `compressionThreshold`: how large a given string is before the writer attempts to compress it. Like Redis, this defaults to `4`. When a string is larger than this threshold, the writer will compress it, but only write out the compressed version if it is actually smaller. This is consistent with Redis' behaviour. However, it should be noted that this can consume a large amount of CPU by compressing keys and values and then discarding the compressed versions if your keys and values are small or otherwise not very compressible. You may wish to increase this threshold to improve throughput at the expense of the output RDB size.

### Output

#### File format

The writer currently only produces [version 6](https://github.com/sripathikrishnan/redis-rdb-tools/blob/master/docs/RDB_Version_History.textile#version-6) files. It doesn't, however, use all of the features of this file version. If you have a requirement for older file versions, please raise an issue.

#### Events

The writer emits an `error` event when it detects a problem with its input - for example, objects in the wrong order.

### Input

The writer takes as input the same objects that the parser produces as output. The writer ignores the `offset` field on any input objects as this isn't part of the RDB file format, but is provided by the parser for information/debugging purposes.

#### Header

When it receives a `header` object, the writer writes an RDB header to the output with the same version number as the incoming header object. *Note:* even though the writer emits a header with the same version as the input object, it doesn't adjust any other aspect of its output and still uses structures only found in later versions of the file format. This may change in future. If it causes you problems, please raise an issue.

#### Database

The writer ignores `database` objects. It gets the database information from the key objects and switches between databases as necessary based on that information.

#### Key

`Key` objects are written to the output RDB file stream using only the most simple encoding for each type. This will generally mean that your RDB files are not as compact as they may otherwise be. If this is a problem for you and you need the newer 'zip' encodings, please raise an issue.

#### End

The writer will write an EOF marker into the RDB stream when it receives this object. But remember... that's not the end...

#### CRC

After sending an `end` object, you will need to send a `crc` object. (*Note:* the parser already produces these objects in this order.) When it receives this object it will write out the CRC of the bytes already written.

At this point, the writer will not accept any more objects and will produce an `error` event if any attempt is made to send more objects. The RDB stream is complete at this point and the writer should be finalised in the normal ways - e.g. by calling [`end()`](http://nodejs.org/api/stream.html#stream_writable_end_chunk_encoding_callback) if you're using the writer directly or by closing down the pipeline if you're piping into it.

## Protocol Emitter

The protocol emitter is also transformer. It takes arrays representing Redis commands as input and produces raw Redis network protocol as output. The output is suitable for piping into `redis-cli --pipe`.

### Constructor options

```javascript
var protocolEmitter = new ProtocolEmitter(options);
```

`options` is an object with the following:

*   `encoding`: the character encoding to use when converting the Redis commands from `String` to network protocol bytes. Defaults to `utf8`.

### Input

Feed the emitter arrays which look like this:

```javascript
['HINCRBY', 'user:1234', 'failedLogins', '1']
['SET', 'status', 'running']
['ZINCRBY', 'popular', '1', 'https://github.com/codeaholics/node-rdb-tools']
```

## Known Issues

*   Doesn't support binary keys/values and likely never will. Get in touch if you REALLY need this...
*   Can't represent key expiries much beyond the year 275760. But if it could, you wouldn't be able to pass them to `Date()` ;-)
*   If the file is truncated at just the right spot (between records), the parser will hang. The cause of this lies in an external library and is being investigated.
*   I suspect there are endianness issues on big endian hardware (particularly around my wrapping of the CRC code), but I don't have access to any to test!

## To do

- [x] <del>I don't believe any of the test RDB files have expiries in seconds (verify and create new test if necessary).</del>
- [x] <del>Sorted Set encoding is [not documented](https://github.com/sripathikrishnan/redis-rdb-tools/wiki/Redis-RDB-Dump-File-Format#sorted-set-encoding) and none of the test RDBs appear to use it. Is it obsoleted by more recent encodings for sorted sets?</del>
- [ ] Writer only produces version 6 RDBs. This is probably good enough!
- [ ] Writer doesn't use any of the more compact 'zip' encodings.

## Acknowledgements

*   [@antirez](https://github.com/antirez) (Salvatore Sanfilippo) for creating Redis - I also used his CRC code for validating the RDB CRC.
*   [@sripathikrishnan](https://github.com/sripathikrishnan) (Sripathi Krishnan) for his [redis-rdb-tools](https://github.com/sripathikrishnan/redis-rdb-tools) project which inspired me to create this project. I also used his excellent set of test RDB files.
*   [@TooTallNate](https://github.com/TooTallNate) (Nathan Rajlich) for his [node-stream-parser](https://github.com/TooTallNate/node-stream-parser) library and for working through some bugs (in code and in my understanding!) with me.

## License

This software is provided under the [Apache License, Version 2.0](http://www.apache.org/licenses/LICENSE-2.0.html). See [LICENCE.txt](https://raw.github.com/codeaholics/node-rdb-tools/master/LICENSE.txt) in the source code for more details.

<pre>
Copyright 2013 Danny Yates

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
</pre>

The CRC code is by Salvatore Sanfilippo ([@antirez](https://github.com/antirez)):

<pre>
Copyright (c) 2006-2012, Salvatore Sanfilippo
All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
    * Neither the name of Redis nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
</pre>
