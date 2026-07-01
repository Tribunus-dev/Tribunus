use tribunus_compute_core::tensix::mesh::{TensixMeshTopology};
use tribunus_compute_core::tensix::parallel::{TensixParallelMatmulPlan, ShardSpec, CollectiveOp, ProgramFragment, AdmissionError};
use tribunus_compute_core::tensix::mesh::CollectiveClass;

#[test]
fn test_parallel_matmul_admission() {
    let topo = TensixMeshTopology::degenerate_n_chip(2, (8, 8), 1024);

    let plan = TensixParallelMatmulPlan {
        num_devices: 2,
        shard_spec: ShardSpec::SplitOutputChannels { num_shards: 2 },
        collective_schedule: vec![
            CollectiveOp {
                collective_class: CollectiveClass::AllGather,
                tensor_id: "activations".to_string(),
            },
            CollectiveOp {
                collective_class: CollectiveClass::ReduceScatter,
                tensor_id: "partial_sums".to_string(),
            }
        ],
        per_device_fragments: vec![
            ProgramFragment { device_index: 0, program_id: "frag0".to_string() },
            ProgramFragment { device_index: 1, program_id: "frag1".to_string() },
        ],
    };

    assert!(plan.admit(&topo).is_ok());

    let topo_single = TensixMeshTopology::degenerate_single_chip((8, 8), 1024);
    assert!(matches!(plan.admit(&topo_single), Err(AdmissionError::TopologyMismatch { required_devices: 2, actual_devices: 1 })));
}
