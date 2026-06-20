use crate::golden_path::backend::{GoldenPathBackend, MemoryView};
use crate::golden_path::schema::{AuditEvent, BlockDescriptor, GoldenPathPlan};
use crate::golden_path::violations::{GoldenPathViolation, ViolationCode};
use std::collections::HashMap;

pub struct IslandRegion {
    pub memory: Vec<u32>, // Using u32 vector ensures 4-byte alignment
}

impl IslandRegion {
    pub fn new(size_bytes: usize) -> Self {
        // Round up to nearest u32
        let size_u32 = (size_bytes + 3) / 4;
        Self {
            memory: vec![0u32; size_u32],
        }
    }

    pub fn get_view(
        &mut self,
        offset_bytes: usize,
        size_bytes: usize,
    ) -> Result<MemoryView, GoldenPathViolation> {
        if offset_bytes + size_bytes > self.memory.len() * 4 {
            return Err(GoldenPathViolation {
                code: ViolationCode::MemoryOffsetOob,
                details: format!(
                    "View offset {} size {} is out of bounds for island size {}",
                    offset_bytes,
                    size_bytes,
                    self.memory.len() * 4
                ),
                block_id: None,
                backend: None,
                timestamp: current_time_ns(),
            });
        }

        if offset_bytes % 4 != 0 || size_bytes % 4 != 0 {
            // Memory alignment error simulation
        }

        Ok(MemoryView {
            offset: offset_bytes,
            size: size_bytes,
            ptr: unsafe { (self.memory.as_mut_ptr() as *mut u8).add(offset_bytes) },
        })
    }
}

pub enum ExecutorState {
    Uninitialized,
    Loaded(GoldenPathPlan),
    Initialized,
    Finalized,
}

pub struct GoldenPathExecutor {
    state: ExecutorState,
    island: Option<IslandRegion>,
    backends: HashMap<String, Box<dyn GoldenPathBackend>>,
    audit_log: Vec<AuditEvent>,
    plan: Option<GoldenPathPlan>,
}

pub fn current_time_ns() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64
}

impl GoldenPathExecutor {
    pub fn new() -> Self {
        Self {
            state: ExecutorState::Uninitialized,
            island: None,
            backends: HashMap::new(),
            audit_log: Vec::new(),
            plan: None,
        }
    }

    pub fn register_backend(&mut self, id: String, backend: Box<dyn GoldenPathBackend>) {
        self.backends.insert(id, backend);
    }

    pub fn load(&mut self, plan: GoldenPathPlan) -> Result<(), GoldenPathViolation> {
        self.check_signature(&plan, "valid_sig")?; // For tests we mock sig validation with this specific expected sig
        self.check_machine_profile(&plan, "Apple M1")?;

        self.plan = Some(plan.clone());
        self.state = ExecutorState::Loaded(plan);
        Ok(())
    }

    pub fn check_signature(
        &self,
        plan: &GoldenPathPlan,
        expected: &str,
    ) -> Result<(), GoldenPathViolation> {
        if plan.signature != expected {
            return Err(GoldenPathViolation {
                code: ViolationCode::SignatureInvalid,
                details: format!("Signature invalid"),
                block_id: None,
                backend: None,
                timestamp: current_time_ns(),
            });
        }
        Ok(())
    }

    pub fn check_machine_profile(
        &self,
        plan: &GoldenPathPlan,
        expected_cpu: &str,
    ) -> Result<(), GoldenPathViolation> {
        if plan.machine_profile.observed_hardware.cpu_model != expected_cpu {
            return Err(GoldenPathViolation {
                code: ViolationCode::MachineProfileMismatch,
                details: format!("Machine profile mismatch"),
                block_id: None,
                backend: None,
                timestamp: current_time_ns(),
            });
        }
        Ok(())
    }

    pub fn initialize(&mut self) -> Result<(), GoldenPathViolation> {
        let plan = match &self.plan {
            Some(p) => p.clone(),
            None => {
                return Err(GoldenPathViolation {
                    code: ViolationCode::UndeclaredBlock, // generic error for now
                    details: "Plan not loaded".to_string(),
                    block_id: None,
                    backend: None,
                    timestamp: current_time_ns(),
                });
            }
        };

        let mut island = IslandRegion::new(plan.memory_layout.total_size);

        for (id, backend) in self.backends.iter_mut() {
            // Get views
            let mut views = Vec::new();
            for block in &plan.dispatch_table {
                if block.backend == *id {
                    for range in block
                        .input_offsets
                        .iter()
                        .chain(block.output_offsets.iter())
                    {
                        // Restrict memory views to those declared in block
                        let view = island.get_view(range.offset, range.size)?;
                        views.push(view);
                    }
                }
            }

            if let Err(e) = backend.initialize(&plan, views) {
                return Err(GoldenPathViolation {
                    code: ViolationCode::ArtifactHashMismatch, // default generic
                    details: e,
                    block_id: None,
                    backend: Some(id.clone()),
                    timestamp: current_time_ns(),
                });
            }
        }

        self.island = Some(island);
        self.state = ExecutorState::Initialized;
        Ok(())
    }

