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

#include <node.h>
#include <v8.h>
#include <node_buffer.h>

#include "Crc64.h"

using namespace v8;
using namespace node;

extern "C"
uint64_t crc64(uint64_t crc, const unsigned char *s, uint64_t l);

void Crc64::Init(Handle<Object> exports) {
    Local<FunctionTemplate> tpl = FunctionTemplate::New(New);

    tpl->SetClassName(String::NewSymbol("Crc64"));
    tpl->InstanceTemplate()->SetInternalFieldCount(1);
    tpl->PrototypeTemplate()->Set(String::NewSymbol("push"), FunctionTemplate::New(Push)->GetFunction());
    tpl->PrototypeTemplate()->Set(String::NewSymbol("value"), FunctionTemplate::New(GetValue)->GetFunction());

    Persistent<Function> constructor = Persistent<Function>::New(tpl->GetFunction());
    exports->Set(String::NewSymbol("Crc64"), constructor);
}

Crc64::Crc64() {
    crc = 0;
}

Crc64::~Crc64() {}

Handle<Value> Crc64::New(const Arguments& args) {
    if (args.Length() != 0) {
        return ThrowException(Exception::Error(String::New("Unexpected arguments")));
    }

    HandleScope scope;
    Crc64* obj = new Crc64();
    obj->Wrap(args.This());
    return args.This();
}

Handle<Value> Crc64::Push(const Arguments& args) {
    if (args.Length() != 1 || !Buffer::HasInstance(args[0])) {
        return ThrowException(Exception::Error(String::New("Expecting a single Buffer argument")));
    }

    HandleScope scope;
    Crc64* obj = ObjectWrap::Unwrap<Crc64>(args.This());
    Local<Object> bytes = args[0]->ToObject();

    obj->crc = crc64(obj->crc, (unsigned char *)Buffer::Data(bytes), Buffer::Length(bytes));

    return Undefined();
}

Handle<Value> Crc64::GetValue(const Arguments& args) {
    if (args.Length() != 0) {
        return ThrowException(Exception::Error(String::New("Unexpected arguments")));
    }

    HandleScope scope;
    Crc64* obj = ObjectWrap::Unwrap<Crc64>(args.This());
    Buffer* BufferOut = Buffer::New((char*)&(obj->crc), sizeof(uint64_t));
    return scope.Close(BufferOut->handle_);
}

extern "C"
void init(Handle<Object> exports) {
    Crc64::Init(exports);
}

NODE_MODULE(Crc64, init)
