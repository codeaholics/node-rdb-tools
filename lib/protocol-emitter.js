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

var Transform = require('stream').Transform,
    util = require('util'),
    crlf = new Buffer('\r\n', 'ascii');

exports = module.exports = ProtocolEmitter;

util.inherits(ProtocolEmitter, Transform);

function ProtocolEmitter(options) {
    if (!(this instanceof ProtocolEmitter)) {
        return new ProtocolEmitter(options);
    }

    Transform.call(this, {objectMode: true});

    options = options || {};

    var self = this;
    var encoding = options.encoding || 'utf8';

    self._transform = function(obj, encoding, cb) {
        if (util.isArray(obj)) {
            handleArray(obj);
            cb();
        } else {
            cb(new Error('Unexpected chunk received'));
        }
    }

    function handleArray(obj) {
        self.push('*' + obj.length, 'ascii');
        self.push(crlf);

        for (var i = 0; i < obj.length; i++) {
            var value = new Buffer(obj[i], encoding);
            self.push('$' + value.length, 'ascii');
            self.push(crlf);
            self.push(value);
            self.push(crlf);
        }
    }
}
