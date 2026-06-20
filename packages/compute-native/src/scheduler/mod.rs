pub struct TensixScheduler;

impl TensixScheduler {
    pub fn select_artifact(
        state: &tribunus_compute_core::compute_image_v0::tensix::TensixArtifactState,
    ) -> bool {
        // Scheduler MUST NOT select compiled or profiled artifacts.
        // ONLY admitted artifacts are eligible.
        matches!(
            state,
            tribunus_compute_core::compute_image_v0::tensix::TensixArtifactState::Admitted
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tribunus_compute_core::compute_image_v0::tensix::TensixArtifactState;

    #[test]
    fn scheduler_selects_only_admitted() {
        assert!(!TensixScheduler::select_artifact(
            &TensixArtifactState::Compiled
        ));
        assert!(!TensixScheduler::select_artifact(
            &TensixArtifactState::Profiled
        ));
        assert!(!TensixScheduler::select_artifact(
            &TensixArtifactState::Quarantined
        ));
        assert!(TensixScheduler::select_artifact(
            &TensixArtifactState::Admitted
        ));
    }
}
