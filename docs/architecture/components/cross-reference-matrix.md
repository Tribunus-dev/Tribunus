# ADR to ACR Cross Reference Matrix

ADR 0021 imports ACR 0001 through 0010 and defines the IOSurface runtime island plus Tokio-Valkey orchestration.

ADR 0022 imports ACR 0001 through 0005 and defines the runtime truth spine and receipt-before-ack ordering.

ADR 0004, ADR 0014, ADR 0015, ADR 0016, ADR 0017, ADR 0018, ADR 0019, ADR 0020, ADR 0023, ADR 0024, ADR 0025, ADR 0027, and ADR 0028 now import the relevant ACRs directly rather than carrying the truth table locally.

The matrix is intentionally narrow and focused on the runtime-control surfaces that still interact with the shared authority vocabulary.
