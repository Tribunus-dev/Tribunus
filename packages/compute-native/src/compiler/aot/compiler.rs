use std::collections::HashMap;

/// GPU hardware profile for AOT compilation
#[derive(Debug, Clone)]
pub struct GpuProfile {
    pub max_registers_per_thread: u32,
    pub shared_memory_per_block: u32,
    pub wavefront_size: u32,
    pub l2_cache_size: u32,
}

/// Represents the output of the AOT compiler
#[derive(Debug, Clone)]
pub struct TribunusExecutable {
    pub kernels: HashMap<String, Vec<u8>>, // SPIR-V blobs
    pub dispatch_table: Vec<DispatchEntry>,
    pub sync_barriers: Vec<SyncBarrier>,
}

#[derive(Debug, Clone)]
pub struct DispatchEntry {
    pub kernel_name: String,
    pub grid_size: [u32; 3],
    pub block_size: [u32; 3],
    pub layer_idx: usize,
}

#[derive(Debug, Clone)]
pub struct SyncBarrier {
    pub layer_idx: usize,
    pub wait_for: Vec<usize>,
}

pub struct AotCompiler {
    profile: GpuProfile,
}

impl AotCompiler {
    pub fn new(profile: GpuProfile) -> Self {
        Self { profile }
    }

    pub fn compile_model(&self, num_layers: usize) -> TribunusExecutable {
        let mut kernels = HashMap::new();
        let mut dispatch_table = Vec::new();
        let mut sync_barriers = Vec::new();

        for i in 0..num_layers {
            // Generate fused megakernels per layer
            let kernel1_name = format!("layer_{}_fused_qkv", i);
            let kernel2_name = format!("layer_{}_fused_attn_mlp", i);

            // Dummy SPIR-V blobs
            kernels.insert(kernel1_name.clone(), vec![0x03, 0x02, 0x23, 0x07]);
            kernels.insert(kernel2_name.clone(), vec![0x03, 0x02, 0x23, 0x07]);

            dispatch_table.push(DispatchEntry {
                kernel_name: kernel1_name,
                grid_size: [self.profile.wavefront_size, 1, 1],
                block_size: [256, 1, 1],
                layer_idx: i,
            });

            dispatch_table.push(DispatchEntry {
                kernel_name: kernel2_name,
                grid_size: [self.profile.wavefront_size, 1, 1],
                block_size: [256, 1, 1],
                layer_idx: i,
            });

            if i > 0 {
                sync_barriers.push(SyncBarrier {
                    layer_idx: i,
                    wait_for: vec![i - 1],
                });
            }
        }

        TribunusExecutable {
            kernels,
            dispatch_table,
            sync_barriers,
        }
    }
}
