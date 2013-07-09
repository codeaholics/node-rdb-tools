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

var assert = require('chai').assert,
    bufferEqual = require('buffer-equal'),
    Crc64 = require('../build/Release/Crc64.node').Crc64;

describe('CRC', function() {
    var expected = new Buffer([0xCA, 0xD9, 0xB8, 0xC4, 0x14, 0xD9, 0xC6, 0xE9]);

    it('should calculate CRC-64 for byte array', function() {
        var crc = new Crc64(),
            data = new Buffer('123456789', 'ascii');

        crc.push(data);

        assert.isTrue(bufferEqual(crc.value(), expected));
    });

    it('should calculate CRC-64 for multiple byte arrays', function() {
        var crc = new Crc64(),
            data1 = new Buffer('12', 'ascii'),
            data2 = new Buffer('345', 'ascii'),
            data3 = new Buffer('6789', 'ascii');

        crc.push(data1);
        crc.push(data2);
        crc.push(data3);

        assert.isTrue(bufferEqual(crc.value(), expected));
    });
})
