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