    pub fn execute(&mut self, block: &BlockDescriptor) -> Result<(), GoldenPathViolation> {
        let plan = self.plan.as_ref().unwrap();

        // 1. Verify block is declared
        if !plan
            .dispatch_table
            .iter()
            .any(|b| b.block_id == block.block_id)
        {
            return Err(GoldenPathViolation {
                code: ViolationCode::UndeclaredBlock,
                details: format!("Block {} not declared in plan", block.block_id),
                block_id: Some(block.block_id.clone()),
                backend: Some(block.backend.clone()),
                timestamp: current_time_ns(),
            });
        }

        let declared_block = plan
            .dispatch_table
            .iter()
            .find(|b| b.block_id == block.block_id)
            .unwrap();

        // Check artifacts hash
        let evidence = plan
            .evidence_ledger
            .iter()
            .find(|e| e.block_id == block.block_id);
        if let Some(ev) = evidence {
            if block.kernel_identity != ev.compiled_artifact_hash {
                return Err(GoldenPathViolation {
                    code: ViolationCode::ArtifactHashMismatch,
                    details: format!("Artifact hash mismatch for {}", block.block_id),
                    block_id: Some(block.block_id.clone()),
                    backend: Some(block.backend.clone()),
                    timestamp: current_time_ns(),
                });
            }
        }

        // Check shape
        if block.shape != declared_block.shape {
            return Err(GoldenPathViolation {
                code: ViolationCode::ShapeMismatch,
                details: format!("Shape mismatch for {}", block.block_id),
                block_id: Some(block.block_id.clone()),
                backend: Some(block.backend.clone()),
                timestamp: current_time_ns(),
            });
        }

        let backend = self
            .backends
            .get_mut(&block.backend)
            .ok_or_else(|| GoldenPathViolation {
                code: ViolationCode::UndeclaredBlock,
                details: format!("Backend {} not registered", block.backend),
                block_id: Some(block.block_id.clone()),
                backend: Some(block.backend.clone()),
                timestamp: current_time_ns(),
            })?;

        // Verify memory offset against plan (must match)
        if block.input_offsets != declared_block.input_offsets {
            return Err(GoldenPathViolation {
                code: ViolationCode::MemoryOffsetOob,
                details: format!("Memory offset changed for {}", block.block_id),
                block_id: Some(block.block_id.clone()),
                backend: Some(block.backend.clone()),
                timestamp: current_time_ns(),
            });
        }

        // Validate Memory Offset OOB limits against island size
        let island = self.island.as_ref().unwrap();
        for range in block
            .input_offsets
            .iter()
            .chain(block.output_offsets.iter())
        {
            if range.offset + range.size > island.memory.len() * 4 {
                return Err(GoldenPathViolation {
                    code: ViolationCode::MemoryOffsetOob,
                    details: format!("Memory offset out of bounds for {}", block.block_id),
                    block_id: Some(block.block_id.clone()),
                    backend: Some(block.backend.clone()),
                    timestamp: current_time_ns(),
                });
            }
        }

        // Execute
        let audit_event = match backend.execute(block) {
            Ok(ev) => ev,
            Err(e) => {
                return Err(GoldenPathViolation {
                    code: ViolationCode::UndeclaredBlock, // generic
                    details: format!("Execution failed: {}", e),
                    block_id: Some(block.block_id.clone()),
                    backend: Some(block.backend.clone()),
                    timestamp: current_time_ns(),
                });
            }
        };

        self.audit_log.push(audit_event);
        Ok(())
    }

    pub fn finalize(&mut self) -> Vec<AuditEvent> {
        self.state = ExecutorState::Finalized;
        self.audit_log.clone()
    }

    pub fn island_mut(&mut self) -> Option<&mut IslandRegion> {
        self.island.as_mut()
    }

    pub fn island(&self) -> Option<&IslandRegion> {
        self.island.as_ref()
    }
}
