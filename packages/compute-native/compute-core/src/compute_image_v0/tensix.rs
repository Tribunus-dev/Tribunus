use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TensixArtifactCacheKey {
    pub hash: String,
    pub shape_profile: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TensixArtifactState {
    Compiled,
    Profiled,
    Admitted,
    Quarantined,
}
