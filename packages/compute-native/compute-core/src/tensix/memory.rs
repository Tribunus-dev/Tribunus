use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum TensixMemoryType {
    Dram,
    L1,
    CircularBuffer(usize), // cb_index
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TensixRegionMaterialization {
    pub memory_type: TensixMemoryType,
    pub size_bytes: usize,
    pub core_x: usize,
    pub core_y: usize,
    pub tile_count: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PlacementMap {
    pub allocations: Vec<TensixRegionMaterialization>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConstraintViolation {
    DramExhausted {
        requested: usize,
        available: usize,
    },
    L1Exhausted {
        core: (usize, usize),
        requested: usize,
        available: usize,
        cb_index: Option<usize>,
    },
    CbDepthInvalid {
        cb_index: usize,
        depth: usize,
        required: usize,
    },
    NocBandwidthExceeded {
        route: String,
        requested_gbps: usize,
        limit_gbps: usize,
    },
    AlignmentInvalid {
        required_bytes: usize,
        actual_bytes: usize,
    },
}

impl fmt::Display for ConstraintViolation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DramExhausted { requested, available } => write!(f, "Total DRAM exhausted. Requested {} bytes, but only {} bytes available.", requested, available),
            Self::L1Exhausted { core, requested, available, cb_index } => {
                if let Some(idx) = cb_index {
                    write!(f, "CB[in{}] needs {}KB L1 but only {}KB available on core ({},{})", idx, requested / 1024, available / 1024, core.0, core.1)
                } else {
                    write!(f, "L1 exhausted on core ({},{}). Requested {} bytes, but only {} bytes available.", core.0, core.1, requested, available)
                }
            },
            Self::CbDepthInvalid { cb_index, depth, required } => write!(f, "Circular Buffer {} depth {} is insufficient. Required depth is {}.", cb_index, depth, required),
            Self::NocBandwidthExceeded { route, requested_gbps, limit_gbps } => write!(f, "NoC transfer overlap constraint violated on route {}. Requested {} GB/s, limit {} GB/s.", route, requested_gbps, limit_gbps),
            Self::AlignmentInvalid { required_bytes, actual_bytes } => write!(f, "Tensor alignment invalid. Required {} bytes, got {} bytes.", required_bytes, actual_bytes),
        }
    }
}

pub struct MemoryPlannerConfig {
    pub total_dram_bytes: usize,
    pub l1_per_core_bytes: usize,
    pub noc_bandwidth_gbps: usize,
    pub alignment_bytes: usize,
}

impl Default for MemoryPlannerConfig {
    fn default() -> Self {
        Self {
            total_dram_bytes: 32 * 1024 * 1024 * 1024, // 32 GB for Blackhole
            l1_per_core_bytes: 1536 * 1024,            // 1.5 MB SRAM per core
            noc_bandwidth_gbps: 200,                   // example
            alignment_bytes: 32,                       // example block alignment
        }
    }
}

pub struct TensixMemoryPlanner {
    config: MemoryPlannerConfig,
    current_dram_usage: usize,
    current_l1_usage: HashMap<(usize, usize), usize>,
    current_noc_routes: HashMap<String, usize>,
}

impl TensixMemoryPlanner {
    pub fn new(config: MemoryPlannerConfig) -> Self {
        Self {
            config,
            current_dram_usage: 0,
            current_l1_usage: HashMap::new(),
            current_noc_routes: HashMap::new(),
        }
    }

    pub fn plan(
        &mut self,
        requests: &[TensixRegionMaterialization],
    ) -> Result<PlacementMap, ConstraintViolation> {
        let mut planned = Vec::new();
        // create temporary state to simulate planning
        let mut dram_usage = self.current_dram_usage;
        let mut l1_usage = self.current_l1_usage.clone();

        for req in requests {
            // Align sizes if necessary
            if req.size_bytes % self.config.alignment_bytes != 0 {
                return Err(ConstraintViolation::AlignmentInvalid {
                    required_bytes: self.config.alignment_bytes,
                    actual_bytes: req.size_bytes % self.config.alignment_bytes,
                });
            }

            match req.memory_type {
                TensixMemoryType::Dram => {
                    if dram_usage + req.size_bytes > self.config.total_dram_bytes {
                        return Err(ConstraintViolation::DramExhausted {
                            requested: req.size_bytes,
                            available: self.config.total_dram_bytes - dram_usage,
                        });
                    }
                    dram_usage += req.size_bytes;
                }
                TensixMemoryType::L1 | TensixMemoryType::CircularBuffer(_) => {
                    let core = (req.core_x, req.core_y);
                    let usage = l1_usage.entry(core).or_insert(0);

                    if *usage + req.size_bytes > self.config.l1_per_core_bytes {
                        let cb_index = match req.memory_type {
                            TensixMemoryType::CircularBuffer(idx) => Some(idx),
                            _ => None,
                        };
                        return Err(ConstraintViolation::L1Exhausted {
                            core,
                            requested: req.size_bytes,
                            available: self.config.l1_per_core_bytes - *usage,
                            cb_index,
                        });
                    }

                    // Check CB depth constraints
                    if let TensixMemoryType::CircularBuffer(idx) = req.memory_type {
                        // Dummy check: e.g. need at least 2 tiles for double buffering
                        if req.tile_count < 2 {
                            return Err(ConstraintViolation::CbDepthInvalid {
                                cb_index: idx,
                                depth: req.tile_count,
                                required: 2,
                            });
                        }
                    }

                    *usage += req.size_bytes;
                }
            }
            planned.push(req.clone());
        }

        // Only commit state if all successful
        self.current_dram_usage = dram_usage;
        self.current_l1_usage = l1_usage;

        Ok(PlacementMap {
            allocations: planned,
        })
    }

