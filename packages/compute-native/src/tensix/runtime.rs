use std::sync::{Arc, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, PartialEq)]
pub enum FailureKind {
    Timeout,
    DeviceReset,
    ProgramCrash,
    ResourceExhaustion,
}

#[derive(Debug, Clone)]
pub struct FailureEvidence {
    pub device_id: u32,
    pub artifact_id: String,
    pub failure_kind: FailureKind,
    pub timestamp: u64,
    pub elapsed_ms: u64,
    pub error_detail: String,
    pub previous_device_state: String,
    pub suggested_fallback: String,
}

#[derive(Debug, Clone)]
pub struct TensixDispatchReceipt {
    pub success: bool,
    pub timeout: bool,
    pub latency_ms: u64,
    pub failure_evidence: Option<FailureEvidence>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DeviceState {
    Closed,
    Open,
    Executing,
    Faulted,
}

pub struct TensixRuntimeState {
    pub device_id: u32,
    pub artifact_id: String,
    pub state: DeviceState,
    pub artifacts_valid: bool,
    pub timeout_ms: u64,
    pub previous_state_desc: String,
}

pub struct TensixRuntimeWrapper {
    pub state: Arc<Mutex<TensixRuntimeState>>,
}

impl TensixRuntimeWrapper {
    pub fn new(device_id: u32, timeout_ms: u64) -> Self {
        Self {
            state: Arc::new(Mutex::new(TensixRuntimeState {
                device_id,
                artifact_id: String::new(),
                state: DeviceState::Closed,
                artifacts_valid: true,
                timeout_ms,
                previous_state_desc: "Closed".into(),
            })),
        }
    }

    pub fn open(&self) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        state.previous_state_desc = format!("{:?}", state.state);
        state.state = DeviceState::Open;
        state.artifacts_valid = true;
        Ok(())
    }

    pub fn close(&self) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        state.previous_state_desc = format!("{:?}", state.state);
        state.state = DeviceState::Closed;
        Ok(())
    }

    pub fn submit(&self, artifact_id: String) -> Result<TensixDispatchReceipt, String> {
        let mut state = self.state.lock().unwrap();
        if state.state != DeviceState::Open {
            return Err("Device is not open".into());
        }
        if !state.artifacts_valid {
            return Err("Artifacts are invalid due to previous fault".into());
        }

        state.previous_state_desc = format!("{:?}", state.state);
        state.state = DeviceState::Executing;
        state.artifact_id = artifact_id;

        Ok(TensixDispatchReceipt {
            success: true,
            timeout: false,
            latency_ms: 0,
            failure_evidence: None,
        })
    }

    pub fn sync(&self, start_time: Instant) -> TensixDispatchReceipt {
        let mut state = self.state.lock().unwrap();
        if state.state != DeviceState::Executing {
            return TensixDispatchReceipt {
                success: false,
                timeout: false,
                latency_ms: 0,
                failure_evidence: Some(FailureEvidence {
                    device_id: state.device_id,
                    artifact_id: state.artifact_id.clone(),
                    failure_kind: FailureKind::ProgramCrash,
                    timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                    elapsed_ms: 0,
                    error_detail: "Sync called while not executing".into(),
                    previous_device_state: state.previous_state_desc.clone(),
                    suggested_fallback: "CPU".into(),
                }),
            };
        }

        let elapsed = start_time.elapsed();
        let elapsed_ms = elapsed.as_millis() as u64;

        if elapsed_ms > state.timeout_ms {
            state.artifacts_valid = false;
            state.previous_state_desc = format!("{:?}", state.state);
            state.state = DeviceState::Faulted;
            
            return TensixDispatchReceipt {
                success: false,
                timeout: true,
                latency_ms: elapsed_ms,
                failure_evidence: Some(FailureEvidence {
                    device_id: state.device_id,
                    artifact_id: state.artifact_id.clone(),
                    failure_kind: FailureKind::Timeout,
                    timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                    elapsed_ms,
                    error_detail: "Execution timeout exceeded".into(),
                    previous_device_state: state.previous_state_desc.clone(),
                    suggested_fallback: "CPU".into(),
                }),
            };
        }

        state.previous_state_desc = format!("{:?}", state.state);
        state.state = DeviceState::Open;

        TensixDispatchReceipt {
            success: true,
            timeout: false,
            latency_ms: elapsed_ms,
            failure_evidence: None,
        }
    }

    pub fn simulate_device_reset(&self) -> TensixDispatchReceipt {
        let mut state = self.state.lock().unwrap();
        state.artifacts_valid = false;
        state.previous_state_desc = format!("{:?}", state.state);
        state.state = DeviceState::Faulted;

        TensixDispatchReceipt {
            success: false,
            timeout: false,
            latency_ms: 0,
            failure_evidence: Some(FailureEvidence {
                device_id: state.device_id,
                artifact_id: state.artifact_id.clone(),
                failure_kind: FailureKind::DeviceReset,
                timestamp: SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs(),
                elapsed_ms: 0,
                error_detail: "Device reset detected".into(),
                previous_device_state: state.previous_state_desc.clone(),
                suggested_fallback: "CPU".into(),
            }),
        }
    }

    pub fn reset_detected(&self) -> bool {
        let state = self.state.lock().unwrap();
        !state.artifacts_valid
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;

    #[test]
    fn test_timeout_invalidates_artifacts_within_bound() {
        let wrapper = TensixRuntimeWrapper::new(0, 100); // 100ms timeout
        wrapper.open().unwrap();

        let start_time = Instant::now();
        let _ = wrapper.submit("test_artifact_1".into()).unwrap();
        
        thread::sleep(Duration::from_millis(150)); // Simulate hang

        let receipt = wrapper.sync(start_time);

        assert!(!receipt.success);
        assert!(receipt.timeout);
        
        let evidence = receipt.failure_evidence.expect("Expected failure evidence");
        assert_eq!(evidence.failure_kind, FailureKind::Timeout);
        assert_eq!(evidence.artifact_id, "test_artifact_1");
        assert_eq!(evidence.suggested_fallback, "CPU");
        assert!(wrapper.reset_detected());
        
        // Ensure invalidation happened within a 200ms wall-clock period
        assert!(start_time.elapsed().as_millis() <= 200, "Invalidation took too long");
    }

    #[test]
    fn test_normal_completes_without_invalidation() {
        let wrapper = TensixRuntimeWrapper::new(1, 100);
        wrapper.open().unwrap();
        
        let start_time = Instant::now();
        let _ = wrapper.submit("test_artifact_normal".into()).unwrap();
        
        // Finish before timeout
        let receipt = wrapper.sync(start_time);
        
        assert!(receipt.success);
        assert!(!receipt.timeout);
        assert!(receipt.failure_evidence.is_none());
        assert!(!wrapper.reset_detected());
    }

    #[test]
    fn test_device_reset_produces_evidence() {
        let wrapper = TensixRuntimeWrapper::new(2, 100);
        wrapper.open().unwrap();
        
        let receipt = wrapper.simulate_device_reset();
        
        assert!(!receipt.success);
        let evidence = receipt.failure_evidence.expect("Expected failure evidence");
        assert_eq!(evidence.failure_kind, FailureKind::DeviceReset);
        assert!(wrapper.reset_detected());
    }
}
