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
    var currentDatabase = undefined;
    var encoding = options.encoding || 'utf8';
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
                self.push(Buffer.concat(outputBuffers));
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

        handlers[obj.rtype + 'Key'](obj);

        next('database', 'key', 'end');
    }

    handlers.end = function(obj, next) {
        output(new Buffer([0xFF]));
        // TODO: CRC
        next();
    }

    handlers.stringKey = function(obj) {
        output(new Buffer([0x00]));
        outputBytes(new Buffer(obj.key, encoding));
        outputBytes(new Buffer(obj.value, encoding));
    }

    function switchDatabase(n) {
        output(new Buffer([0xFE]));
        outputLengthEncoding(n, false);
        currentDatabase = n;
    }

    function outputLengthEncoding(n, special) {
        if (n < 0) throw new Error('Cannot write negative length encoding: ' + n);

        if (!special && n <= 0x3F) {
            return output(new Buffer([n]));
        } else {
            throw new Error('Failed to write length encoding: ' + n);
        }
    }

    function outputBytes(buffer) {
        outputLengthEncoding(buffer.length, false);
        output(buffer);
    }

    function output(data) {
        if (data instanceof Buffer) return outputBuffers.push(data);
        if (typeof(data) == 'string') return outputBuffers.push(new Buffer(data, 'ascii'));
        throw new Error('Unknown output data type');
    }
}
