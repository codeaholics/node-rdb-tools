var debug = require('debug')('rdbp'),
    Transform = require('stream').Transform,
    Parser = require('stream-parser'),
    lzf = require('lzf'),
    util = require('util'),
    Int64 = require('int64-native');

module.exports = RdbParser;

util.inherits(RdbParser, Transform);

Parser(RdbParser.prototype);

function RdbParser(options) {
    if (!(this instanceof RdbParser)) {
        return new RdbParser(options);
    }

    Transform.call(this, {objectMode: true});

    options = options || {};

    var self = this;
    var currentDatabase = 0;
    var encoding = options.encoding || 'utf8';

    self._bytes(9, onMagic);

    function onMagic(buffer, output) {
        debug('checking magic header');

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

        self._bytes(1, onRecord);
    }

    function onRecord(buffer, output) {
        debug('parsing record');
        if (buffer[0] === 0xFF) {
            debug('eof record');
            output({type: 'end'});
            self._bytes(8, onCRC);
        } else if (buffer[0] === 0xFE) {
            debug('database record');
            onDatabase();
        } else if (buffer[0] === 0xFD) {
            debug('key/value with expiry in secs');
            onExpirySecs();
        } else if (buffer[0] === 0xFC) {
            debug('key/value with expiry in millis');
            onExpiryMillis();
        } else {
            debug('key/value with no expiry');
            onKey(undefined, buffer[0], output);
        }
    }

    function onCRC(buffer, output) {
        // TODO: CRC check
        //throw new Error('CRC not implemented');
    }

    function onDatabase() {
        getLengthEncoding(function(n, special, output) {
            if (special) throw new Error('Unexpected special encoding in database record');

            currentDatabase = n;
            output({
                type: 'database',
                number: currentDatabase
            });
            self._bytes(1, onRecord);
        });
    }

    function onExpirySecs() {
        self._bytes(5, function(buffer, output) {
            onKey(buffer.readInt32LE(0), buffer[4]);
        });
    }

    function onExpiryMillis(buffer, output) {
        self._bytes(9, function(buffer, output) {
            var low = buffer.readUInt32LE(0),
                high = buffer.readUInt32LE(4),
                expiryMillis = (new Int64(high, low)).valueOf(); // +inf if > 1<<53

            onKey(expiryMillis, buffer[8]);
        });
    }

    function onKey(expiry, valueType) {
        debug('value type ' + valueType);
        getBytes(function(keyBuffer, output) {
            debug('key: ' + keyBuffer.toString(encoding));
            var object = {
                type: 'key',
                database: currentDatabase,
                key: keyBuffer.toString(encoding),
                expiry: expiry
            };

            switch(valueType) {
                case 0:
                    debug('decoding string');
                    onStringEncodedValue(object);
                    break;
                case 1:
                    debug('decoding list');
                    onListEncodedValue(object);
                    break;
                case 2:
                    debug('decoding set');
                    onSetEncodedValue(object);
                    break;
                case 3:
                    debug('decoding sorted set');
                    onSortedSetEncodedValue(object);
                    break;
                case 4:
                    debug('decoding hash');
                    onHashEncodedValue(object);
                    break;
                case 9:
                    debug('decoding zipmap');
                    onZipMapEncodedValue(object);
                    break;
                case 10:
                    debug('decoding ziplist');
                    onZipListEncodedValue(object);
                    break;
                case 11:
                    debug('decoding intset');
                    onIntSetEncodedValue(object);
                    break;
                case 12:
                    debug('decoding ziplist encoded sorted set');
                    onZipListEncodedSortedSetValue(object);
                    break;
                case 13:
                    debug('decoding ziplist encoded hash');
                    onZipListEncodedHashValue(object);
                    break;
            }
        });
    }

    function onStringEncodedValue(object) {
        getBytes(function(value, output) {
            object.value = value.toString(encoding);
            output(object);
            self._bytes(1, onRecord);
        })
    }

    function onListEncodedValue(object) {
        getLengthEncoding(function(n, special, output) {
            if (special) throw new Error('Unexpected special length encoding in list');

            object.value = [];

            function next(n) {
                if (n > 0) {
                    getListEntry(n - 1);
                } else {
                    output(object);
                    self._bytes(1, onRecord);
                }
            }

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
                    self._bytes(1, onRecord);
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
            self._bytes(1, onRecord);
        })
    }

    // function onIntSetEncodedValue(object) {
    //     getBytes(function(intSetBuffer, output) {
    //         object.value = '<IntSet>';
    //         output(object);
    //         self._bytes(1, onRecord);
    //     });
    // }

    function onZipListEncodedValue(object) {
        getZipList(function(values, output) {
            object.value = values;
            output(object);
            self._bytes(1, onRecord);
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
            self._bytes(1, onRecord);
        });
    }

    function onZipListEncodedHashValue(object) {
        getZipList(function(values, output) {
            object.value = {};

            for (var i = 0; i < values.length; i += 2) {
                object.value[values[i]] = values[i + 1];
            }

            output(object);
            self._bytes(1, onRecord);
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

            debug('ziplist with ' + bytes + ' bytes and ' + numEntries + ' entries');

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
                    // TODO: Is this the correct byte order? I've assumed LE.
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
        debug('reading 1 byte for length encoding');
        self._bytes(1, function(buffer, output) {
            var type = buffer[0] >> 6,
                lowBits = buffer[0] & 0x3F;

            switch(type) {
                case 0:
                    debug('top bits 00xxxxxx: returning lower 6 bits: ' + lowBits);
                    cb(lowBits, false, output);
                    break;
                case 1:
                    debug('top bits 01xxxxxx: reading 1 further byte');
                    self._bytes(1, function(buffer) {
                        cb((lowBits << 8) | buffer[0], false, output);
                    });
                    break;
                case 2:
                    debug('top bits 10xxxxxx: reading 4 further bytes');
                    self._bytes(4, function(buffer) {
                        cb(buffer.readInt32BE(0), false, output);
                    });
                    break;
                case 3:
                    debug('top bits 11xxxxxx: special encoding with discriminator ' + lowBits);
                    cb(lowBits, true, output);
                    break;
            }
        })
    }

    function getBytes(cb) {
        debug('reading bytes');
        getLengthEncoding(function(n, special, output) {
            if (!special) {
                debug('standard length encoding; reading ' + n + ' bytes');
                self._bytes(n, function(buffer, output) {
                    debug(n + ' bytes read');
                    if (buffer.length != n) throw new Error('Incorrect read length');
                    cb(buffer, output);
                });
            } else {
                switch (n) {
                    case 0:
                        debug('single byte special encoding; reading 1 byte');
                        self._bytes(1, function(buffer, output) {
                            cb(new Buffer(buffer.readInt8(0) + '', encoding), output);
                        });
                        break;
                    case 1:
                        debug('double byte special encoding; reading 2 bytes');
                        self._bytes(2, function(buffer, output) {
                            cb(new Buffer(buffer.readInt16LE(0) + '', encoding), output);
                        });
                        break;
                    case 2:
                        debug('quad byte special encoding; reading 4 bytes');
                        self._bytes(4, function(buffer, output) {
                            cb(new Buffer(buffer.readInt32LE(0) + '', encoding), output);
                        });
                        break;
                    case 3:
                        debug('compressed string');
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

                self._bytes(compressedLen, function(buffer, output) {
                    var decompressed = lzf.decompress(buffer);
                    debug('decompressed data: ' + util.inspect(decompressed));
                    cb(decompressed, output);
                });
            });
        })
    }
}
