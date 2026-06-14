# ADR Alignment Migration Report

## What changed

The corpus now explicitly distinguishes the runtime truth spine from legacy compatibility and presentation-layer ADRs. The runtime/control-plane ADRs import the ACR board directly where they need shared truth ownership.

## What is superseded

No ADRs were marked fully superseded in this pass.

## What was intentionally left alone

Compatibility-only ADRs remain transitional. They are recorded in the inventory so they can be cleaned up later without being mistaken for runtime doctrine.

## Remaining implementation gates

The wording-cleanup pass is complete for the currently tracked ADR alignment set. The contradiction audit is regenerated and still passes against the live board, so the remaining work is now limited to any future ADR additions or newly discovered compatibility drift.
