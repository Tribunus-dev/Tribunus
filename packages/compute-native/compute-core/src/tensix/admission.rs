
#[derive(Debug, Clone)]
pub struct TensixAdmissionState {
    pub is_admitted: bool,
    pub reason: String,
}

pub fn check_admission(artifact: &super::artifact::TensixComputeArtifact) -> TensixAdmissionState {
    if artifact.manifest_format != "session-17" {
        return TensixAdmissionState {
            is_admitted: false,
            reason: "Invalid manifest format. Required: session-17".into(),
        };
    }
    TensixAdmissionState {
        is_admitted: true,
        reason: "Admitted by session 25 rule.".into(),
    }
}
