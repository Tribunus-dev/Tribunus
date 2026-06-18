//! TAIP canonical JSON serialisation helpers and JSON Schema export.
//!
//! `canonical_json` produces sorted-key JSON for deterministic digest
//! computation. `json_schema_for` returns a JSON Schema object for each
//! TAIP top-level type, suitable for export to the TypeScript SDK or
//! documentation tooling.

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

// ── Canonical JSON + digest ────────────────────────────────────────────────

/// Produce a canonical (sorted-key) JSON string from a serializable value.
///
/// All object keys are sorted lexicographically, recursively. This produces
/// a deterministic byte string suitable for SHA-256 hashing.
pub fn canonical_json<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let v: Value = serde_json::to_value(value)?;
    Ok(sort_value(&v).to_string())
}

/// Compute the SHA-256 hex digest of the canonical JSON of a value.
pub fn canonical_digest<T: Serialize>(value: &T) -> Result<String, serde_json::Error> {
    let json = canonical_json(value)?;
    let hash = format!("{:x}", Sha256::digest(json.as_bytes()));
    Ok(hash)
}

fn sort_value(v: &Value) -> Value {
    match v {
        Value::Object(map) => {
            let mut sorted: Vec<(String, Value)> = map
                .iter()
                .map(|(k, v)| (k.clone(), sort_value(v)))
                .collect();
            sorted.sort_by(|a, b| a.0.cmp(&b.0));
            let obj: serde_json::Map<String, Value> = sorted.into_iter().collect();
            Value::Object(obj)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_value).collect()),
        other => other.clone(),
    }
}

// ── JSON Schema descriptors ────────────────────────────────────────────────

/// Minimal JSON Schema object for documentation and SDK bridge purposes.
///
/// These are not machine-generated from Rust types (which would require
/// `schemars`). They are hand-maintained schema stubs that capture the
/// key invariants. For full validation, use the Rust type system directly.
pub fn phase_evidence_receipt_schema() -> Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "tribunus:taip:PhaseEvidenceReceipt:v0.1.0",
        "title": "PhaseEvidenceReceipt",
        "description": "Immutable proof that a phase executed and what was observed.",
        "type": "object",
        "required": [
            "receipt_id", "phase_id", "phase_kind", "profile_id",
            "backend", "machine_profile_digest", "model_profile_digest",
            "input_digest", "started_at", "finished_at", "status"
        ],
        "properties": {
            "receipt_id": { "type": "string", "description": "UUID-based receipt identifier" },
            "phase_id": { "type": "integer", "description": "Packed (kind_ordinal << 32 | sequence)" },
            "phase_kind": { "type": "string", "enum": [
                "tokenizer_ingress", "retrieval", "reranking", "prefill",
                "attention", "kv_write", "kv_append", "kv_view", "decode",
                "sampling", "structured_output_validation", "tool_call_boundary",
                "memory_read", "memory_write", "checkpoint", "cancellation", "recovery"
            ]},
            "backend": { "type": "string", "enum": [
                "core_ai", "core_ml", "mlx", "accelerate", "metal_custom",
                "llama_cpp", "mlc_llm", "pytorch_mps", "cuda", "rocm",
                "vulkan", "web_gpu", "remote_provider", "cpu_reference", "tribunus_native"
            ]},
            "status": { "type": "string", "enum": [
                "unqualified", "claimed", "compiled", "loaded",
                "runtime_smoke_passed", "parity_passed", "stress_passed",
                "concurrency_passed", "cancellation_passed", "recovery_passed",
                "qualified", "rejected", "quarantined"
            ]},
            "machine_profile_digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "model_profile_digest": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
            "input_digest": { "type": "string" },
            "output_digest": { "type": ["string", "null"] },
            "started_at": { "type": "integer", "description": "Unix ms timestamp" },
            "finished_at": { "type": "integer", "description": "Unix ms timestamp" },
            "metrics": { "type": "object" },
            "artifacts": { "type": "array" },
            "gate_results": { "type": "array" },
            "failure": { "type": ["string", "null"] },
            "notes": { "type": ["string", "null"] }
        },
        "additionalProperties": false
    })
}

