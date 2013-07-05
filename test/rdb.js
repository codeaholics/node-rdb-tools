var RdbParser = require('../rdbp'),
    assert = require('chai').assert,
    fs = require('fs'),
    Writable = require('stream').Writable,
    _ = require('underscore');

describe('Parser', function() {
    it('should parse empty RDB', function(done) {
        load('empty_database.rdb', function(data) {
            assert.lengthOf(data['header'], 1);
            assert.lengthOf(data['end'], 1);
            assert.lengthOf(data['database'], 0);
            done();
        })
    });

    it('should handle multiple databases', function(done) {
        load('multiple_databases.rdb', function(data) {
            assert.lengthOf(data['database'], 2);
            assert.notInclude(_.pluck(data['database'], 'number'), 1);
            assert.equal(data.allKeys[0]['key_in_zeroth_database'].value, 'zero');
            assert.equal(data.allKeys[2]['key_in_second_database'].value, 'second');
            done();
        })
    });

    it('should handle keys with expiry', function(done) {
        load('keys_with_expiry.rdb', function(data) {
            assert.equal(data.allKeys[0]['expires_ms_precision'].expiry, 1671963072573);
            done();
        })
    });

    it('should handle integer keys', function(done) {
        load('integer_keys.rdb', function(data) {
            assert.equal(data.allKeys[0][125].value, 'Positive 8 bit integer');
            assert.equal(data.allKeys[0][0xABAB].value, 'Positive 16 bit integer');
            assert.equal(data.allKeys[0][0x0AEDD325].value, 'Positive 32 bit integer');
            done();
        })
    });

    it('should handle negative integer keys', function(done) {
        load('integer_keys.rdb', function(data) {
            assert.equal(data.allKeys[0][-123].value, 'Negative 8 bit integer');
            assert.equal(data.allKeys[0][-0x7325].value, 'Negative 16 bit integer');
            assert.equal(data.allKeys[0][-0x0AEDD325].value, 'Negative 32 bit integer');
            done();
        })
    });

    it('should handle compressed keys', function(done) {
        load('easily_compressible_string_key.rdb', function(data) {
            var key = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' +
                      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

            assert.equal(data.allKeys[0][key].value, 'Key that redis should compress easily');
            done();
        })
    });

    it('should handle compressible zipmaps', function(done) {
        load('zipmap_that_compresses_easily.rdb', function(data) {
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['a'], 'aa');
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['aa'], 'aaaa');
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['aaaaa'], 'aaaaaaaaaaaaaa');
            done();
        })
    });

    it('should handle non-compressible zipmaps', function(done) {
        load('zipmap_that_doesnt_compress.rdb', function(data) {
            assert.equal(data.allKeys[0]['zimap_doesnt_compress'].value['MKD1G6'], 2);
            assert.equal(data.allKeys[0]['zimap_doesnt_compress'].value['YNNXK'], 'F7TI');
            done();
        })
    });

    it('should handle zipmaps with large values', function(done) {
        load('zipmap_with_big_values.rdb', function(data) {
            assert.lengthOf(data.allKeys[0]['zipmap_with_big_values'].value['253bytes'], 253);
            assert.lengthOf(data.allKeys[0]['zipmap_with_big_values'].value['254bytes'], 254);
            assert.lengthOf(data.allKeys[0]['zipmap_with_big_values'].value['255bytes'], 255);
            assert.lengthOf(data.allKeys[0]['zipmap_with_big_values'].value['300bytes'], 300);
            assert.lengthOf(data.allKeys[0]['zipmap_with_big_values'].value['20kbytes'], 20000);
            done();
        })
    });

    it('should handle ziplist encoded hashes', function(done) {
        load('hash_as_ziplist.rdb', function(data) {
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['a'], 'aa');
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['aa'], 'aaaa');
            assert.equal(data.allKeys[0]['zipmap_compresses_easily'].value['aaaaa'], 'aaaaaaaaaaaaaa');
            done();
        })
    });

    it('should handle "the dictionary"', function(done) {
        load('dictionary.rdb', function(data) {
            assert.lengthOf(_.keys(data.allKeys[0]['force_dictionary'].value), 1000);
            assert.equal(data.allKeys[0]['force_dictionary'].value['ZMU5WEJDG7KU89AOG5LJT6K7HMNB3DEI43M6EYTJ83VRJ6XNXQ'], 'T63SOS8DQJF0Q0VJEZ0D1IQFCYTIPSBOUIAI9SB0OV57MQR1FI');
            assert.equal(data.allKeys[0]['force_dictionary'].value['UHS5ESW4HLK8XOGTM39IK1SJEUGVV9WOPK6JYA5QBZSJU84491'], '6VULTCV52FXJ8MGVSFTZVAGK2JXZMGQ5F8OVJI0X6GEDDR27RZ');
            done();
        })
    });

    it('should handle a ziplist that compresses easily', function(done) {
        load('ziplist_that_compresses_easily.rdb', function(data) {
            assert.lengthOf(data.allKeys[0]['ziplist_compresses_easily'].value, 6);
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[0], 'aaaaaa');
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[1], 'aaaaaaaaaaaa');
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[2], 'aaaaaaaaaaaaaaaaaa');
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[3], 'aaaaaaaaaaaaaaaaaaaaaaaa');
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[4], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            assert.equal(data.allKeys[0]['ziplist_compresses_easily'].value[5], 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
            done();
        })
    });

    it('should handle a ziplist that doesn\'t compress', function(done) {
        load('ziplist_that_doesnt_compress.rdb', function(data) {
            assert.lengthOf(data.allKeys[0]['ziplist_doesnt_compress'].value, 2);
            assert.include(data.allKeys[0]['ziplist_doesnt_compress'].value, 'aj2410');
            assert.include(data.allKeys[0]['ziplist_doesnt_compress'].value, 'cc953a17a8e096e76a44169ad3f9ac87c5f8248a403274416179aa9fbd852344');
            done();
        })
    });

    it('should handle ziplist with integers', function(done) {
        load('ziplist_with_integers.rdb', function(data) {
            var expected = [];

            _.times(13, function(n) { expected.push(n + ''); });
            expected = expected.concat(['-2', '13', '25', '-61', '63', '16380', '-16000', '65535', '-65523', '4194304', '9223372036854775807']);

            assert.lengthOf(data.allKeys[0]['ziplist_with_integers'].value, expected.length);
            _.each(expected, function(e) {
                assert.include(data.allKeys[0]['ziplist_with_integers'].value, e);
            });

            done();
        })
    });

    it('should handle linked lists', function(done) {
        load('linkedlist.rdb', function(data) {
            assert.lengthOf(data.allKeys[0]['force_linkedlist'].value, 1000);
            assert.include(data.allKeys[0]['force_linkedlist'].value, 'JYY4GIFI0ETHKP4VAJF5333082J4R1UPNPLE329YT0EYPGHSJQ');
            assert.include(data.allKeys[0]['force_linkedlist'].value, 'TKBXHJOX9Q99ICF4V78XTCA2Y1UYW6ERL35JCIL1O0KSGXS58S');
            done();
        })
    });

    it('should handle 16 bit intsets', function(done) {
        load('intset_16.rdb', function(data) {
            assert.lengthOf(data.allKeys[0]['intset_16'].value, 3);
            assert.include(data.allKeys[0]['intset_16'].value, '32766');
            assert.include(data.allKeys[0]['intset_16'].value, '32765');
            assert.include(data.allKeys[0]['intset_16'].value, '32764');
            done();
        })
    });

    // TO DO:
    //   * expiry in seconds
    //   * explicity testing different file format versions
    //   * CRC
    //   * ZipList encoded hash value with 3-byte encoding
})

function load(database, debug, cb) {
    if (!cb) {
        cb = debug;
        debug = false;
    }

    var readStream = fs.createReadStream('test/dumps/' + database);
    var writable = new Writable({objectMode: true});
    var parser = new RdbParser();

    var data = {
        all: [],
        header: [],
        database: [],
        key: [],
        end: [],
        allKeys: {}
    };

    writable._write = function(chunk, encoding, cb) {
        if (debug) {
            // console.log(chunk);
            // if (chunk.key) console.log(typeof(chunk.key));
        }

        data.all.push(chunk);
        data[chunk.type].push(chunk);

        if (chunk.type === 'key') {
            var key = chunk.key.toString();
            if (!data.allKeys[chunk.database]) data.allKeys[chunk.database] = {};
            data.allKeys[chunk.database][key] = chunk;
        }

        cb();
    };

    writable.on('finish', function() {
        cb(data);
    });

    readStream.pipe(parser).pipe(writable);
}
