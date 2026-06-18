valkey-benchmark.o: valkey-benchmark.c fmacros.h sds.h ae.h monotonic.h \
  ../deps/libvalkey/include/valkey/valkey.h \
  ../deps/libvalkey/include/valkey/read.h \
  ../deps/libvalkey/include/valkey/visibility.h \
  ../deps/libvalkey/include/valkey/alloc.h adlist.h dict.h mt19937-64.h \
  zmalloc.h crc16_slottable.h ../deps/hdr_histogram/hdr_histogram.h \
  cli_common.h
