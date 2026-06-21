use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TensixMeshTopology {
    pub devices: Vec<DeviceDescriptor>,
    pub links: Vec<LinkDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceDescriptor {
    pub id: usize,
    pub coordinates: (usize, usize),
    pub status: DeviceStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum DeviceStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkDescriptor {
    pub source_id: usize,
    pub target_id: usize,
    pub class: LinkClass,
    pub status: LinkStatus,
    pub bandwidth_gbps: f64,
    pub latency_ns: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LinkClass {
    Pcie,
    Ethernet,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LinkStatus {
    Up,
    Down,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ShardOwnershipMap {
    pub tensor_id: String,
    pub device_shards: Vec<DeviceShard>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DeviceShard {
    pub device_id: usize,
    pub size_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CollectiveSchedule {
    pub operations: Vec<CollectiveOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum CollectiveOperation {
    AllGather {
        devices: Vec<usize>,
        volume_bytes: usize,
    },
    ReduceScatter {
        devices: Vec<usize>,
        volume_bytes: usize,
    },
    PointToPoint {
        source: usize,
        target: usize,
        volume_bytes: usize,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum SimulatorError {
    LinkDown {
        source: usize,
        target: usize,
    },
    DeviceOffline {
        id: usize,
    },
    LatencySpike {
        link_id: (usize, usize),
        latency: f64,
    },
    InvalidSchedule,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TransferMetrics {
    pub total_volume_bytes: usize,
    pub total_latency_ns: f64,
}

pub struct Simulator {
    pub topology: TensixMeshTopology,
    pub shard_maps: Vec<ShardOwnershipMap>,
}

impl Simulator {
    pub fn new(topology: TensixMeshTopology) -> Self {
        Self {
            topology,
            shard_maps: Vec::new(),
        }
    }

    pub fn add_shard_map(&mut self, map: ShardOwnershipMap) {
        self.shard_maps.push(map);
    }

    pub fn validate_schedule(
        &self,
        schedule: &CollectiveSchedule,
    ) -> Result<TransferMetrics, SimulatorError> {
        let mut total_volume = 0;
        let mut total_latency = 0.0;
        for op in &schedule.operations {
            match op {
                CollectiveOperation::AllGather {
                    devices,
                    volume_bytes,
                }
                | CollectiveOperation::ReduceScatter {
                    devices,
                    volume_bytes,
                } => {
                    for &device_id in devices {
                        let device = self
                            .topology
                            .devices
                            .iter()
                            .find(|d| d.id == device_id)
                            .ok_or(SimulatorError::InvalidSchedule)?;
                        if device.status == DeviceStatus::Offline {
                            return Err(SimulatorError::DeviceOffline { id: device_id });
                        }
                    }

                    for i in 0..devices.len() {
                        for j in 0..devices.len() {
                            if i == j {
                                continue;
                            }
                            let src = devices[i];
                            let dst = devices[j];
                            let link = self
                                .topology
                                .links
                                .iter()
                                .find(|l| l.source_id == src && l.target_id == dst)
                                .ok_or(SimulatorError::InvalidSchedule)?;
                            if link.status == LinkStatus::Down {
                                return Err(SimulatorError::LinkDown {
                                    source: src,
                                    target: dst,
                                });
                            }
                            if link.latency_ns > 1_000_000.0 {
                                // arbitrary spike threshold
                                return Err(SimulatorError::LatencySpike {
                                    link_id: (src, dst),
                                    latency: link.latency_ns,
                                });
                            }
                            // Simplified bandwidth / latency math for simulator
                            total_volume += volume_bytes;
                            let link_transfer_time = (*volume_bytes as f64 * 8.0)
                                / (link.bandwidth_gbps * 1_000_000_000.0)
                                * 1_000_000_000.0;
                            total_latency += link.latency_ns + link_transfer_time;
                        }
                    }
                }
                CollectiveOperation::PointToPoint {
                    source,
                    target,
                    volume_bytes,
                } => {
                    let link = self
                        .topology
                        .links
                        .iter()
                        .find(|l| l.source_id == *source && l.target_id == *target)
                        .ok_or(SimulatorError::InvalidSchedule)?;
                    if link.status == LinkStatus::Down {
                        return Err(SimulatorError::LinkDown {
                            source: *source,
                            target: *target,
                        });
                    }
                    if link.latency_ns > 1_000_000.0 {
                        return Err(SimulatorError::LatencySpike {
                            link_id: (*source, *target),
                            latency: link.latency_ns,
                        });
                    }
                    let source_dev = self
                        .topology
                        .devices
                        .iter()
                        .find(|d| d.id == *source)
                        .ok_or(SimulatorError::InvalidSchedule)?;
                    if source_dev.status == DeviceStatus::Offline {
                        return Err(SimulatorError::DeviceOffline { id: *source });
                    }
                    let target_dev = self
                        .topology
                        .devices
                        .iter()
                        .find(|d| d.id == *target)
                        .ok_or(SimulatorError::InvalidSchedule)?;
                    if target_dev.status == DeviceStatus::Offline {
                        return Err(SimulatorError::DeviceOffline { id: *target });
                    }
                    total_volume += volume_bytes;
                    let link_transfer_time = (*volume_bytes as f64 * 8.0)
                        / (link.bandwidth_gbps * 1_000_000_000.0)
                        * 1_000_000_000.0;
                    total_latency += link.latency_ns + link_transfer_time;
                }
            }
        }
        Ok(TransferMetrics {
            total_volume_bytes: total_volume,
            total_latency_ns: total_latency,
        })
    }

    pub fn inject_link_failure(&mut self, source_id: usize, target_id: usize) {
        if let Some(link) = self
            .topology
            .links
            .iter_mut()
            .find(|l| l.source_id == source_id && l.target_id == target_id)
        {
            link.status = LinkStatus::Down;
        }
    }

    pub fn inject_latency_spike(&mut self, source_id: usize, target_id: usize, new_latency: f64) {
        if let Some(link) = self
            .topology
            .links
            .iter_mut()
            .find(|l| l.source_id == source_id && l.target_id == target_id)
        {
            link.latency_ns = new_latency;
        }
    }
}
