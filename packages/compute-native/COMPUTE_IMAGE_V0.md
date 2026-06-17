# Compute Image v0

ComputeImageV0 is the evidence-backed compiler placement artifact, not the runtime inference image.

## Evidence Source Kinds
* `synthetic_fixture`: Used for testing and CI validation.
* `normalized_json`: True evidence retrieved from gates.

## Verdicts
* `usable`: All required phases have selected runtime-qualified Pass evidence.
* `usable_with_fallbacks`: Phases are complete, but degraded fallbacks or structural KV caching was explicitly allowed.
* `blocked`: Execution cannot be trusted due to missing passing evidence or validation checks failing.

## Backend Statuses
* `Pass`: The upstream adapter has already verified the full runtime path, not just MIL construction.
* `CompileLimited`: The phase could only be compiled but not executed correctly.
* `NumericalDivergence`: The phase executed but output significantly diverged from truth.
* `ContractOnly`: Only shape and typing contracts were evaluated. Can only be applied to KV cache phases when permitted.
* `RuntimeQualified`: Evidence explicitly proves proper runtime execution.

## CLI Usage

Generate using synthetic evidence fixture:
```sh
tribunus-compute-image emit-v0 --output-dir /tmp/out --synthetic-fixture
```

Generate using normalized gate evidence:
```sh
tribunus-compute-image emit-v0 --output-dir /tmp/out \
    --evidence /path/to/evidence.json \
    --run-id 12345 --git-commit abcdef \
    --device-profile apple_m3_max --model-profile gemma2-9b \
    --shape-profile batch_1_seq_1 --dtype f16 \
    --compute-policy strict_truth --evidence-root /path/to/evidence
```

Verify emitted image:
```sh
tribunus-compute-image verify-v0 --image /tmp/out
```
