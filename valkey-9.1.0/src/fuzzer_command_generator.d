fuzzer_command_generator.o: fuzzer_command_generator.c fmacros.h \
  ../deps/libvalkey/include/valkey/valkey.h \
  ../deps/libvalkey/include/valkey/read.h \
  ../deps/libvalkey/include/valkey/visibility.h \
  ../deps/libvalkey/include/valkey/alloc.h commands.h \
  fuzzer_command_generator.h sds.h dict.h mt19937-64.h zmalloc.h util.h
