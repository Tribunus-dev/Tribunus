use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum FailureEvidence {
    Timeout,
    DeviceReset,
    Crash,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensixDispatchReceipt {
    pub failure_evidence: Option<FailureEvidence>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BridgeState {
    Healthy,
    Degraded,
    Unhealthy,
    Recovering,
}

#[derive(Debug, Clone)]
pub struct BridgeConfig {
    pub compute_timeout: Duration,
    pub transfer_timeout: Duration,
}

impl Default for BridgeConfig {
    fn default() -> Self {
        Self {
            compute_timeout: Duration::from_secs(30),
            transfer_timeout: Duration::from_secs(5),
        }
    }
}

pub struct TensixHostBridge {
    state: BridgeState,
    config: BridgeConfig,
    last_dispatch: Option<Instant>,
}

impl TensixHostBridge {
    pub fn new() -> Self {
        Self {
            state: BridgeState::Healthy,
            config: BridgeConfig::default(),
            last_dispatch: None,
        }
    }

    pub fn with_config(config: BridgeConfig) -> Self {
        Self {
            state: BridgeState::Healthy,
            config,
            last_dispatch: None,
        }
    }

    pub fn state(&self) -> BridgeState {
        self.state.clone()
    }

    // Using timeout enforcement
    pub fn enforce_timeouts(&mut self) -> Option<TensixDispatchReceipt> {
        if self.state != BridgeState::Healthy {
            return None;
        }
        if let Some(dispatch_time) = self.last_dispatch {
            if dispatch_time.elapsed() > self.config.compute_timeout {
                return Some(self.simulate_failure(FailureEvidence::Timeout));
            }
        }
        None
    }

    pub fn simulate_dispatch(&mut self) {
        if self.state == BridgeState::Healthy {
            self.last_dispatch = Some(Instant::now());
        }
    }

    pub fn simulate_failure(&mut self, failure: FailureEvidence) -> TensixDispatchReceipt {
        match failure {
            FailureEvidence::Timeout => {
                self.state = BridgeState::Degraded;
            }
            FailureEvidence::DeviceReset => {
                self.state = BridgeState::Unhealthy;
            }
            FailureEvidence::Crash => {
                self.state = BridgeState::Unhealthy;
            }
        }
        self.last_dispatch = None;
        TensixDispatchReceipt {
            failure_evidence: Some(failure),
        }
    }

    pub fn poll_health(&mut self) -> BridgeState {
        self.state.clone()
    }

    pub fn begin_recovery(&mut self) {
        if self.state == BridgeState::Degraded || self.state == BridgeState::Unhealthy {
            self.state = BridgeState::Recovering;
        }
    }

    pub fn reinitialize(&mut self) {
        if self.state == BridgeState::Recovering
            || self.state == BridgeState::Degraded
            || self.state == BridgeState::Unhealthy
        {
            self.state = BridgeState::Healthy;
            self.last_dispatch = None;
        }
    }
}