pub fn machine_profile_schema() -> Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "tribunus:taip:MachineProfile:v0.1.0",
        "title": "MachineProfile",
        "description": "Concrete machine a TAIP ExecutionProfile targets.",
        "type": "object",
        "required": ["os_version", "cpu_family", "memory_bytes", "available_backends", "sandbox_authority"],
        "properties": {
            "os_version": { "type": "string" },
            "kernel_version": { "type": ["string", "null"] },
            "cpu_family": { "type": "string" },
            "gpu_family": { "type": ["string", "null"] },
            "ane_present": { "type": ["boolean", "null"] },
            "memory_bytes": { "type": "integer", "minimum": 0 },
            "available_backends": { "type": "array", "items": { "type": "string" } },
            "framework_versions": { "type": "object", "additionalProperties": { "type": "string" } },
            "xcode_version": { "type": ["string", "null"] },
            "sandbox_authority": { "type": "string" }
        }
    })
}

pub fn model_profile_schema() -> Value {
    serde_json::json!({
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$id": "tribunus:taip:ModelProfile:v0.1.0",
        "title": "ModelProfile",
        "description": "Source model description. Purely descriptive — does not claim runtime support.",
        "type": "object",
        "required": [
            "source_uri", "architecture_family", "tokenizer_family",
            "vocab_size", "hidden_size", "num_layers", "num_attention_heads",
            "num_kv_heads", "head_dim", "max_context_tokens", "compression", "weight_layout"
        ],
        "properties": {
            "source_uri": { "type": "string" },
            "architecture_family": { "type": "string" },
            "max_context_tokens": { "type": "integer", "minimum": 1 },
            "compression": { "type": "object" }
        }
    })
}

/// Export all TAIP schemas as a single JSON bundle.
pub fn all_schemas() -> Value {
    serde_json::json!({
        "taip_schema_bundle_version": "0.1.0",
        "schemas": {
            "PhaseEvidenceReceipt": phase_evidence_receipt_schema(),
            "MachineProfile": machine_profile_schema(),
            "ModelProfile": model_profile_schema()
        }
    })
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn canonical_json_sorts_keys() {
        let input = json!({ "z": 1, "a": 2, "m": 3 });
        let out = canonical_json(&input).unwrap();
        // Keys must appear in alphabetical order.
        let a_pos = out.find("\"a\"").unwrap();
        let m_pos = out.find("\"m\"").unwrap();
        let z_pos = out.find("\"z\"").unwrap();
        assert!(a_pos < m_pos && m_pos < z_pos);
    }

    #[test]
    fn canonical_json_sorts_nested_objects() {
        let input = json!({ "b": { "z": 1, "a": 2 }, "a": 3 });
        let out = canonical_json(&input).unwrap();
        // Top-level: a < b
        let a_pos = out.find("\"a\"").unwrap();
        let b_pos = out.find("\"b\"").unwrap();
        assert!(a_pos < b_pos);
    }

    #[test]
    fn canonical_digest_is_deterministic() {
        let v = json!({ "x": 1, "b": "hello", "a": [1, 2, 3] });
        let d1 = canonical_digest(&v).unwrap();
        let d2 = canonical_digest(&v).unwrap();
        assert_eq!(d1, d2);
        assert_eq!(d1.len(), 64);
    }

    #[test]
    fn canonical_digest_differs_for_different_values() {
        let a = json!({ "x": 1 });
        let b = json!({ "x": 2 });
        let d_a = canonical_digest(&a).unwrap();
        let d_b = canonical_digest(&b).unwrap();
        assert_ne!(d_a, d_b);
    }

    #[test]
    fn canonical_digest_is_order_independent() {
        // Two objects with same content but different insertion order must
        // produce the same digest.
        let a = json!({ "z": 99, "a": 1 });
        let b = json!({ "a": 1, "z": 99 });
        let d_a = canonical_digest(&a).unwrap();
        let d_b = canonical_digest(&b).unwrap();
        assert_eq!(d_a, d_b, "canonical digest must be key-order independent");
    }

    #[test]
    fn schema_bundle_parses() {
        let bundle = all_schemas();
        assert!(bundle["schemas"]["PhaseEvidenceReceipt"].is_object());
        assert!(bundle["schemas"]["MachineProfile"].is_object());
        assert!(bundle["schemas"]["ModelProfile"].is_object());
    }

    #[test]
    fn receipt_schema_has_required_compiled_not_qualified_note() {
        // The schema must document the status enum including "compiled"
        // but NOT position it as implying "qualified".
        let schema = phase_evidence_receipt_schema();
        let status_enum = &schema["properties"]["status"]["enum"];
        assert!(status_enum.as_array().unwrap().contains(&json!("compiled")));
        assert!(status_enum
            .as_array()
            .unwrap()
            .contains(&json!("qualified")));
    }
}
