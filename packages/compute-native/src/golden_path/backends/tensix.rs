use crate::golden_path::backend::{BackendIdentity, GoldenPathBackend, MemoryView};
use crate::golden_path::schema::{AuditEvent, BlockDescriptor, GoldenPathPlan, MemoryRange};

pub struct TensixBackend {
    views: Vec<MemoryView>,
}

impl TensixBackend {
    pub fn new() -> Self {
        Self { views: vec![] }
    }

    fn add_f32(a: &[f32], b: &[f32], c: &mut [f32]) {
        for i in 0..a.len() {
            c[i] = a[i] + b[i];
        }
    }
}

impl GoldenPathBackend for TensixBackend {
    fn initialize(
        &mut self,
        _plan: &GoldenPathPlan,
        views: Vec<MemoryView>,
    ) -> Result<(), String> {
        self.views = views;
        Ok(())
    }

    fn execute(&mut self, block: &BlockDescriptor) -> Result<AuditEvent, String> {
        let start = crate::golden_path::executor::current_time_ns();

        let mut bindings = Vec::new();

        if block.block_id.starts_with("add") {
            if let (Some(in_a), Some(in_b), Some(out_c)) =
                (self.views.get(0), self.views.get(1), self.views.get(2))
            {
                unsafe {
                    let elements = in_a.size / 4;
                    let a_slice =
                        std::slice::from_raw_parts(in_a.ptr as *const f32, elements);
                    let b_slice =
                        std::slice::from_raw_parts(in_b.ptr as *const f32, elements);
                    let c_slice = std::slice::from_raw_parts_mut(
                        out_c.ptr as *mut f32,
                        elements,
                    );

                    Self::add_f32(a_slice, b_slice, c_slice);
                }

                bindings.push(MemoryRange {
                    offset: self.views[0].offset,
                    size: self.views[0].size,
                });
                bindings.push(MemoryRange {
                    offset: self.views[1].offset,
                    size: self.views[1].size,
                });
                bindings.push(MemoryRange {
                    offset: self.views[2].offset,
                    size: self.views[2].size,
                });
            }
        }

        let end = crate::golden_path::executor::current_time_ns();

        Ok(AuditEvent {
            block_id: block.block_id.clone(),
            backend: "tensix".to_string(),
            kernel_identity: block.kernel_identity.clone(),
            started_at: start,
            completed_at: end,
            input_checksum: None,
            output_checksum: None,
            tolerance_met: None,
            error: None,
            artifact_hash: Some("mock_tensix_artifact_hash".to_string()),
            device_profile_hash: Some("mock_device_profile_hash".to_string()),
            region_bindings: Some(bindings),
            core_range: Some("0-3".to_string()),
            queue: Some("compute_queue_0".to_string()),
            elapsed_time_ns: Some(end - start),
        })
    }

    fn identity(&self) -> BackendIdentity {
        BackendIdentity {
            name: "tensix".to_string(),
            version: "v0".to_string(),
        }
    }
}
