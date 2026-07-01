use tribunus_compute_core::tensix::simulator::*;

#[test]
fn test_simulator_all_gather() {
    let topology = TensixMeshTopology {
        devices: vec![
            DeviceDescriptor {
                id: 0,
                coordinates: (0, 0),
                status: DeviceStatus::Online,
            },
            DeviceDescriptor {
                id: 1,
                coordinates: (0, 1),
                status: DeviceStatus::Online,
            },
        ],
        links: vec![
            LinkDescriptor {
                source_id: 0,
                target_id: 1,
                class: LinkClass::Pcie,
                status: LinkStatus::Up,
                bandwidth_gbps: 100.0,
                latency_ns: 1000.0,
            },
            LinkDescriptor {
                source_id: 1,
                target_id: 0,
                class: LinkClass::Pcie,
                status: LinkStatus::Up,
                bandwidth_gbps: 100.0,
                latency_ns: 1000.0,
            },
        ],
    };

    let mut sim = Simulator::new(topology);

    let schedule = CollectiveSchedule {
        operations: vec![CollectiveOperation::AllGather {
            devices: vec![0, 1],
            volume_bytes: 1024,
        }],
    };

    let metrics = sim.validate_schedule(&schedule).unwrap();
    // 2 devices all-gather means 0 -> 1 and 1 -> 0 transfers, volume = 2048
    assert_eq!(metrics.total_volume_bytes, 2048);

    sim.inject_link_failure(0, 1);

    let result = sim.validate_schedule(&schedule);
    assert!(result.is_err());

    // Fallback to single device
    let fallback_schedule = CollectiveSchedule {
        operations: vec![CollectiveOperation::AllGather {
            devices: vec![0],
            volume_bytes: 1024,
        }],
    };

    let fallback_metrics = sim.validate_schedule(&fallback_schedule).unwrap();
    assert_eq!(fallback_metrics.total_volume_bytes, 0); // single device requires no transfers
}

#[test]
fn test_simulator_latency_spike() {
    let topology = TensixMeshTopology {
        devices: vec![
            DeviceDescriptor {
                id: 0,
                coordinates: (0, 0),
                status: DeviceStatus::Online,
            },
            DeviceDescriptor {
                id: 1,
                coordinates: (0, 1),
                status: DeviceStatus::Online,
            },
        ],
        links: vec![
            LinkDescriptor {
                source_id: 0,
                target_id: 1,
                class: LinkClass::Pcie,
                status: LinkStatus::Up,
                bandwidth_gbps: 100.0,
                latency_ns: 1000.0,
            },
            LinkDescriptor {
                source_id: 1,
                target_id: 0,
                class: LinkClass::Pcie,
                status: LinkStatus::Up,
                bandwidth_gbps: 100.0,
                latency_ns: 1000.0,
            },
        ],
    };

    let mut sim = Simulator::new(topology);

    let schedule = CollectiveSchedule {
        operations: vec![CollectiveOperation::PointToPoint {
            source: 0,
            target: 1,
            volume_bytes: 1024,
        }],
    };

    sim.inject_latency_spike(0, 1, 2_000_000.0);

    let result = sim.validate_schedule(&schedule);
    assert!(result.is_err());
    match result {
        Err(SimulatorError::LatencySpike { link_id, .. }) => assert_eq!(link_id, (0, 1)),
        _ => panic!("Expected LatencySpike error"),
    }
}
