use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::graph_catalog::all_families;
use super::lattice_validation::LatticeValidationError;
use super::shape_profiles::{LARGE, MEDIUM, SMALL};

pub const COVERAGE_LATTICE_SCHEMA_VERSION: &str = "coverage-lattice.v2";

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
pub struct LatticeCellKey {
    pub backend: String,
    pub graph_family: String,
    pub shape_profile: String,
    pub runtime_policy: String,
}

impl LatticeCellKey {
    pub fn new(
        backend: &str,
        graph_family: &str,
        shape_profile: &str,
        runtime_policy: &str,
    ) -> Self {
        Self {
            backend: backend.to_string(),
            graph_family: graph_family.to_string(),
            shape_profile: shape_profile.to_string(),
            runtime_policy: runtime_policy.to_string(),
        }
    }

    pub fn to_cell_id(&self) -> String {
        lattice_cell_id(
            &self.backend,
            &self.graph_family,
            &self.shape_profile,
            &self.runtime_policy,
        )
    }

    pub fn parse_cell_id(cell_id: &str) -> Result<Self, LatticeValidationError> {
        let mut parts = cell_id.split('/');
        let schema =
            parts
                .next()
                .ok_or_else(|| LatticeValidationError::MalformedLatticeCellId {
                    lattice_cell_id: cell_id.to_string(),
                    reason: "missing schema prefix".to_string(),
                })?;
        if schema != COVERAGE_LATTICE_SCHEMA_VERSION {
            return Err(LatticeValidationError::MalformedLatticeCellId {
                lattice_cell_id: cell_id.to_string(),
                reason: format!("expected schema prefix {}", COVERAGE_LATTICE_SCHEMA_VERSION),
            });
        }

        let backend =
            parts
                .next()
                .ok_or_else(|| LatticeValidationError::MalformedLatticeCellId {
                    lattice_cell_id: cell_id.to_string(),
                    reason: "missing backend".to_string(),
                })?;
        let graph_family =
            parts
                .next()
                .ok_or_else(|| LatticeValidationError::MalformedLatticeCellId {
                    lattice_cell_id: cell_id.to_string(),
                    reason: "missing graph family".to_string(),
                })?;
        let shape_profile =
            parts
                .next()
                .ok_or_else(|| LatticeValidationError::MalformedLatticeCellId {
                    lattice_cell_id: cell_id.to_string(),
                    reason: "missing shape profile".to_string(),
                })?;
        let runtime_policy =
            parts
                .next()
                .ok_or_else(|| LatticeValidationError::MalformedLatticeCellId {
                    lattice_cell_id: cell_id.to_string(),
                    reason: "missing runtime policy".to_string(),
                })?;

        if parts.next().is_some()
            || backend.is_empty()
            || graph_family.is_empty()
            || shape_profile.is_empty()
            || runtime_policy.is_empty()
        {
            return Err(LatticeValidationError::MalformedLatticeCellId {
                lattice_cell_id: cell_id.to_string(),
                reason: "expected exactly five non-empty slash-separated components".to_string(),
            });
        }

        Ok(Self::new(
            backend,
            graph_family,
            shape_profile,
            runtime_policy,
        ))
    }
}

pub fn lattice_cell_id(
    backend: &str,
    graph_family: &str,
    shape_profile: &str,
    runtime_policy: &str,
) -> String {
    format!(
        "{}/{}/{}/{}/{}",
        COVERAGE_LATTICE_SCHEMA_VERSION, backend, graph_family, shape_profile, runtime_policy
    )
}

pub fn parse_lattice_cell_id(cell_id: &str) -> Result<LatticeCellKey, LatticeValidationError> {
    LatticeCellKey::parse_cell_id(cell_id)
}

pub fn expected_lattice_cells() -> BTreeSet<LatticeCellKey> {
    let mut cells = BTreeSet::new();
    let shapes = [SMALL.name, MEDIUM.name, LARGE.name];
    let backends = [
        ("coreml", &["cpuOnly", "cpuAndGPU"][..]),
        ("mlx", &["mlx_default"][..]),
        ("accelerate", &["accelerate_cpu"][..]),
    ];

    for family in all_families() {
        for shape in shapes {
            for (backend, policies) in backends {
                for policy in policies {
                    cells.insert(LatticeCellKey::new(backend, family.name, shape, policy));
                }
            }
        }
    }

    cells
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expected_lattice_universe_has_96_cells() {
        assert_eq!(expected_lattice_cells().len(), 96);
    }

    #[test]
    fn expected_lattice_universe_has_no_duplicates() {
        let cells = expected_lattice_cells();
        let rendered: BTreeSet<String> = cells.iter().map(LatticeCellKey::to_cell_id).collect();
        assert_eq!(rendered.len(), cells.len());
    }

    #[test]
    fn lattice_cell_id_round_trips() {
        let key = LatticeCellKey::new("coreml", "matmul", "medium", "cpuOnly");
        let parsed =
            LatticeCellKey::parse_cell_id(&key.to_cell_id()).expect("parse lattice cell id");
        assert_eq!(parsed, key);
    }
}
