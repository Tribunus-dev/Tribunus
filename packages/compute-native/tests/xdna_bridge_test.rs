#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use tribunus_compute_native::xdna::xdna_bridge::{XdnaSession, init_xdna_subsystem};
    use tribunus_compute_native::xdna::xdna_pipeline::{Graph, Node, OpType, Partitioner};
    use tribunus_compute_native::xdna::xdna_state::XdnaState;

    #[test]
    fn test_xdna_bridge_init_and_load() {
        let init_result = init_xdna_subsystem();
        assert!(init_result.is_ok());

        let session = XdnaSession::new("test_model.onnx", "NPU0");
        assert!(session.is_ok());
    }

    #[tokio::test]
    async fn test_xdna_state_lifecycle() {
        let state = XdnaState::new("test_model.onnx".to_string()).unwrap();
        
        let load_res = state.load().await;
        assert!(load_res.is_ok());

        // Perform mock infer
        let input_names = vec!["input1".to_string()];
        let mut mock_data = vec![0.0f32; 4];
        let input_data = vec![mock_data.as_mut_ptr() as *mut std::ffi::c_void];
        let shape1: Vec<i64> = vec![1, 4];
        let input_shapes = vec![shape1];
        
        let output_names = vec!["output1".to_string()];
        let mut mock_out_data = vec![0.0f32; 4];
        let output_data = vec![mock_out_data.as_mut_ptr() as *mut std::ffi::c_void];
        let out_shape1: Vec<i64> = vec![1, 4];
        let output_shapes = vec![out_shape1];

        let infer_res = state.infer(
            input_names,
            input_data,
            input_shapes,
            output_names,
            output_data,
            output_shapes
        ).await;

        assert!(infer_res.is_ok());
        
        state.unload().await;
    }

    #[test]
    fn test_xdna_partitioner() {
        let mut nodes = HashMap::new();
        nodes.insert(1, Node { id: 1, op_type: OpType::MatMulInt8, inputs: vec![], outputs: vec![2] });
        nodes.insert(2, Node { id: 2, op_type: OpType::LayerNorm, inputs: vec![1], outputs: vec![3] });
        nodes.insert(3, Node { id: 3, op_type: OpType::SiLu, inputs: vec![2], outputs: vec![4] });
        nodes.insert(4, Node { id: 4, op_type: OpType::Gather, inputs: vec![3], outputs: vec![] }); // CPU boundary

        let graph = Graph {
            nodes,
            root_nodes: vec![1],
        };

        let partitioner = Partitioner::new(3);
        let subgraphs = partitioner.partition(&graph);

        // We expect one NPU compatible subgraph (nodes 1,2,3) and one CPU fallback subgraph (node 4)
        assert_eq!(subgraphs.len(), 2);
        
        let mut found_npu = false;
        let mut found_cpu = false;
        
        for sg in subgraphs {
            if sg.is_npu_compatible {
                assert!(sg.nodes.contains(&1));
                assert!(sg.nodes.contains(&2));
                assert!(sg.nodes.contains(&3));
                found_npu = true;
            } else {
                assert!(sg.nodes.contains(&4));
                found_cpu = true;
            }
        }
        
        assert!(found_npu && found_cpu);
    }
}
