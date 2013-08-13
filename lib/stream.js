var assert = require('assert');
var debug = require('debug')('stream-parser');

module.exports = Parser;

/**
 * The `Parser` stream mixin works with `Transform` stream
 * instances/subclasses. Provides a convenient generic "parsing" API:
 *
 *   _bytes(n, cb) - buffers "n" bytes and then calls "cb" with the "chunk"
 *
 * @param {Stream} stream Transform instance to extend
 * @api public
 */

function Parser (transformInstancePrototype) {
  var isTransform = transformInstancePrototype && 'function' == typeof transformInstancePrototype._transform;

  if (!isTransform) throw new Error('must pass a Transform stream in');
  debug('extending Parser into stream');

  transformInstancePrototype._bytes = _bytes;
  transformInstancePrototype._transform = transform;
}

function init (stream) {
  debug('initializing parser stream');

  // number of bytes left to parser for the next "chunk"
  stream._parserBytesLeft = 0;

  // array of Buffer instances that make up the next "chunk"
  stream._parserBuffers = [];

  // number of bytes parsed so far for the next "chunk"
  stream._parserBuffered = 0;

  // the callback for the next "chunk"
  stream._parserCallback = null;

  stream._parserOutput = stream.push.bind(stream);

  stream._parserInit = true;
}

/**
 * Buffers `n` bytes and then invokes `fn` once that amount has been collected.
 *
 * @param {Number} n the number of bytes to buffer
 * @param {Function} fn callback function to invoke when `n` bytes are buffered
 * @api public
 */

function _bytes (n, fn) {
  assert(!this._parserCallback, 'there is already a "callback" set!');
  assert(isFinite(n) && n > 0, 'can only buffer a finite number of bytes > 0, got "' + n + '"');
  if (!this._parserInit) init(this);
  debug('buffering "%d" bytes', n);
  this._parserBytesLeft = n;
  this._parserCallback = fn;
}

function transform (chunk, encoding, fn) {
  if (!this._parserInit) init(this);
  debug('transform(%d bytes)', chunk.length);
  data(this, chunk, fn);
}

/**
 * The internal buffering/passthrough logic...
 *
 * This `_data` function get's "trampolined" to prevent stack overflows for tight
 * loops. This technique requires us to return a "thunk" function for any
 * synchronous action. Async stuff breaks the trampoline, but that's ok since it's
 * working with a new stack at that point anyway.
 *
 * @api private
 */

function _data (stream, chunk, fn) {
  assert(stream._parserBytesLeft > 0, 'got data but not currently parsing anything');

  if (chunk.length <= stream._parserBytesLeft) {
    // small buffer fits within the "_parserBytesLeft" window
    return function() {
      return process(stream, chunk, fn);
    }
  } else {
    // large buffer needs to be sliced on "_parserBytesLeft" and processed
    return function() {
      var b = chunk.slice(0, stream._parserBytesLeft);
      return process(stream, b, function (err) {
        if (err) return fn(err);
        if (chunk.length > b.length) {
          return function() {
            return _data(stream, chunk.slice(b.length), fn);
          };
        }
      });
    };
  }
}

/**
 * The internal `process` function gets called by the `data` function when
 * something "interesting" happens. This function takes care of buffering the
 * bytes when buffering, passing through the bytes when doing that, and invoking
 * the user callback when the number of bytes has been reached.
 *
 * @api private
 */

function process (stream, chunk, fn) {
  stream._parserBytesLeft -= chunk.length;
  debug('%d bytes left for stream piece', stream._parserBytesLeft);

  stream._parserBuffers.push(chunk);
  stream._parserBuffered += chunk.length;

  if (0 === stream._parserBytesLeft) {
    // done with stream "piece", invoke the callback
    var cb = stream._parserCallback;
    if (cb && stream._parserBuffers.length > 1) {
      chunk = Buffer.concat(stream._parserBuffers, stream._parserBuffered);
    }
    stream._parserCallback = null;
    stream._parserBuffered = 0;
    stream._parserBuffers.splice(0); // empty

    if (cb) {
      cb.apply(stream, [chunk, stream._parserOutput]);
      return fn;
    }
  } else {
    // need more bytes
    fn();
  }
}

var data = trampoline(_data);

/**
 * Generic thunk-based "trampoline" helper function.
 *
 * @param {Function} input function
 * @return {Function} "trampolined" function
 * @api private
 */

function trampoline (fn) {
  var name = fn.name;
  return function () {
    var result = fn.apply(this, arguments);

    while ('function' == typeof result) {
      result = result();
    }

    return result;
  };
}
