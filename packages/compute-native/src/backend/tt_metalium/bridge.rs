use crate::tensix::runtime::{TensixRuntimeWrapper, TensixDispatchReceipt};
use std::time::Instant;
use std::sync::Arc;

pub struct TtMetaliumBridge {
    runtime: Arc<TensixRuntimeWrapper>,
}

impl TtMetaliumBridge {
    pub fn new(device_id: u32, timeout_ms: u64) -> Self {
        Self {
            runtime: Arc::new(TensixRuntimeWrapper::new(device_id, timeout_ms)),
        }
    }

    pub fn open_device(&self) -> Result<(), String> {
        self.runtime.open()
    }

    pub fn close_device(&self) -> Result<(), String> {
        self.runtime.close()
    }

    pub fn submit_program(&self, artifact_id: String) -> Result<TensixDispatchReceipt, String> {
        self.runtime.submit(artifact_id)
    }

    pub fn sync(&self, start_time: Instant) -> TensixDispatchReceipt {
        self.runtime.sync(start_time)
    }

    pub fn reset_detected(&self) -> bool {
        self.runtime.reset_detected()
    }
}
