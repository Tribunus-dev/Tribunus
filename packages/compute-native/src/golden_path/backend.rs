use crate::golden_path::schema::{AuditEvent, BlockDescriptor, GoldenPathPlan};

#[derive(Debug, Clone, PartialEq)]
pub struct BackendIdentity {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Clone)]
pub struct MemoryView {
    pub offset: usize,
    pub size: usize,
    pub ptr: *mut u8,
}

unsafe impl Send for MemoryView {}
unsafe impl Sync for MemoryView {}

pub trait GoldenPathBackend: Send + Sync {
    fn initialize(
        &mut self,
        plan: &GoldenPathPlan,
        views: Vec<MemoryView>,
    ) -> Result<(), String>;

    fn execute(&mut self, block: &BlockDescriptor) -> Result<AuditEvent, String>;

    fn identity(&self) -> BackendIdentity;
}