    pub fn check_noc_transfer(
        &self,
        route: &str,
        requested_gbps: usize,
    ) -> Result<(), ConstraintViolation> {
        let current_usage = self.current_noc_routes.get(route).unwrap_or(&0);
        if *current_usage + requested_gbps > self.config.noc_bandwidth_gbps {
            return Err(ConstraintViolation::NocBandwidthExceeded {
                route: route.to_string(),
                requested_gbps,
                limit_gbps: self.config.noc_bandwidth_gbps,
            });
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dram_exhausted() {
        let config = MemoryPlannerConfig {
            total_dram_bytes: 1024,
            l1_per_core_bytes: 1024,
            noc_bandwidth_gbps: 100,
            alignment_bytes: 32,
        };
        let mut planner = TensixMemoryPlanner::new(config);

        let requests = vec![
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::Dram,
                size_bytes: 512,
                core_x: 0,
                core_y: 0,
                tile_count: 0,
            },
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::Dram,
                size_bytes: 1024, // Over the limit since 512 is already requested
                core_x: 0,
                core_y: 0,
                tile_count: 0,
            },
        ];

        let result = planner.plan(&requests);
        assert!(matches!(
            result,
            Err(ConstraintViolation::DramExhausted { .. })
        ));
    }

    #[test]
    fn test_l1_exhausted() {
        let config = MemoryPlannerConfig {
            total_dram_bytes: 1024,
            l1_per_core_bytes: 1024,
            noc_bandwidth_gbps: 100,
            alignment_bytes: 32,
        };
        let mut planner = TensixMemoryPlanner::new(config);

        let requests = vec![
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::L1,
                size_bytes: 512,
                core_x: 1,
                core_y: 2,
                tile_count: 0,
            },
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::L1,
                size_bytes: 1024, // Over the limit for core (1, 2)
                core_x: 1,
                core_y: 2,
                tile_count: 0,
            },
        ];

        let result = planner.plan(&requests);
        assert!(matches!(
            result,
            Err(ConstraintViolation::L1Exhausted { .. })
        ));
    }

    #[test]
    fn test_cb_depth_invalid() {
        let config = MemoryPlannerConfig {
            total_dram_bytes: 1024,
            l1_per_core_bytes: 1024,
            noc_bandwidth_gbps: 100,
            alignment_bytes: 32,
        };
        let mut planner = TensixMemoryPlanner::new(config);

        let requests = vec![TensixRegionMaterialization {
            memory_type: TensixMemoryType::CircularBuffer(0),
            size_bytes: 64,
            core_x: 0,
            core_y: 0,
            tile_count: 1, // Invalid, requires at least 2
        }];

        let result = planner.plan(&requests);
        assert!(matches!(
            result,
            Err(ConstraintViolation::CbDepthInvalid { .. })
        ));
    }

    #[test]
    fn test_alignment_invalid() {
        let config = MemoryPlannerConfig {
            total_dram_bytes: 1024,
            l1_per_core_bytes: 1024,
            noc_bandwidth_gbps: 100,
            alignment_bytes: 32,
        };
        let mut planner = TensixMemoryPlanner::new(config);

        let requests = vec![TensixRegionMaterialization {
            memory_type: TensixMemoryType::Dram,
            size_bytes: 15, // Not aligned to 32
            core_x: 0,
            core_y: 0,
            tile_count: 0,
        }];

        let result = planner.plan(&requests);
        assert!(matches!(
            result,
            Err(ConstraintViolation::AlignmentInvalid { .. })
        ));
    }

    #[test]
    fn test_valid_allocation() {
        let config = MemoryPlannerConfig {
            total_dram_bytes: 1024,
            l1_per_core_bytes: 1024,
            noc_bandwidth_gbps: 100,
            alignment_bytes: 32,
        };
        let mut planner = TensixMemoryPlanner::new(config);

        let requests = vec![
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::Dram,
                size_bytes: 512,
                core_x: 0,
                core_y: 0,
                tile_count: 0,
            },
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::L1,
                size_bytes: 256,
                core_x: 1,
                core_y: 1,
                tile_count: 0,
            },
            TensixRegionMaterialization {
                memory_type: TensixMemoryType::CircularBuffer(0),
                size_bytes: 64,
                core_x: 1,
                core_y: 1,
                tile_count: 2,
            },
        ];

        let result = planner.plan(&requests);
        assert!(result.is_ok());
        let map = result.unwrap();
        assert_eq!(map.allocations.len(), 3);
    }
}
