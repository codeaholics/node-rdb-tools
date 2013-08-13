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

var Parser = require('../../rdb-tools').Parser,
    Writer = require('../../rdb-tools').Writer,
    assert = require('chai').assert,
    fs = require('fs'),
    Writable = require('stream').Writable,
    BufferList = require('bl'),
    _ = require('underscore');

describe('Performance', function() {
    it('of the Parser', function(done) {
        var parser = new Parser();
        var timer = createTimer({objectMode: true}, expect(15000, done));

        parser.pipe(timer);

        parser.write(new Buffer('REDIS0006', 'ascii'));
        parser.write(new Buffer([0xFE, 0x00]));

        for (var i = 0; i < 100000; i++) {
            parser.write(new Buffer([0xFC, 0x3D, 0xD8, 0xC3, 0x48, 0x85, 0x01, 0x00, 0x00, 0x00, 0x14, 0x65, 0x78, 0x70, 0x69, 0x72, 0x65, 0x73, 0x5F, 0x6D, 0x73, 0x5F, 0x70, 0x72, 0x65, 0x63, 0x69, 0x73, 0x69, 0x6F, 0x6E, 0x1D, 0x32, 0x30, 0x32, 0x32, 0x2D, 0x31, 0x32, 0x2D, 0x32, 0x35, 0x20, 0x31, 0x30, 0x25, 0x10, 0x3A, 0x31, 0x31, 0x3A, 0x31, 0x32, 0x2E, 0x35, 0x37, 0x33, 0x20, 0x55, 0x54, 0x43]));
        }

        parser.write(new Buffer([0xFF]));
        parser.write(new Buffer([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
        parser.end();
    });
});

function expect(expectedDuration, done) {
    return function(start, end, duration) {
        assert.closeTo(duration, expectedDuration, 1000);
        done();
    }
}

function createTimer(options, cb) {
    var timer = new Writable(options),
        start, end;

    timer._write = function(chunk, encoding, cb) {
        if (!start) start = Date.now();
        cb();
    }

    timer.on('finish', function() {
        end = Date.now();
        cb(start, end, end - start);
    });

    return timer;
}
