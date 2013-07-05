var Parser = require('../rdbp').Parser,
    parser = new Parser(),
    Writable = require('stream').Writable;

var writable = new Writable({objectMode: true});
writable._write = function(chunk, encoding, cb) {
    console.log(chunk);
    cb();
};

process.stdout.on('error', function(err) {
    if (err.code === 'EPIPE') {
        process.exit(0);
    }
})

process.stdin.pipe(parser).pipe(writable);
