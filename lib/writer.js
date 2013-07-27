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
    var currentDatabase = undefined;
    var encoding = options.encoding || 'utf8';
    var compressionThreshold = options.compressionThreshold || 4;  // 4 is what Redis uses.
    var crc = new Crc64();
    var outputBuffers = [];
    var expectedNext = ['header'];
    var handlers = {};

    self._transform = function(obj, encoding, cb) {
        try {
            handleObject(obj, cb);
        } catch(e) {
            self.emit('error', e);
        }
    }

    function handleObject(obj, cb) {
        if (!obj || !obj.type) throw new Error('Unexpected object received');
        if (expectedNext.indexOf(obj.type) == -1) throw new Error('Unexpected object received: ' + obj.type + '; was expecting one of: ' + expectedNext);

        handlers[obj.type](obj, function() {
            if (outputBuffers.length) {
                var output = Buffer.concat(outputBuffers);
                crc.push(output);
                self.push(output);
                outputBuffers = [];
            }
            expectedNext = Array.prototype.slice.call(arguments, 0);
            cb();
        });
    }

    handlers.header = function(obj, next) {
        var header = 'REDIS' + ('000' + obj.version).slice(-4);
        output(header);
        next('database', 'end');
    }

    handlers.database = function(obj, next) {
        // don't do anything explicit with database objects; switch databases based on the key objects
        next('database', 'key', 'end');
    }

    handlers.key = function(obj, next) {
        if (obj.database != currentDatabase) {
            switchDatabase(obj.database);
        }

        if (typeof(obj.expiry) != 'undefined') {
            outputExpiry(obj.expiry);
        }

        handlers[obj.rtype + 'Key'](obj);

        next('database', 'key', 'end');
    }

    handlers.end = function(obj, next) {
        output(new Buffer([0xFF]));
        next('crc');
    }

    handlers.crc = function(obj, next) {
        // ignore the CRC object itself, and use this as a signal to write a CRC
        output(crc.value());
        next();
    }

    handlers.stringKey = function(obj) {
        output(new Buffer([0]));
        outputString(obj.key);
        outputString(obj.value);
    }

    handlers.hashKey = function(obj) {
        output(new Buffer([4]));
        outputString(obj.key);
        outputLengthEncoding(Object.keys(obj.value).length, false);
        for (key in obj.value) {
            outputString(key);
            outputString(obj.value[key]);
        }
    }

    handlers.listKey = function(obj) {
        output(new Buffer([1]));
        outputString(obj.key);
        outputLengthEncoding(obj.value.length, false);
        for (var i = 0, n = obj.value.length; i < n; i++) {
            outputString(obj.value[i]);
        }
    }

    handlers.setKey = function(obj) {
        output(new Buffer([2]));
        outputString(obj.key);
        outputLengthEncoding(obj.value.length, false);
        for (var i = 0, n = obj.value.length; i < n; i++) {
            outputString(obj.value[i]);
        }
    }

    function outputExpiry(expiry) {
        if (expiry % 1000 == 0) {
            throw new Error('Second granularity expiries not supported yet');
        } else {
            var buffer = new Buffer(9);
            var int64 = new Int64(expiry);

            buffer.writeUInt8(0xFC, 0);
            buffer.writeUInt32LE(int64.low32(), 1);
            buffer.writeUInt32LE(int64.high32(), 5);
        }

        output(buffer);
    }

    function switchDatabase(n) {
        output(new Buffer([0xFE]));
        outputLengthEncoding(n, false);
        currentDatabase = n;
    }

    function outputLengthEncoding(n, special) {
        if (n < 0) throw new Error('Cannot write negative length encoding: ' + n);

        if (!special) {
            if (n <= 0x3F) {
                return output(new Buffer([n]));
            } else if (n <= 0x3FFF) {
                return output(new Buffer([0x40 | (n >> 8), n & 0xFF]));
            } else if (n <= 0xFFFFFFFF) {
                var buffer = new Buffer(5);
                buffer.writeUInt8(0x80, 0);
                buffer.writeUInt32BE(n, 1);
                return output(buffer);
            }

            throw new Error('Failed to write length encoding: ' + n);
        } else {
            if (n > 0x3F) {
                throw new Error('Cannot encode ' + n + ' using special length encoding');
            }
            return output(new Buffer([0xC0 | n]));
        }
    }

    function outputString(s) {
        var buffer;

        // Does it look like a number?
        if (s.match(/^-?\d+$/)) {
            var n = parseInt(s);
            if (n >= -128 && n <= 127) {
                buffer = new Buffer(1);
                buffer.writeInt8(n, 0);
                outputLengthEncoding(0, true);
                output(buffer);
                return;
            } else if (n >= -32768 && n <= 32767) {
                buffer = new Buffer(2);
                buffer.writeInt16LE(n, 0);
                outputLengthEncoding(1, true);
                output(buffer);
                return;
            } else if (n >= -2147483648 && n <= 2147483647) {
                buffer = new Buffer(4);
                buffer.writeInt32LE(n, 0);
                outputLengthEncoding(2, true);
                output(buffer);
                return;
            }
        }

        // It doesn't look like a number, or it's too big
        buffer = new Buffer(s, encoding);
        if (buffer.length > compressionThreshold) {
            var compressed = lzf.compress(buffer);
            if (compressed.length < buffer.length) {
                // It saved some space
                outputLengthEncoding(3, true);
                outputLengthEncoding(compressed.length, false);
                outputLengthEncoding(buffer.length, false);
                output(compressed);
                return;
            }
        }

        outputLengthEncoding(buffer.length, false);
        output(buffer);
    }

    function output(data) {
        if (data instanceof Buffer) return outputBuffers.push(data);
        if (typeof(data) == 'string') return outputBuffers.push(new Buffer(data, 'ascii'));
        throw new Error('Unknown output data type');
    }
}
