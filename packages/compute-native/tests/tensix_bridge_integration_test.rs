use tribunus_compute_core::backend::tt_metalium::bridge::{FailureEvidence, TensixHostBridge};
use tribunus_compute_native::scheduler::Scheduler;

#[test]
fn test_scheduler_refuses_dispatch_on_device_reset() {
    let bridge = TensixHostBridge::new();
    let mut scheduler = Scheduler::new(bridge);

    assert!(scheduler.can_dispatch());

    let receipt = scheduler
        .bridge_mut()
        .simulate_failure(FailureEvidence::DeviceReset);
    assert_eq!(receipt.failure_evidence, Some(FailureEvidence::DeviceReset));

    assert!(!scheduler.can_dispatch()); // Currently Unhealthy

    scheduler.bridge_mut().begin_recovery();
    assert!(!scheduler.can_dispatch()); // Currently Recovering

    scheduler.bridge_mut().reinitialize();
    assert!(scheduler.can_dispatch()); // Now Healthy
}

#[test]
fn test_scheduler_refuses_dispatch_on_timeout() {
    let bridge = TensixHostBridge::new();
    let mut scheduler = Scheduler::new(bridge);

    assert!(scheduler.can_dispatch());

    let receipt = scheduler
        .bridge_mut()
        .simulate_failure(FailureEvidence::Timeout);
    assert_eq!(receipt.failure_evidence, Some(FailureEvidence::Timeout));

    assert!(!scheduler.can_dispatch()); // Currently Degraded

    scheduler.bridge_mut().reinitialize();
    assert!(scheduler.can_dispatch()); // Now Healthy
}
