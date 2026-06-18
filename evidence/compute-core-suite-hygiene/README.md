# compute-core suite hygiene

This ledger records the current broader `compute-core` library failures observed while preserving the verified `runtime_contract` gates.

The contract gates that remain non-negotiable are:

`cargo test -p tribunus-compute-core --lib runtime_contract --no-run`

`cargo test -p tribunus-compute-core --lib runtime_contract -- --nocapture --test-threads=1`

`cargo test -p tribunus-compute-core --test coverage_lattice_authority`

The broader suite classification below is intentionally separate. These failures do not block the new runtime contract skeleton.

