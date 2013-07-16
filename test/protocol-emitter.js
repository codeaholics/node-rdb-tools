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

var ProtocolEmitter = require('../rdb-tools').ProtocolEmitter,
    assert = require('chai').assert,
    BufferList = require('bl'),
    bufferEqual = require('buffer-equal');

describe('Protocol Emitter', function() {
    it('should convert arrays', function(done) {
        var expected = makeExpected('*4', '$7', 'HINCRBY', '$9', 'user:1234', '$12', 'failedLogins', '$1', '1');

        pass(['HINCRBY', 'user:1234', 'failedLogins', '1'], function(err, data) {
            assert.equal(data.toString(), expected.toString());
            done();
        });
    });

    it('should handle UTF-8', function(done) {
        pass(['\u00a3'], function(err, data) {
            assert.isTrue(bufferEqual(data.slice(8, 10), new Buffer([0xC2, 0xA3])));
            done();
        });
    });

    it('should reject objects', function(done) {
        assert.throw(pass.bind(this, {}), /Unexpected chunk received/);
        done();
    });
})

function makeExpected() {
    var bl = new BufferList();

    for (var i = 0; i < arguments.length; i++) {
        bl.append(new Buffer(arguments[i], 'utf8'));
        bl.append(new Buffer('\r\n', 'ascii'));
    }

    return bl;
}

function pass(obj, cb) {
    var protocolEmitter = new ProtocolEmitter();
    var bl = new BufferList(cb);

    protocolEmitter.pipe(bl);
    protocolEmitter.end(obj);
}
