valkey-cli.o: valkey-cli.c fmacros.h \
  ../deps/libvalkey/include/valkey/valkey.h \
  ../deps/libvalkey/include/valkey/read.h \
  ../deps/libvalkey/include/valkey/visibility.h \
  ../deps/libvalkey/include/valkey/alloc.h sds.h dict.h mt19937-64.h \
  adlist.h zmalloc.h ../deps/linenoise/linenoise.h anet.h ae.h \
  monotonic.h connection.h cli_common.h util.h cli_commands.h commands.h \
  valkey_strtod.h
