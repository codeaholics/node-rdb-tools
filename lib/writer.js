// Copyright 2013 Danny Yates

//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at

//        http://www.apache.org/licenses/LICENSE-2.0

//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var Transform = require('stream').Transform,
    lzf = require('lzf'),
    util = require('util'),
    bufferEqual = require('buffer-equal'),
    Int64 = require('int64-native'),
    Crc64 = require('../build/Release/Crc64.node').Crc64;

exports = module.exports = Writer;

util.inherits(Writer, Transform);

function Writer(options) {
    if (!(this instanceof Writer)) {
        return new Writer(options);
    }

    Transform.call(this, {objectMode: true});

    options = options || {};

    var self = this;
    var currentDatabase = 0;
    var encoding = options.encoding || 'utf8';
    var crc = new Crc64();
    var emptyCrc = new Buffer(8);
    var expectedNext = 'header';

    emptyCrc.fill(0);

    self._transform = function(obj, encoding, cb) {
        // TODO: implement me!
        cb();
    }
}
