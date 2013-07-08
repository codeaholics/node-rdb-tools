var Transform = require('stream').Transform,
    StreamParser = require('stream-parser'),
    lzf = require('lzf'),
    util = require('util'),
    bufferEqual = require('buffer-equal'),
    Int64 = require('int64-native'),
    Crc64 = require('../build/Release/Crc64.node').Crc64;

exports = module.exports = Parser;

util.inherits(Parser, Transform);

StreamParser(Parser.prototype);

function Parser(options) {
    if (!(this instanceof Parser)) {
        return new Parser(options);
    }

    Transform.call(this, {objectMode: true});

    options = options || {};

    var self = this;
    var currentDatabase = 0;
    var encoding = options.encoding || 'utf8';
    var crc = new Crc64();
    var emptyCrc = new Buffer(8);

    emptyCrc.fill(0);

    bytes(9, onMagic);

    function onMagic(buffer, output) {

        var magic = buffer.toString('ascii', 0, 9);

        if (!(magic.substr(0, 5) === 'REDIS')) {
            throw new Error('Not a Redis RDB. Invalid magic header.');
        }

        var version = parseInt(magic.substr(5, 4));

        if (version !== 6) {
            // throw new Error('Can only parse version 6 RDB files. This file is version ' + version + '.');
        }

        output({
            type: 'header',
            version: version
        });

        nextRecord();
    }

    function onRecord(buffer, output) {
        if (buffer[0] === 0xFF) {
            output({type: 'end'});
            // Bind and pass the CRC value here so that reading the next 8 bytes doesn't affect it
            bytes(8, onCRC.bind(self, crc.value()));
        } else if (buffer[0] === 0xFE) {
            onDatabase();
        } else if (buffer[0] === 0xFD) {
            onExpirySecs();
        } else if (buffer[0] === 0xFC) {
            onExpiryMillis();
        } else {
            onKey(undefined, buffer[0], output);
        }
    }

    function onCRC(crc, buffer, output) {
        if (!bufferEqual(buffer, emptyCrc)) { // Redis will write 8 zeros if CRC is disabled in config
            if (!bufferEqual(crc, buffer)) throw new Error('Checksum didn\'t match. Possible file corruption.');
        }

        output({type: 'crc'});

        // TODO: EOF check
    }

    function onDatabase() {
        getLengthEncoding(function(n, special, output) {
            if (special) throw new Error('Unexpected special encoding in database record');

            currentDatabase = n;
            output({
                type: 'database',
                number: currentDatabase
            });
            nextRecord();
        });
    }

    function onExpirySecs() {
        bytes(5, function(buffer, output) {
            onKey(buffer.readInt32LE(0), buffer[4]);
        });
    }

    function onExpiryMillis(buffer, output) {
        bytes(9, function(buffer, output) {
            var low = buffer.readUInt32LE(0),
                high = buffer.readUInt32LE(4),
                expiryMillis = (new Int64(high, low)).valueOf(); // +inf if > 1<<53

            onKey(expiryMillis, buffer[8]);
        });
    }

    function onKey(expiry, valueType) {
        getBytes(function(keyBuffer, output) {
            var object = {
                type: 'key',
                database: currentDatabase,
                key: keyBuffer.toString(encoding),
                expiry: expiry
            };

            switch(valueType) {
                case 0:
                    onStringEncodedValue(object);
                    break;
                case 1:
                    onListOrSetEncodedValue(object);
                    break;
                case 2:
                    onListOrSetEncodedValue(object);
                    break;
                case 3:
                    // The documentation doesn't describe this encoding and none of the example RDB files seem
                    // to use it! Perhaps it's never found in the wild any more?
                    throw new Error('Unsupported encoding');
                case 4:
                    onHashEncodedValue(object);
                    break;
                case 9:
                    onZipMapEncodedValue(object);
                    break;
                case 10:
                    onZipListEncodedValue(object);
                    break;
                case 11:
                    onIntSetEncodedValue(object);
                    break;
                case 12:
                    onZipListEncodedHashOrSortedSetValue(object);
                    break;
                case 13:
                    onZipListEncodedHashOrSortedSetValue(object);
                    break;
            }
        });
    }

    function onStringEncodedValue(object) {
        getBytes(function(value, output) {
            object.value = value.toString(encoding);
            output(object);
            nextRecord();
        })
    }

    function onListOrSetEncodedValue(object) {
        getLengthEncoding(function(n, special, output) {
            if (special) throw new Error('Unexpected special length encoding in list');

            object.value = [];

            function next(n) {
                if (n > 0) {
                    getListEntry(n - 1);
                } else {
                    output(object);
                    nextRecord();
                }
            }

            // This could cause a very deep stack except that we rely on the underlying _bytes() calls
            // to either unwind the stack if they need to asynchronously wait for more data, or else to
            // trampoline to avoid stack overflow.
            function getListEntry(n) {
                getBytes(function(entryBuffer) {
                    object.value.push(entryBuffer.toString(encoding));
                    next(n);
                });
            }

            next(n);
        });
    }

    function onHashEncodedValue(object) {
        getLengthEncoding(function(n, special, output) {
            if (special) throw new Error('Unexpected special length encoding in hash');

            object.value = {};

            function next(n) {
                if (n > 0) {
                    getHashEncodedPair(n - 1);
                } else {
                    output(object);
                    nextRecord();
                }
            }

            // This could cause a very deep stack except that we rely on the underlying _bytes() calls
            // to either unwind the stack if they need to asynchronously wait for more data, or else to
            // trampoline to avoid stack overflow.
            function getHashEncodedPair(n) {
                getBytes(function(keyBuffer) {
                    getBytes(function(valueBuffer, output) {
                        object.value[keyBuffer.toString(encoding)] = valueBuffer.toString(encoding);
                        next(n);
                    });
                });
            }

            next(n);
        });
    }

    function onZipMapEncodedValue(object) {
        getBytes(function(zipMapBuffer, output) {
            var i = 0,
                numEntries = zipMapBuffer[i++],
                hashKeys = [],
                hashValues = [];

            function readZipMapString(zipMapBuffer, i, hasFreeSpace, results) {
                var len = zipMapBuffer[i++];

                if (len == 253) {
                    len = zipMapBuffer.readUInt32LE(i);
                    i += 4;
                } else if (len == 254 || len == 255) {
                    throw new Error('Incorrect ZipMap string encoding');
                }

                var free = (hasFreeSpace ? zipMapBuffer[i++] : 0);

                results.push(zipMapBuffer.slice(i, i + len).toString(encoding));

                return i + len + free;
            }

            function readZipMapPair(zipMapBuffer, i) {
                i = readZipMapString(zipMapBuffer, i, false, hashKeys);
                i = readZipMapString(zipMapBuffer, i, true, hashValues);
                return i;
            }

            if (numEntries >= 254) {
                while (true) {
                    if (zipMapBuffer[i] == 255) {
                        i++;
                        break;
                    }

                    i = readZipMapPair(zipMapBuffer, i);
                }
            } else {
                for (var j = 0; j < numEntries; j++) {
                    i = readZipMapPair(zipMapBuffer, i);
                }
                if (zipMapBuffer[i++] != 255) throw new Error('ZipMap incorrectly terminated');
            }

            if (i != zipMapBuffer.length) throw new Error('ZipMap failed to occupy entire buffer');

            object.value = {};
            for (var j = 0; j < hashKeys.length; j++) {
                object.value[hashKeys[j]] = hashValues[j];
            }

            output(object);
            nextRecord();
        })
    }

    function onZipListEncodedValue(object) {
        getZipList(function(values, output) {
            object.value = values;
            output(object);
            nextRecord();
        });
    }

    function onIntSetEncodedValue(object) {
        getBytes(function(intSetBuffer, output) {
            var i = 0,
                values = [],
                entryWidth = intSetBuffer.readUInt32LE(0),
                numEntries = intSetBuffer.readUInt32LE(4);

            i += 4 + 4;

            for (var j = 1; j <= numEntries; j++) {
                switch (entryWidth) {
                    case 2:
                        values.push(intSetBuffer.readInt16LE(i) + '');
                        break;
                    case 4:
                        values.push(intSetBuffer.readInt32LE(i) + '');
                        break;
                    case 8:
                        var low = intSetBuffer.readUInt32LE(i),
                            high = intSetBuffer.readUInt32LE(i + 4);
                        values.push(new Int64(high, low).toSignedDecimalString());
                        break;
                    default:
                        throw new Error('Unexpected IntSet width');
                }

                i += entryWidth;
            }

            if (i != intSetBuffer.length) throw new Error('IntSet failed to occupy entire buffer');

            object.value = values;
            output(object);
            nextRecord();
        });
    }

    function onZipListEncodedHashOrSortedSetValue(object) {
        getZipList(function(values, output) {
            object.value = {};

            for (var i = 0; i < values.length; i += 2) {
                object.value[values[i]] = values[i + 1];
            }

            output(object);
            nextRecord();
        });
    }

    function getZipList(cb) {
        getBytes(function(zipListBuffer, output) {
            var i = 0,
                bytes = zipListBuffer.readUInt32LE(0),
                tail = zipListBuffer.readUInt32LE(4),
                numEntries = zipListBuffer.readUInt16LE(8),
                prevEntryLen = 0,
                values = [];

            i += 4 + 4 + 2;

            if (zipListBuffer.length != bytes) throw new Error('Incorrect ZipList byte length');

            for (j = 1; j <= numEntries; j++) {
                if (j == numEntries) {
                    // Validate tail
                    if (tail != i) throw new Error('Incorrect ZipList tail offset');
                }

                var startOffset = i;
                var prevLen = zipListBuffer[i++];

                if (prevLen == 254) {
                    prevLen = zipListBuffer.readUInt32LE(i);
                    i += 4;
                } else if (prevLen == 255) {
                    throw new Error('Incorrect ZipList entry length encoding');
                }

                if (prevLen != prevEntryLen) throw new Error('Incorrect ZipList encoding');

                var flag = zipListBuffer[i++];

                var value;
                if ((flag & 0xC0) == 0) {
                    var len = flag & 0x3F;
                    value = zipListBuffer.slice(i, i + len).toString(encoding);
                    i += len;
                } else if ((flag & 0xC0) == 0x40) {
                    var len = ((flag & 0x3F) << 8) | zipListBuffer[i++];
                    value = zipListBuffer.slice(i, i + len).toString(encoding);
                    i += len;
                } else if ((flag & 0xC0) == 0x80) {
                    var len = zipListBuffer.readUInt32BE(i);
                    i += 4;
                    value = zipListBuffer.slice(i, i + len).toString(encoding);
                    i += len;
                } else if ((flag & 0xF0) == 0xC0) {
                    value = zipListBuffer.readInt16LE(i) + '';
                    i += 2;
                } else if ((flag & 0xF0) == 0xD0) {
                    value = zipListBuffer.readInt32LE(i) + '';
                    i += 4;
                } else if ((flag & 0xF0) == 0xE0) {
                    var low = zipListBuffer.readUInt32LE(i),
                        high = zipListBuffer.readUInt32LE(i + 4);
                    value = new Int64(high, low).toSignedDecimalString();
                    i += 8;
                } else if (flag == 0xF0) {
                    var n = (zipListBuffer[i + 2] << 16) | (zipListBuffer[i + 1] << 8) | zipListBuffer[i];
                    // Sign extension
                    if ((n & 0x800000) != 0) n = n | 0xFF000000;
                    value = n + '';
                    i += 3;
                } else if (flag == 0xFE) {
                    value = zipListBuffer.readInt8(i) + '';
                    i += 1;
                } else if (flag >= 0xF1 && flag <= 0xFD) {
                    value = ((flag & 0x0F) - 1) + '';
                } else {
                    throw new Error('Unknown ZipList encoding: ' + flag);
                }

                values.push(value);

                prevEntryLen = i - startOffset;
            }

            if (zipListBuffer[i++] != 0xFF) throw new Error('ZipList incorrectly terminated');

            if (i != bytes) throw new Error('ZipList failed to occupy whole buffer');

            cb(values, output);
        })
    }

    function getLengthEncoding(cb) {
        bytes(1, function(buffer, output) {
            var type = buffer[0] >> 6,
                lowBits = buffer[0] & 0x3F;

            switch(type) {
                case 0:
                    cb(lowBits, false, output);
                    break;
                case 1:
                    bytes(1, function(buffer) {
                        cb((lowBits << 8) | buffer[0], false, output);
                    });
                    break;
                case 2:
                    bytes(4, function(buffer) {
                        cb(buffer.readInt32BE(0), false, output);
                    });
                    break;
                case 3:
                    cb(lowBits, true, output);
                    break;
            }
        })
    }

    function getBytes(cb) {
        getLengthEncoding(function(n, special, output) {
            if (!special) {
                bytes(n, function(buffer, output) {
                    if (buffer.length != n) throw new Error('Incorrect read length');
                    cb(buffer, output);
                });
            } else {
                switch (n) {
                    case 0:
                        bytes(1, function(buffer, output) {
                            cb(new Buffer(buffer.readInt8(0) + '', encoding), output);
                        });
                        break;
                    case 1:
                        bytes(2, function(buffer, output) {
                            cb(new Buffer(buffer.readInt16LE(0) + '', encoding), output);
                        });
                        break;
                    case 2:
                        bytes(4, function(buffer, output) {
                            cb(new Buffer(buffer.readInt32LE(0) + '', encoding), output);
                        });
                        break;
                    case 3:
                        getCompressedString(cb);
                        break;
                    default:
                        throw new Error('Unknown encoding encountered: ' + n);
                }
            }
        });
    }

    function getCompressedString(cb) {
        getLengthEncoding(function(compressedLen, special, output) {
            if (special) throw new Error('Unexpected special encoding');

            getLengthEncoding(function(uncompressedLen, special, output){
                if (special) throw new Error('Unexpected special encoding');

                bytes(compressedLen, function(buffer, output) {
                    var decompressed = lzf.decompress(buffer);
                    cb(decompressed, output);
                });
            });
        })
    }

    function nextRecord() {
        bytes(1, onRecord);
    }

    function bytes(n, cb) {
        self._bytes(n, function(buffer) {
            crc.push(buffer);
            cb.apply(self, arguments);
        });
    }
}
