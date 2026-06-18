# Tribunus Compute Core Architecture

This crate is not a normal inference wrapper.
It is the authority substrate for Tribunus compute. Its job is to make runtime work, backend execution, tensor memory, storage state, receipts, and recovery mechanically checkable before agents are allowed to automate them.

## Storage Truth Doctrine

Tribunus does not have three storage truths.
- **PGlite/PostgreSQL** owns durable authority.
- **Valkey** owns coordination visibility and recoverable pending work.
- **DuckDB** owns analytical projection.
- **Rust** owns the contract that prevents them from disagreeing.

### Truth Table

| Layer | Responsibility | Authority Status |
|---|---|---|
| PGlite/PostgreSQL | Durable Authority | **Primary Truth** |
| Valkey | Coordination Visibility | Provisional |
| DuckDB | Analytical Projection | Derived |
| Tokio | Local Execution | Ephemeral |
| IOSurface | Tensor-Memory Truth | Hardware |
| MLX/Core ML | Backend Execution | Derived |

### Invariants

- A Valkey ack is not truth.
- A DuckDB projection is not truth.
- A backend result is not truth.
- Only a durable receipt can become authority.
- A Valkey terminal state without a PGlite receipt is a violation.
- A DuckDB projection row without a durable receipt reference is a violation.
