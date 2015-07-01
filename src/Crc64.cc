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

#include "nan.h"

using namespace v8;
using namespace node;


extern "C"
uint64_t crc64(uint64_t crc, const unsigned char *s, uint64_t l);


class Crc64 : public ObjectWrap {

public:

  static void Init(Handle<Object> exports) {
    NanScope();
    Local<FunctionTemplate> tmpl = NanNew<FunctionTemplate>(Crc64::New);

    tmpl->SetClassName(NanNew("Crc64"));
    tmpl->InstanceTemplate()->SetInternalFieldCount(1);

    NODE_SET_PROTOTYPE_METHOD(tmpl, "push",  Push);
    NODE_SET_PROTOTYPE_METHOD(tmpl, "value", GetValue);

    NanAssignPersistent(functionTemplate, tmpl);
    NanAssignPersistent(constructor, tmpl->GetFunction());
    exports->Set(NanNew("Crc64"), tmpl->GetFunction());
  }

private:

  Crc64() {
    crc = 0;
  }

  ~Crc64() {
  }

  static NAN_METHOD(New) {
    NanScope();
    Crc64* instance = new Crc64();
    instance->Wrap(args.This());
    NanReturnThis();
  }

  static NAN_METHOD(Push) {
    NanScope();
    if (args.Length() != 1 || !Buffer::HasInstance(args[0]))
      return NanThrowError("Expecting a single Buffer argument");

    Crc64* instance = ObjectWrap::Unwrap<Crc64>(args.Holder());
    Local<Object> bytes = args[0]->ToObject();
    instance->crc = crc64(instance->crc, (unsigned char *)Buffer::Data(bytes), Buffer::Length(bytes));
    NanReturnUndefined();
  }

  static NAN_METHOD(GetValue) {
    NanScope();
    if (args.Length() != 0)
      return NanThrowError("Unexpected arguments");

    Crc64* instance = ObjectWrap::Unwrap<Crc64>(args.Holder());
    Local<Object> BufferOut = NanNewBufferHandle((char*)&(instance->crc), sizeof(uint64_t));
    NanReturnValue(BufferOut);
  }

  static Persistent<FunctionTemplate> functionTemplate;
  static Persistent<Function>         constructor;

  uint64_t crc;
};


Persistent<FunctionTemplate> Crc64::functionTemplate;
Persistent<Function>         Crc64::constructor;


extern "C" {

  static void init(Handle<Object> exports) {
    Crc64::Init(exports);
  }

  NODE_MODULE(Crc64, init)
};
