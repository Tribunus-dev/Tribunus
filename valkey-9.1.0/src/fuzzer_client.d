fuzzer_client.o: fuzzer_client.c \
  ../deps/libvalkey/include/valkey/valkey.h \
  ../deps/libvalkey/include/valkey/read.h \
  ../deps/libvalkey/include/valkey/visibility.h \
  ../deps/libvalkey/include/valkey/alloc.h fuzzer_command_generator.h \
  sds.h adlist.h cli_common.h
