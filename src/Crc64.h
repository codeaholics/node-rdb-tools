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

#ifndef CRC64_H
#define CRC64_H

#include <node.h>
#include <v8.h>

using namespace node;
using namespace v8;

class Crc64 : public ObjectWrap {
 public:
  static void Init(Handle<Object> exports);

 private:
  Crc64();
  ~Crc64();

  static Handle<Value> New(const Arguments& args);
  static Handle<Value> Push(const Arguments& args);
  static Handle<Value> GetValue(const Arguments& args);

  uint64_t crc;
};

#endif
