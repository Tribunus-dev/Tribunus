use crate::inference_profile::{
    backend::{BackendKind, EvidenceStatus},
    ids::BackendAdapterId,
};

#[derive(Debug, Clone)]
pub struct CoreAIBackendAdapter {
    pub adapter_id: BackendAdapterId,
}

impl Default for CoreAIBackendAdapter {
    fn default() -> Self {
        Self {
            adapter_id: BackendAdapterId::new("core-ai", "0.1.0"),
        }
    }
}

impl CoreAIBackendAdapter {
    pub fn qualification_status(
        &self,
        macos_version: Option<&str>,
        xcode_version: Option<&str>,
    ) -> EvidenceStatus {
        match (macos_version, xcode_version) {
            (Some(os), Some(xcode)) if os.starts_with("27") && xcode.starts_with("27") => {
                EvidenceStatus::Claimed
            }
            _ => EvidenceStatus::Unqualified,
        }
    }

    pub fn backend(&self) -> BackendKind {
        BackendKind::CoreAI
    }
}
