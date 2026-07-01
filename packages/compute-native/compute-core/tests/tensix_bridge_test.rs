use tribunus_compute_core::backend::tt_metalium::bridge::{
    BridgeState, FailureEvidence, TensixHostBridge,
};

#[test]
fn test_timeout_produces_evidence_and_recovers() {
    let mut bridge = TensixHostBridge::new();
    assert_eq!(bridge.state(), BridgeState::Healthy);

    let receipt = bridge.simulate_failure(FailureEvidence::Timeout);
    assert_eq!(receipt.failure_evidence, Some(FailureEvidence::Timeout));
    assert_eq!(bridge.state(), BridgeState::Degraded);

    // Recovery via reinit
    bridge.reinitialize();
    assert_eq!(bridge.state(), BridgeState::Healthy);
}

#[test]
fn test_device_reset_produces_evidence() {
    let mut bridge = TensixHostBridge::new();
    let receipt = bridge.simulate_failure(FailureEvidence::DeviceReset);
    assert_eq!(receipt.failure_evidence, Some(FailureEvidence::DeviceReset));
    assert_eq!(bridge.state(), BridgeState::Unhealthy);

    // Polling shouldn't automatically recover
    assert_eq!(bridge.poll_health(), BridgeState::Unhealthy);

    bridge.begin_recovery();
    assert_eq!(bridge.poll_health(), BridgeState::Recovering);

    bridge.reinitialize();
    assert_eq!(bridge.poll_health(), BridgeState::Healthy);
}

#[test]
fn test_enforce_timeouts_produces_evidence() {
    let mut bridge = TensixHostBridge::new();
    bridge.simulate_dispatch();
    assert_eq!(bridge.enforce_timeouts().is_none(), true);

    // Config timeout override
    use std::time::Duration;
    use tribunus_compute_core::backend::tt_metalium::bridge::BridgeConfig;

    let mut quick_bridge = TensixHostBridge::with_config(BridgeConfig {
        compute_timeout: Duration::from_millis(10),
        transfer_timeout: Duration::from_millis(5),
    });
    quick_bridge.simulate_dispatch();
    std::thread::sleep(Duration::from_millis(15));

    let receipt = quick_bridge.enforce_timeouts();
    assert!(receipt.is_some());
    assert_eq!(
        receipt.unwrap().failure_evidence,
        Some(FailureEvidence::Timeout)
    );
    assert_eq!(quick_bridge.state(), BridgeState::Degraded);
}
