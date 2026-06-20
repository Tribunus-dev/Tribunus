use super::ir::*;

#[test]
fn test_tensix_ir_serialization_and_hashing() {
    let elementwise = TensixNode::Elementwise(ElementwiseNode {
        opcode: "add".to_string(),
        inputs: vec!["input0".to_string(), "input1".to_string()],
        output: "output0".to_string(),
        core_partition: CorePartitioning {
            core_x: 2,
            core_y: 2,
        },
        tile_geometry: TileGeometry {
            height: 32,
            width: 32,
        },
        data_format: DataFormat::BFloat16,
        roles: vec![RiscvRole::Reader, RiscvRole::Compute, RiscvRole::Writer],
        scalar_args: vec![RuntimeScalarArg::from_f32(1.0)],
    });

    let matmul = TensixNode::Matmul(MatmulNode {
        inputs: vec!["inputA".to_string(), "inputB".to_string()],
        output: "outputC".to_string(),
        core_partition: CorePartitioning {
            core_x: 8,
            core_y: 8,
        },
        tile_geometry: TileGeometry {
            height: 32,
            width: 32,
        },
        data_format: DataFormat::BFloat16,
        roles: vec![RiscvRole::Reader, RiscvRole::Compute, RiscvRole::Writer],
        scalar_args: vec![],
    });

    let ir = TensixScheduleIR {
        nodes: vec![elementwise, matmul],
        buffers: vec![CircularBufferAllocation {
            buffer_id: 0,
            size_bytes: 1024,
            data_format: DataFormat::BFloat16,
        }],
        sharding: DramSharding {
            shards: vec![Shard {
                tensor_id: "input0".to_string(),
                core_x: 0,
                core_y: 0,
                size_bytes: 1024,
            }],
        },
        routing: NocRouteIntent {
            routes: vec![Route {
                src_core_x: 0,
                src_core_y: 0,
                dst_core_x: 1,
                dst_core_y: 1,
                buffer_id: 0,
            }],
        },
    };

    let serialized = serde_json::to_string(&ir).expect("Serialization failed");
    let deserialized: TensixScheduleIR =
        serde_json::from_str(&serialized).expect("Deserialization failed");

    assert_eq!(ir, deserialized);

    let digest1 = ir.digest();
    let digest2 = deserialized.digest();
    assert_eq!(digest1, digest2);
}
