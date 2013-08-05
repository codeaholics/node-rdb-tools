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

var Parser = require('../rdb-tools').Parser,
    Writer = require('../rdb-tools').Writer,
    assert = require('chai').assert,
    fs = require('fs'),
    Writable = require('stream').Writable,
    Transform = require('stream').Transform,
    BufferList = require('bl'),
    _ = require('underscore');

describe('Writer', function() {
    describe('should round-trip all parser test files', function() {
        _.each(fs.readdirSync('test/dumps'), function(f) {
            if (!f.match(/error/)) {
                it(f, function(done) {
                    this.test.slow(125);
                    roundTripTest(f, done);
                });
            }
        });
    });

    describe('should fail on unexpected objects', function() {
        var tests = [['buffer', new Buffer(0)],
                     ['string', 'hello world'],
                     ['null', null],
                     ['undefined', undefined],
                     ['object without type', {}],
                     ['wrong type of object', {type: 'database'}]];

        _.each(tests, function(test) {
            it(test[0], simpleErrorTest.bind(null, test[1]));
        });
    });

    it('should handle UTF-8', function(done) {
        var writer = new Writer(),
            bl = new BufferList(function(err, data) {
                assert.equal(data.get(13), 0xC2);
                assert.equal(data.get(14), 0xA3);
                assert.equal(data.get(16), 0xC2);
                assert.equal(data.get(17), 0xA9);
                done();
            });

        writer.pipe(bl);

        writer.write({
            type: 'header',
            version: 6
        });

        writer.write({
            type: 'database',
            number: 0
        });

        writer.end({
            type: 'key',
            rtype: 'string',
            database: 0,
            key: '\u00A3',
            value: '\u00A9'
        });
    });
});

function simpleErrorTest(obj, done) {
    var writer = new Writer();

    writer.on('error', function(e) {
        assert.match(e.message, /Unexpected object/);
        done();
    });

    writer._transform(obj);
}

function roundTripTest(f, done) {
    var inputStream = fs.createReadStream('test/dumps/' + f),
        parser = new Parser(),
        inputCaptor = new Transform({objectMode: true}),
        writer = new Writer(),
        reparser = new Parser(),
        outputCaptor = new Writable({objectMode: true}),
        inputCaptives = [],
        outputCaptives = [];

    inputCaptor._transform = function(obj, encoding, cb) {
        delete obj.offset;
        inputCaptives.push(obj);
        this.push(obj);
        cb();
    }

    outputCaptor._write = function(obj, encoding, cb) {
        delete obj.offset;
        outputCaptives.push(obj);
        cb();
    }

    outputCaptor.on('finish', function() {
        assert.deepEqual(outputCaptives, inputCaptives);
        done();
    });

    inputStream.pipe(parser).pipe(inputCaptor).pipe(writer).pipe(reparser).pipe(outputCaptor);
}
