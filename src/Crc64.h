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
