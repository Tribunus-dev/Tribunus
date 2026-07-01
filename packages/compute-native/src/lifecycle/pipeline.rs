// Placeholder structs to represent existing structures in the system
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactCapabilitySignature {
    pub version: u32,
    pub features: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompiledArtifact {
    pub id: String,
    pub abi_version: u32,
    pub signature: ArtifactCapabilitySignature,
    pub required_weights: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedExecutionPlan {
    pub artifact_id: String,
    pub metadata: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct QuarantineDiagnostics {
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PipelineState {
    Compile,
    Manifest,
    Load,
    CompatibilityCheck,
    ResidencyReadinessCheck,
    NumericalValidation,
    ProfilingEvidenceCapture,
    Admit,
    SchedulerSelection,
    Dispatch,
    ReceiptPersistence,
    Evict,
    Invalidate(String),
    Quarantine(QuarantineDiagnostics),
}

pub struct ValidationContext {
    pub expected_abi_version: u32,
    pub expected_signature: ArtifactCapabilitySignature,
    pub resident_weights: Vec<String>,
    pub force_numerical_failure: bool,
    pub force_device_fault: bool,
}

pub struct ArtifactPipeline {
    pub artifact: CompiledArtifact,
    pub state: PipelineState,
    pub admitted_plan: Option<AdmittedExecutionPlan>,
}

impl ArtifactPipeline {
    pub fn new(artifact: CompiledArtifact) -> Self {
        Self {
            artifact,
            state: PipelineState::Compile,
            admitted_plan: None,
        }
    }

    pub fn advance(&mut self, ctx: &ValidationContext) {
        loop {
            let next_state = match &self.state {
                PipelineState::Compile => PipelineState::Manifest,
                PipelineState::Manifest => PipelineState::Load,
                PipelineState::Load => PipelineState::CompatibilityCheck,
                PipelineState::CompatibilityCheck => {
                    if self.artifact.abi_version != ctx.expected_abi_version {
                        PipelineState::Invalidate("Stale ABI version".to_string())
                    } else if self.artifact.signature.version != ctx.expected_signature.version {
                        PipelineState::Invalidate("Capability signature mismatch".to_string())
                    } else {
                        PipelineState::ResidencyReadinessCheck
                    }
                }
                PipelineState::ResidencyReadinessCheck => {
                    let missing = self
                        .artifact
                        .required_weights
                        .iter()
                        .any(|w| !ctx.resident_weights.contains(w));
                    if missing {
                        PipelineState::Invalidate("Missing weight residency".to_string())
                    } else {
                        PipelineState::NumericalValidation
                    }
                }
                PipelineState::NumericalValidation => {
                    if ctx.force_numerical_failure {
                        PipelineState::Invalidate("Numerical validation failure".to_string())
                    } else {
                        PipelineState::ProfilingEvidenceCapture
                    }
                }
                PipelineState::ProfilingEvidenceCapture => {
                    if ctx.force_device_fault {
                        PipelineState::Quarantine(QuarantineDiagnostics {
                            reason: "Device fault".to_string(),
                        })
                    } else {
                        PipelineState::Admit
                    }
                }
                PipelineState::Admit => {
                    self.admitted_plan = Some(AdmittedExecutionPlan {
                        artifact_id: self.artifact.id.clone(),
                        metadata: "admitted".to_string(),
                    });
                    PipelineState::SchedulerSelection
                }
                PipelineState::SchedulerSelection => PipelineState::Dispatch,
                PipelineState::Dispatch => PipelineState::ReceiptPersistence,
                PipelineState::ReceiptPersistence => PipelineState::Evict,
                PipelineState::Invalidate(_)
                | PipelineState::Quarantine(_)
                | PipelineState::Evict => break,
            };

            self.state = next_state.clone();

            if matches!(
                next_state,
                PipelineState::Dispatch
                    | PipelineState::Invalidate(_)
                    | PipelineState::Quarantine(_)
                    | PipelineState::Evict
            ) {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_artifact() -> CompiledArtifact {
        CompiledArtifact {
            id: "artifact_1".to_string(),
            abi_version: 1,
            signature: ArtifactCapabilitySignature {
                version: 1,
                features: vec!["feat_1".to_string()],
            },
            required_weights: vec!["weight_A".to_string()],
        }
    }

    fn valid_context() -> ValidationContext {
        ValidationContext {
            expected_abi_version: 1,
            expected_signature: ArtifactCapabilitySignature {
                version: 1,
                features: vec!["feat_1".to_string()],
            },
            resident_weights: vec!["weight_A".to_string()],
            force_numerical_failure: false,
            force_device_fault: false,
        }
    }

    #[test]
    fn test_pipeline_success() {
        let mut pipeline = ArtifactPipeline::new(valid_artifact());
        pipeline.advance(&valid_context());
        assert_eq!(pipeline.state, PipelineState::Dispatch);
        assert!(pipeline.admitted_plan.is_some());
    }

    #[test]
    fn test_pipeline_stale_abi() {
        let mut artifact = valid_artifact();
        artifact.abi_version = 0;
        let mut pipeline = ArtifactPipeline::new(artifact);
        pipeline.advance(&valid_context());
        assert_eq!(
            pipeline.state,
            PipelineState::Invalidate("Stale ABI version".to_string())
        );
    }

    #[test]
    fn test_pipeline_missing_weight() {
        let mut ctx = valid_context();
        ctx.resident_weights.clear();
        let mut pipeline = ArtifactPipeline::new(valid_artifact());
        pipeline.advance(&ctx);
        assert_eq!(
            pipeline.state,
            PipelineState::Invalidate("Missing weight residency".to_string())
        );
    }

    #[test]
    fn test_pipeline_device_fault() {
        let mut ctx = valid_context();
        ctx.force_device_fault = true;
        let mut pipeline = ArtifactPipeline::new(valid_artifact());
        pipeline.advance(&ctx);
        assert_eq!(
            pipeline.state,
            PipelineState::Quarantine(QuarantineDiagnostics {
                reason: "Device fault".to_string()
            })
        );
    }
}
