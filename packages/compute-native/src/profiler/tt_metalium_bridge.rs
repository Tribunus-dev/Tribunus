use crate::backend::ttnn::TtnnReceipt;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tribunus_compute_core::inference_profile::backend::BackendKind;
use tribunus_compute_core::inference_profile::evidence::{
    EvidenceArtifactRef, EvidenceGateResult, EvidenceStatus, FailureClassification,
    PhaseEvidenceReceipt, PhaseMetrics, TimestampMs,
};
use tribunus_compute_core::inference_profile::ids::{
    MachineProfileDigest, ModelProfileDigest, PhaseId, ProfileId, ReceiptId,
};
use tribunus_compute_core::inference_profile::phase::{EvidenceRequirement, PhaseKind};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KernelTiming {
    pub core_id: u32,
    pub reader_time_us: u64,
    pub compute_time_us: u64,
    pub writer_time_us: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TtMetaliumProfilerOutput {
    pub compile_time_ms: u64,
    pub transfer_time_us: u64,
    pub queue_delay_us: u64,
    pub readback_time_us: u64,
    pub compute_time_us: u64,
    pub kernel_timings: Vec<KernelTiming>,
    pub dram_bandwidth_gbps: Option<f64>,
    pub core_utilization: Option<Vec<f32>>,
    pub output_hash: String,
    pub success: bool,
    pub fail_reason: Option<String>,
}

pub fn convert_tt_metalium_profiler_output_to_evidence(
    receipt_id: Uuid,
    phase_id: u64,
    profile_id: Uuid,
    machine_digest: MachineProfileDigest,
    model_digest: ModelProfileDigest,
    input_digest: String,
    started_at: TimestampMs,
    finished_at: TimestampMs,
    ttnn_receipt: &TtnnReceipt,
    profiler_output: &TtMetaliumProfilerOutput,
) -> PhaseEvidenceReceipt {
    let mut metrics = PhaseMetrics::default();

    // Convert us to ms where appropriate for PhaseMetrics
    metrics.wall_time_ms = Some(profiler_output.compute_time_us / 1000);
    // Since PhaseMetrics expects mostly token latency or steady_state_tps, we map appropriately
    metrics.active_memory_bytes = Some(ttnn_receipt.l1_used as u64);
    metrics.peak_memory_bytes = Some((ttnn_receipt.l1_used + ttnn_receipt.dram_used) as u64);

    // For TT-Metalium we record raw metrics into artifacts or extend PhaseMetrics in the future.
    let serialized_profiler_output = serde_json::to_string(&profiler_output).unwrap_or_default();

    let artifacts = vec![EvidenceArtifactRef {
        kind: "tt_metalium_profiler_output".into(),
        path: format!("profiler_output_{}.json", receipt_id),
        sha256: None, // We don't save to file here
    }];

    let status = if profiler_output.success {
        EvidenceStatus::Pass
    } else {
        EvidenceStatus::Fail
    };

    let failure = if profiler_output.success {
        None
    } else {
        Some(FailureClassification::UnknownBackendError) // Default or parse fail_reason
    };

    let notes = serialized_profiler_output;

    PhaseEvidenceReceipt {
        receipt_id: ReceiptId(receipt_id),
        phase_id: PhaseId(phase_id),
        phase_kind: PhaseKind::Decode, // Usually decode or prefill
        profile_id: ProfileId(profile_id),
        backend: BackendKind::TribunusNative,
        machine_profile_digest: machine_digest,
        model_profile_digest: model_digest,
        input_digest,
        output_digest: Some(profiler_output.output_hash.clone()),
        started_at,
        finished_at,
        status,
        metrics,
        artifacts,
        gate_results: vec![],
        failure,
        notes: Some(notes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::backend::ttnn::TtnnReceipt;
    use uuid::Uuid;

    #[test]
    fn test_tt_metalium_profiler_bridge_success() {
        let profiler_output = TtMetaliumProfilerOutput {
            compile_time_ms: 15,
            transfer_time_us: 1500,
            queue_delay_us: 200,
            readback_time_us: 1000,
            compute_time_us: 5000,
            kernel_timings: vec![KernelTiming {
                core_id: 0,
                reader_time_us: 100,
                compute_time_us: 4800,
                writer_time_us: 100,
            }],
            dram_bandwidth_gbps: Some(250.0),
            core_utilization: Some(vec![0.95]),
            output_hash: "0xabcdef".into(),
            success: true,
            fail_reason: None,
        };

        let ttnn_receipt = TtnnReceipt {
            op_type: "matmul".into(),
            ttnn_op: "ttnn_linear".into(),
            device_id: 0,
            dram_used: 1024,
            l1_used: 256,
            latency_us: 5000,
        };

        let receipt_id = Uuid::new_v4();
        let phase_id = 1;
        let profile_id = Uuid::new_v4();

        let receipt = convert_tt_metalium_profiler_output_to_evidence(
            receipt_id,
            phase_id,
            profile_id,
            MachineProfileDigest(
                "0000000000000000000000000000000000000000000000000000000000000000".into(),
            ),
            ModelProfileDigest(
                "0000000000000000000000000000000000000000000000000000000000000000".into(),
            ),
            "input_hash".into(),
            TimestampMs::now(),
            TimestampMs::now(),
            &ttnn_receipt,
            &profiler_output,
        );

        assert_eq!(receipt.status, EvidenceStatus::Pass);
        assert_eq!(receipt.output_digest.as_deref(), Some("0xabcdef"));
        assert_eq!(receipt.metrics.wall_time_ms, Some(5));
        assert!(receipt.failure.is_none());
        assert!(receipt.notes.unwrap().contains("\"compile_time_ms\":15"));
    }

    #[test]
    fn test_tt_metalium_profiler_bridge_failure() {
        let profiler_output = TtMetaliumProfilerOutput {
            compile_time_ms: 10,
            transfer_time_us: 1000,
            queue_delay_us: 100,
            readback_time_us: 0,
            compute_time_us: 0,
            kernel_timings: vec![],
            dram_bandwidth_gbps: None,
            core_utilization: None,
            output_hash: "".into(),
            success: false,
            fail_reason: Some("OOM".into()),
        };

        let ttnn_receipt = TtnnReceipt {
            op_type: "matmul".into(),
            ttnn_op: "ttnn_linear".into(),
            device_id: 0,
            dram_used: 0,
            l1_used: 0,
            latency_us: 0,
        };

        let receipt_id = Uuid::new_v4();
        let phase_id = 1;
        let profile_id = Uuid::new_v4();

        let receipt = convert_tt_metalium_profiler_output_to_evidence(
            receipt_id,
            phase_id,
            profile_id,
            MachineProfileDigest(
                "0000000000000000000000000000000000000000000000000000000000000000".into(),
            ),
            ModelProfileDigest(
                "0000000000000000000000000000000000000000000000000000000000000000".into(),
            ),
            "input_hash".into(),
            TimestampMs::now(),
            TimestampMs::now(),
            &ttnn_receipt,
            &profiler_output,
        );

        assert_eq!(receipt.status, EvidenceStatus::Fail);
        assert_eq!(
            receipt.failure,
            Some(FailureClassification::UnknownBackendError)
        );
        assert!(receipt.notes.unwrap().contains("\"fail_reason\":\"OOM\""));
    }
}
