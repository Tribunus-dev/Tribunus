# ADR Alignment Inventory

This inventory classifies the ADR corpus against the ACR board and the runtime truth spine.

Current classification summary:

| Status | Count |
|---|---:|
| aligned | 12 |
| needs_wording_cleanup | 7 |
| compatibility-only | 6 |
| needs_component_imports | 0 |
| superseded | 0 |
| conflict | 0 |

The aligned set now includes the runtime spine ADRs and the imported control-plane/runtime contracts. Remaining wording cleanup is concentrated in the older federation, SDK, schema, and design-adjacent ADRs. Compatibility-only ADRs stay transitional and are not treated as runtime doctrine.

OpenCode compatibility references are treated as migration affordances only.
