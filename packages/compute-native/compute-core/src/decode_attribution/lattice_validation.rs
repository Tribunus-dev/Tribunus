use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use super::graph_catalog::{canonical_family_name, identity_baseline_family_name};
use super::lattice::{expected_lattice_cells, parse_lattice_cell_id, LatticeCellKey};
use super::receipt::DecodeAttributionReceipt;
use super::report::{CoverageLattice, CoverageLatticeRow};

pub const LATTICE_VALIDATION_SCHEMA_VERSION: &str = "coverage-lattice.validation.v2";
pub const LATTICE_VALIDATOR_VERSION: &str = "coverage-lattice-validator.v2";

const MATERIALIZE_STATUSES: &[&str] = &["ok", "error", "not_applicable"];
const COMPILE_STATUSES: &[&str] = &["ok", "error", "not_applicable"];
const LOAD_STATUSES: &[&str] = &["ok", "error", "not_applicable"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SupportTier {
    SupportedNative,
    SupportedComposed,
    UnsupportedGraph,
    NotImplemented,
}

impl SupportTier {
    fn parse(s: &str) -> Result<Self, ()> {
        match s {
            "supported_native" => Ok(Self::SupportedNative),
            "supported_composed" => Ok(Self::SupportedComposed),
            "unsupported_graph" => Ok(Self::UnsupportedGraph),
            "not_implemented" => Ok(Self::NotImplemented),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BackendSupportStatus {
    Supported,
    UnsupportedGraph,
    NotImplemented,
}

impl BackendSupportStatus {
    fn parse(s: &str) -> Result<Self, ()> {
        match s {
            "supported" => Ok(Self::Supported),
            "unsupported_graph" => Ok(Self::UnsupportedGraph),
            "not_implemented" => Ok(Self::NotImplemented),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TerminalPhase {
    Complete,
    MilBuild,
    Compile,
    Load,
    Predict,
    Conformance,
    SkippedBySupport,
}

impl TerminalPhase {
    fn parse(s: &str) -> Result<Self, ()> {
        match s {
            "complete" => Ok(Self::Complete),
            "mil_build" => Ok(Self::MilBuild),
            "compile" => Ok(Self::Compile),
            "load" => Ok(Self::Load),
            "predict" => Ok(Self::Predict),
            "conformance" => Ok(Self::Conformance),
            "skipped_by_support" => Ok(Self::SkippedBySupport),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PredictStatus {
    Pass,
    Failed,
    SkippedBySupport,
    SkippedByPolicy,
    NotAttempted,
    MaterializeLimited,
    CompileLimited,
    LoadBlocked,
    PredictBlocked,
    NumericalDivergence,
    Timeout,
    MemoryOom,
}

impl PredictStatus {
    fn parse(s: &str) -> Result<Self, ()> {
        match s {
            "pass" | "passed" => Ok(Self::Pass),
            "failed" => Ok(Self::Failed),
            "skipped_by_support" => Ok(Self::SkippedBySupport),
            "skipped_by_policy" => Ok(Self::SkippedByPolicy),
            "not_attempted" => Ok(Self::NotAttempted),
            "materialize_limited" => Ok(Self::MaterializeLimited),
            "compile_limited" => Ok(Self::CompileLimited),
            "load_blocked" => Ok(Self::LoadBlocked),
            "predict_blocked" => Ok(Self::PredictBlocked),
            "numerical_divergence" => Ok(Self::NumericalDivergence),
            "timeout" => Ok(Self::Timeout),
            "memory_oom" => Ok(Self::MemoryOom),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PredictFailureClassification {
    SkippedBySupport,
    SkippedByPolicy,
    NotAttempted,
    MaterializeLimited,
    CompileLimited,
    LoadBlocked,
    PredictBlocked,
    NumericalDivergence,
    Timeout,
    MemoryOom,
}

impl PredictFailureClassification {
    fn parse(s: &str) -> Result<Self, ()> {
        match s {
            "skipped_by_support" => Ok(Self::SkippedBySupport),
            "skipped_by_policy" => Ok(Self::SkippedByPolicy),
            "not_attempted" => Ok(Self::NotAttempted),
            "materialize_limited" => Ok(Self::MaterializeLimited),
            "compile_limited" => Ok(Self::CompileLimited),
            "load_blocked" => Ok(Self::LoadBlocked),
            "predict_blocked" => Ok(Self::PredictBlocked),
            "numerical_divergence" => Ok(Self::NumericalDivergence),
            "timeout" => Ok(Self::Timeout),
            "memory_oom" => Ok(Self::MemoryOom),
            _ => Err(()),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum LatticeValidationError {
    MissingLatticeCellId,
    MalformedLatticeCellId {
        lattice_cell_id: String,
        reason: String,
    },
    LatticeCellIdRowFieldMismatch {
        expected: String,
        actual: String,
    },
    UnexpectedLatticeCell {
        lattice_cell_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateCellReport {
    pub lattice_cell_id: String,
    pub observed_count: usize,
    pub row_indices: Vec<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvalidCellReport {
    pub row_index: usize,
    pub lattice_cell_id: Option<String>,
    pub reason: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateExclusion {
    pub row_index: usize,
    pub lattice_cell_id: String,
    pub reason: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AggregateInputSummary {
    pub valid_rows: usize,
    pub included_rows: usize,
    pub excluded_rows: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeValidationReceipt {
    pub schema_version: String,
    pub validator_version: String,
    pub run_id: String,
    pub passed: bool,
    pub observed_row_count: usize,
    pub expected_cell_count: usize,
    pub unique_cell_count: usize,
    pub missing_cells: Vec<String>,
    pub duplicate_cells: Vec<DuplicateCellReport>,
    pub invalid_cells: Vec<InvalidCellReport>,
    pub aggregate_input_summary: AggregateInputSummary,
    pub aggregate_exclusions: Vec<AggregateExclusion>,
}

struct ValidatedRow {
    cell_key: LatticeCellKey,
    aggregate_exclusion: Option<AggregateExclusion>,
}

pub fn validate_lattice(
    run_id: &str,
    receipts: &[DecodeAttributionReceipt],
) -> LatticeValidationReceipt {
    let expected_cells = expected_lattice_cells();
    let expected_cell_count = expected_cells.len();
    let observed_row_count = receipts.len();
    let baseline_commit_sha = receipts
        .first()
        .map(|r| r.commit_sha.clone())
        .unwrap_or_default();

    let mut seen_cells: BTreeMap<LatticeCellKey, Vec<usize>> = BTreeMap::new();
    let mut invalid_cells = Vec::new();
    let mut aggregate_exclusions = Vec::new();
    let mut valid_row_count = 0usize;

    for (row_index, row) in receipts.iter().enumerate() {
        match validate_row(
            row_index,
            run_id,
            &baseline_commit_sha,
            row,
            &expected_cells,
        ) {
            Ok(validated) => {
                valid_row_count += 1;
                seen_cells
                    .entry(validated.cell_key.clone())
                    .or_default()
                    .push(row_index);
                if let Some(exclusion) = validated.aggregate_exclusion {
                    aggregate_exclusions.push(exclusion);
                }
            }
            Err(invalid) => invalid_cells.push(invalid),
        }
    }

    let seen_valid_cells: BTreeSet<LatticeCellKey> = seen_cells.keys().cloned().collect();
    let unique_cell_count = seen_valid_cells.len();
    let missing_cells = expected_cells
        .difference(&seen_valid_cells)
        .map(LatticeCellKey::to_cell_id)
        .collect::<Vec<_>>();

    let duplicate_cells = seen_cells
        .iter()
        .filter(|(_, row_indices)| row_indices.len() > 1)
        .map(|(cell_key, row_indices)| DuplicateCellReport {
            lattice_cell_id: cell_key.to_cell_id(),
            observed_count: row_indices.len(),
            row_indices: row_indices.clone(),
        })
        .collect::<Vec<_>>();

    let aggregate_input_summary = AggregateInputSummary {
        valid_rows: valid_row_count,
        included_rows: valid_row_count.saturating_sub(aggregate_exclusions.len()),
        excluded_rows: aggregate_exclusions.len(),
    };

    let passed = invalid_cells.is_empty() && duplicate_cells.is_empty() && missing_cells.is_empty();

    LatticeValidationReceipt {
        schema_version: LATTICE_VALIDATION_SCHEMA_VERSION.to_string(),
        validator_version: LATTICE_VALIDATOR_VERSION.to_string(),
        run_id: run_id.to_string(),
        passed,
        observed_row_count,
        expected_cell_count,
        unique_cell_count,
        missing_cells,
        duplicate_cells,
        invalid_cells,
        aggregate_input_summary,
        aggregate_exclusions,
    }
}

pub fn validate_lattice_artifact(coverage: &CoverageLattice) -> LatticeValidationReceipt {
    let expected_cells = expected_lattice_cells();
    let expected_cell_count = expected_cells.len();
    let observed_row_count = coverage.rows.len();
    let baseline_commit_sha = coverage.commit_sha.clone();

    let mut seen_cells: BTreeMap<LatticeCellKey, Vec<usize>> = BTreeMap::new();
    let mut invalid_cells = Vec::new();
    let mut aggregate_exclusions = Vec::new();
    let mut valid_row_count = 0usize;

    for (row_index, row) in coverage.rows.iter().enumerate() {
        match validate_artifact_row(
            row_index,
            &coverage.run_id,
            &baseline_commit_sha,
            row,
            &expected_cells,
        ) {
            Ok(validated) => {
                valid_row_count += 1;
                seen_cells
                    .entry(validated.cell_key.clone())
                    .or_default()
                    .push(row_index);
                if let Some(exclusion) = validated.aggregate_exclusion {
                    aggregate_exclusions.push(exclusion);
                }
            }
            Err(invalid) => invalid_cells.push(invalid),
        }
    }

    let seen_valid_cells: BTreeSet<LatticeCellKey> = seen_cells.keys().cloned().collect();
    let unique_cell_count = seen_valid_cells.len();
    let missing_cells = expected_cells
        .difference(&seen_valid_cells)
        .map(LatticeCellKey::to_cell_id)
        .collect::<Vec<_>>();

    let duplicate_cells = seen_cells
        .iter()
        .filter(|(_, row_indices)| row_indices.len() > 1)
        .map(|(cell_key, row_indices)| DuplicateCellReport {
            lattice_cell_id: cell_key.to_cell_id(),
            observed_count: row_indices.len(),
            row_indices: row_indices.clone(),
        })
        .collect::<Vec<_>>();

    let aggregate_input_summary = AggregateInputSummary {
        valid_rows: valid_row_count,
        included_rows: valid_row_count.saturating_sub(aggregate_exclusions.len()),
        excluded_rows: aggregate_exclusions.len(),
    };

    let passed = invalid_cells.is_empty() && duplicate_cells.is_empty() && missing_cells.is_empty();

    LatticeValidationReceipt {
        schema_version: LATTICE_VALIDATION_SCHEMA_VERSION.to_string(),
        validator_version: LATTICE_VALIDATOR_VERSION.to_string(),
        run_id: coverage.run_id.clone(),
        passed,
        observed_row_count,
        expected_cell_count,
        unique_cell_count,
        missing_cells,
        duplicate_cells,
        invalid_cells,
        aggregate_input_summary,
        aggregate_exclusions,
    }
}

fn validate_artifact_row(
    row_index: usize,
    expected_run_id: &str,
    expected_commit_sha: &str,
    row: &CoverageLatticeRow,
    expected_cells: &BTreeSet<LatticeCellKey>,
) -> Result<ValidatedRow, InvalidCellReport> {
    // This is a bridge that maps CoverageLatticeRow to a synthetic DecodeAttributionReceipt
    // for reuse of the existing validate_row logic.
    //
    // Long term we should probably make validate_row generic or have it work on
    // a shared trait, but for now this mapping is sufficient.
    let mut receipt = DecodeAttributionReceipt::default();
    receipt.run_id = row.run_id.clone();
    receipt.commit_sha = row.commit_sha.clone();
    receipt.backend = row.backend.clone();
    receipt.graph_family = row.graph_family.clone();
    receipt.shape_profile = row.shape_profile.clone();
    receipt.backend_runtime_policy = row.runtime_policy.clone();
    receipt.lattice_cell_id = row.lattice_cell_id.clone();
    receipt.support_tier = row.support_tier.clone();
    receipt.predict_status = row.predict_status.clone();
    receipt.predict_failure_classification = row.predict_failure_classification.clone();
    receipt.max_absolute_error = row.max_absolute_error;
    receipt.steady_p50_ns = row.steady_p50_ns;
    receipt.materialize_duration_ns = row.materialize_duration_ns;
    receipt.compile_duration_ns = row.compile_duration_ns;
    receipt.load_duration_ns = row.load_duration_ns;
    receipt.cold_first_predict_ns = row.cold_first_predict_ns;
    receipt.reference_output_hashes_populated = row.reference_output_hashes_populated;
    receipt.reference_status = row.reference_status.clone();
    receipt.terminal_phase = row.terminal_phase.clone();
    receipt.backend_support_status = row.backend_support_status.clone();
    receipt.materialize_status = row.materialize_status.clone();
    receipt.compile_status = row.compile_status.clone();
    receipt.load_status = row.load_status.clone();
    receipt.reference_output_hashes = row.reference_output_hashes.clone();
    receipt.cold_output_hashes = row.backend_output_hashes.clone();
    receipt.matches_tolerance = row.matches_tolerance;
    receipt.execution_proof.notes = Some(row.execution_proof_summary.clone());
    receipt.execution_proof.cpu_glue_ops = row.execution_proof_cpu_glue_ops.clone();
    receipt.mlx_compile_attempted = row.mlx_compile_attempted;

    validate_row(
        row_index,
        expected_run_id,
        expected_commit_sha,
        &receipt,
        expected_cells,
    )
}

fn validate_row(
    row_index: usize,
    expected_run_id: &str,
    expected_commit_sha: &str,
    row: &DecodeAttributionReceipt,
    expected_cells: &BTreeSet<LatticeCellKey>,
) -> Result<ValidatedRow, InvalidCellReport> {
    let lattice_cell_id = if row.lattice_cell_id.is_empty() {
        return Err(invalid_report(
            row_index,
            None,
            "missing_lattice_cell_id",
            "lattice_cell_id was empty",
        ));
    } else {
        row.lattice_cell_id.clone()
    };

    let parsed = match parse_lattice_cell_id(&lattice_cell_id) {
        Ok(parsed) => parsed,
        Err(LatticeValidationError::MalformedLatticeCellId { reason, .. }) => {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id),
                "malformed_lattice_cell_id",
                &reason,
            ));
        }
        Err(_) => {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id),
                "malformed_lattice_cell_id",
                "unexpected parse failure",
            ));
        }
    };

    let expected_key = LatticeCellKey::new(
        &row.backend,
        &row.graph_family,
        &row.shape_profile,
        &row.backend_runtime_policy,
    );
    if parsed != expected_key {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id),
            "lattice_cell_id_row_field_mismatch",
            &format!(
                "expected {}, observed {}",
                expected_key.to_cell_id(),
                parsed.to_cell_id(),
            ),
        ));
    }

    if !expected_cells.contains(&parsed) {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id),
            "unexpected_lattice_cell",
            &format!(
                "{} is outside the canonical coverage universe",
                parsed.to_cell_id()
            ),
        ));
    }

    if row.run_id != expected_run_id {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id),
            "mixed_run_id",
            &format!("expected {}, observed {}", expected_run_id, row.run_id),
        ));
    }

    if row.commit_sha != expected_commit_sha {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id),
            "mixed_commit_sha",
            &format!(
                "expected {}, observed {}",
                expected_commit_sha, row.commit_sha
            ),
        ));
    }

    validate_known_value(
        row_index,
        &lattice_cell_id,
        "materialize_status",
        &row.materialize_status,
        MATERIALIZE_STATUSES,
    )?;
    validate_known_value(
        row_index,
        &lattice_cell_id,
        "compile_status",
        &row.compile_status,
        COMPILE_STATUSES,
    )?;
    validate_known_value(
        row_index,
        &lattice_cell_id,
        "load_status",
        &row.load_status,
        LOAD_STATUSES,
    )?;

    let support_tier = SupportTier::parse(&row.support_tier).map_err(|_| {
        invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "unknown_support_tier",
            &format!(
                "support_tier={} is not in the canonical lattice vocabulary",
                row.support_tier
            ),
        )
    })?;

    let _backend_support_status = BackendSupportStatus::parse(&row.backend_support_status)
        .map_err(|_| {
            invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "unknown_backend_support_status",
                &format!(
                    "backend_support_status={} is not in the canonical lattice vocabulary",
                    row.backend_support_status
                ),
            )
        })?;

    let predict_status = PredictStatus::parse(&row.predict_status).map_err(|_| {
        invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "unknown_predict_status",
            &format!(
                "predict_status={} is not in the canonical lattice vocabulary",
                row.predict_status
            ),
        )
    })?;

    let terminal_phase = TerminalPhase::parse(&row.terminal_phase).map_err(|_| {
        invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "unknown_terminal_phase",
            &format!(
                "terminal_phase={} is not in the canonical lattice vocabulary",
                row.terminal_phase
            ),
        )
    })?;

    if predict_status == PredictStatus::Pass {
        if !row.predict_failure_classification.is_empty() {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id),
                "pass_with_failure_classification",
                "passed rows must leave predict_failure_classification empty",
            ));
        }
    } else {
        if row.predict_failure_classification.is_empty() {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id),
                "failed_without_failure_classification",
                "non-pass rows must set predict_failure_classification",
            ));
        }
        let failure_class = PredictFailureClassification::parse(
            &row.predict_failure_classification,
        )
        .map_err(|_| {
            invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "unknown_predict_failure_classification",
                &format!(
                    "predict_failure_classification={} is not in the canonical lattice vocabulary",
                    row.predict_failure_classification
                ),
            )
        })?;

        // Enforce Phase/Failure compatibility
        let expected_phase = match failure_class {
            PredictFailureClassification::CompileLimited => TerminalPhase::Compile, // or MilBuild handled loosely
            PredictFailureClassification::LoadBlocked => TerminalPhase::Load,
            PredictFailureClassification::PredictBlocked => TerminalPhase::Predict,
            PredictFailureClassification::NumericalDivergence => TerminalPhase::Conformance,
            PredictFailureClassification::SkippedBySupport => TerminalPhase::SkippedBySupport,
            _ => terminal_phase.clone(), // Skip exact match for remaining for now
        };

        if failure_class == PredictFailureClassification::CompileLimited
            && terminal_phase != TerminalPhase::Compile
            && terminal_phase != TerminalPhase::MilBuild
        {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "phase_failure_mismatch",
                "compile_limited must terminate at compile or mil_build",
            ));
        } else if failure_class != PredictFailureClassification::CompileLimited
            && terminal_phase != expected_phase
            && matches!(
                failure_class,
                PredictFailureClassification::LoadBlocked
                    | PredictFailureClassification::PredictBlocked
                    | PredictFailureClassification::NumericalDivergence
                    | PredictFailureClassification::SkippedBySupport
            )
        {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "phase_failure_mismatch",
                &format!(
                    "failure class {:?} must terminate at {:?}",
                    failure_class, expected_phase
                ),
            ));
        }
    }

    if predict_status == PredictStatus::Pass && terminal_phase != TerminalPhase::Complete {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "phase_failure_mismatch",
            "pass must terminate at complete",
        ));
    }

    if matches!(
        support_tier,
        SupportTier::UnsupportedGraph | SupportTier::NotImplemented
    ) {
        if predict_status == PredictStatus::Pass {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "unsupported_graph_with_passed_status",
                "unsupported graph rows cannot report pass",
            ));
        }
        if predict_status != PredictStatus::SkippedBySupport {
            return Err(invalid_report(
                row_index,
                Some(lattice_cell_id.clone()),
                "unsupported_graph_with_passed_status",
                "unsupported rows must be skipped_by_support",
            ));
        }
    }

    if predict_status == PredictStatus::SkippedBySupport
        && !matches!(
            support_tier,
            SupportTier::UnsupportedGraph | SupportTier::NotImplemented
        )
    {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "unsupported_graph_with_passed_status",
            "skipped_by_support requires unsupported or not_implemented support",
        ));
    }

    if !row.reference_output_hashes_populated || row.reference_output_hashes.is_empty() {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "missing_reference_hashes",
            "reference_output_hashes must be populated for every row",
        ));
    }

    if predict_status == PredictStatus::NumericalDivergence
        && row.cold_output_hashes.is_empty()
        && row.accelerate_output_hashes.is_empty()
    {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "numerical_divergence_without_backend_output",
            "numerical divergence rows must carry backend output hashes",
        ));
    }

    if predict_status == PredictStatus::Pass && !row.matches_tolerance {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "pass_without_tolerance_match",
            "passed rows must satisfy numerical tolerance",
        ));
    }

    if predict_status == PredictStatus::Pass && row.steady_p50_ns == 0 {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "pass_without_timing",
            "passed rows must carry valid steady-state timing",
        ));
    }

    if predict_status == PredictStatus::Pass
        && row.cold_output_hashes.is_empty()
        && row.accelerate_output_hashes.is_empty()
    {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "pass_without_backend_output",
            "passed rows must carry backend output hashes",
        ));
    }

    if support_tier == SupportTier::SupportedNative && !row.execution_proof.cpu_glue_ops.is_empty()
    {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "supported_native_with_cpu_glue",
            "supported_native rows must not contain CPU glue operations in execution proof",
        ));
    }

    if row.backend == "mlx" && row.mlx_compile_attempted {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "backend_specific_truth_violation",
            "MLX must not claim compile attempts in this gate",
        ));
    }

    if row.backend == "accelerate"
        && matches!(support_tier, SupportTier::UnsupportedGraph)
        && (!row.cold_output_hashes.is_empty() || !row.accelerate_output_hashes.is_empty())
    {
        return Err(invalid_report(
            row_index,
            Some(lattice_cell_id.clone()),
            "backend_specific_truth_violation",
            "Accelerate unsupported rows must not include successful backend hashes",
        ));
    }

    let aggregate_exclusion =
        aggregate_exclusion_for(row_index, &lattice_cell_id, row, &predict_status);

    Ok(ValidatedRow {
        cell_key: parsed,
        aggregate_exclusion,
    })
}

fn aggregate_exclusion_for(
    row_index: usize,
    lattice_cell_id: &str,
    row: &DecodeAttributionReceipt,
    predict_status: &PredictStatus,
) -> Option<AggregateExclusion> {
    if canonical_family_name(row.graph_family.as_str()) == "identity_passthrough" {
        return Some(AggregateExclusion {
            row_index,
            lattice_cell_id: lattice_cell_id.to_string(),
            reason: identity_baseline_family_name().to_string(),
            detail: "identity rows are excluded from latency aggregates".to_string(),
        });
    }

    if predict_status == &PredictStatus::Pass {
        if row.steady_p50_ns == 0 {
            return Some(AggregateExclusion {
                row_index,
                lattice_cell_id: lattice_cell_id.to_string(),
                reason: "missing_timing".to_string(),
                detail: "latency aggregates require nonzero steady timing".to_string(),
            });
        }
        return None;
    }

    Some(AggregateExclusion {
        row_index,
        lattice_cell_id: lattice_cell_id.to_string(),
        reason: row.predict_status.clone(),
        detail: "non-pass rows are excluded from aggregate timing calculations".to_string(),
    })
}

fn validate_known_value(
    row_index: usize,
    lattice_cell_id: &str,
    field: &str,
    value: &str,
    allowed: &[&str],
) -> Result<(), InvalidCellReport> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(invalid_report(
            row_index,
            Some(lattice_cell_id.to_string()),
            &format!("unknown_{}", field),
            &format!(
                "{}={} is not in the canonical lattice vocabulary",
                field, value
            ),
        ))
    }
}

fn invalid_report(
    row_index: usize,
    lattice_cell_id: Option<String>,
    reason: &str,
    detail: &str,
) -> InvalidCellReport {
    InvalidCellReport {
        row_index,
        lattice_cell_id,
        reason: reason.to_string(),
        detail: detail.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::super::receipt::ExecutionProof;
    use super::super::shape_profiles::{ShapeProfile, LARGE, MEDIUM, SMALL};
    use super::*;

    #[derive(Clone, Copy)]
    enum WriterOutcome {
        Pass,
        CoreMlCompileLimited,
        MlxPredictBlocked,
        AccelerateSkippedBySupport,
    }

    fn writer_shape_profile(shape_profile: &str) -> &'static ShapeProfile {
        match shape_profile {
            "small" => &SMALL,
            "medium" => &MEDIUM,
            "large" => &LARGE,
            other => panic!("unexpected shape profile {other}"),
        }
    }

    fn family_pipeline_phase(family_name: &str) -> &'static str {
        match canonical_family_name(family_name) {
            "identity_passthrough" => "identity",
            "chain_matmul_add_silu" => "mlp",
            _ => "projection",
        }
    }

    fn family_op_count(family_name: &str) -> u32 {
        match canonical_family_name(family_name) {
            "matmul" => 1,
            "chain_matmul_add_silu" => 3,
            "branch_rejoin" => 3,
            "multi_output" => 2,
            "constant_heavy" => 1,
            "reshape_transpose_matmul" => 4,
            "softmax_tail" => 2,
            "identity_passthrough" => 1,
            other => panic!("unexpected family {other}"),
        }
    }

    fn family_output_shapes(family_name: &str, profile: &ShapeProfile) -> Vec<Vec<u32>> {
        match canonical_family_name(family_name) {
            "multi_output" => vec![vec![1, profile.weight_cols], vec![1, profile.input_cols]],
            "identity_passthrough" => vec![vec![1, profile.input_cols]],
            _ => vec![vec![1, profile.weight_cols]],
        }
    }

    fn output_hashes_for(family_name: &str, shape_profile: &str, prefix: &str) -> Vec<String> {
        let profile = writer_shape_profile(shape_profile);
        family_output_shapes(family_name, profile)
            .into_iter()
            .enumerate()
            .map(|(index, shape)| {
                let dims = shape
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join("x");
                format!(
                    "{}-{}-{}-{}",
                    prefix,
                    canonical_family_name(family_name),
                    dims,
                    index
                )
            })
            .collect()
    }

    fn family_ops(family_name: &str) -> Vec<String> {
        match canonical_family_name(family_name) {
            "matmul" => vec!["matmul".into()],
            "chain_matmul_add_silu" => vec![
                "matmul".into(),
                "add".into(),
                "sigmoid".into(),
                "mul".into(),
            ],
            "constant_heavy" => vec!["fill".into(), "matmul".into(), "add".into()],
            "branch_rejoin" => vec!["matmul".into(), "add".into(), "matmul".into(), "add".into()],
            "identity_passthrough" => vec!["identity".into()],
            "multi_output" => vec!["matmul".into(), "add".into()],
            "reshape_transpose_matmul" => {
                vec!["reshape".into(), "transpose".into(), "matmul".into()]
            }
            "softmax_tail" => vec!["matmul".into(), "softmax".into()],
            other => vec![other.into()],
        }
    }

    fn mlx_support_tier_for(family_name: &str) -> &'static str {
        match canonical_family_name(family_name) {
            "matmul" | "identity_passthrough" => "supported_native",
            _ => "supported_composed",
        }
    }

    fn accelerate_support_tier_for(family_name: &str) -> &'static str {
        match canonical_family_name(family_name) {
            "matmul"
            | "constant_heavy"
            | "matmul_projection"
            | "chain_matmul_add_silu"
            | "branch_rejoin"
            | "identity_passthrough"
            | "identity" => "supported_native",
            "add_standalone"
            | "mul_standalone"
            | "sigmoid_standalone"
            | "silu_standalone"
            | "matmul_residual_add"
            | "two_matmul_add"
            | "matmul_add_silu" => "supported_composed",
            _ => "unsupported_graph",
        }
    }

    fn accel_blas_ops_for(family_name: &str) -> Vec<String> {
        if canonical_family_name(family_name).contains("matmul") {
            vec!["matmul:cblas_sgemm".into()]
        } else {
            vec![]
        }
    }

    fn accel_vdsp_ops_for(family_name: &str) -> Vec<String> {
        if canonical_family_name(family_name).contains("add")
            || canonical_family_name(family_name).contains("mul")
            || canonical_family_name(family_name).contains("transpose")
        {
            vec!["add:vDSP_vadd".into()]
        } else {
            vec![]
        }
    }

    fn accel_vforce_ops_for(family_name: &str) -> Vec<String> {
        if canonical_family_name(family_name).contains("silu")
            || canonical_family_name(family_name).contains("sigmoid")
        {
            vec!["sigmoid:vvexpf".into()]
        } else {
            vec![]
        }
    }

    fn writer_like_receipt(
        run_id: &str,
        cell: &LatticeCellKey,
        matrix_name: &str,
    ) -> DecodeAttributionReceipt {
        let profile = writer_shape_profile(cell.shape_profile.as_str());
        let mut receipt = DecodeAttributionReceipt::default();
        receipt.run_id = run_id.to_string();
        receipt.commit_sha = "commit-sha-1".to_string();
        receipt.branch = "main".to_string();
        receipt.timestamp = "2026-06-13T00:00:00Z".to_string();
        receipt.schema_version = "decode-attribution.v1".to_string();
        receipt.host_chip = "arm64".to_string();
        receipt.macos_version = "15.5".to_string();
        receipt.xcode_version = "17.0".to_string();
        receipt.coremlcompiler_version = "17.0".to_string();
        receipt.graph_family = cell.graph_family.clone();
        receipt.pipeline_phase =
            Some(family_pipeline_phase(cell.graph_family.as_str()).to_string());
        receipt.phase_variant = cell.runtime_policy.clone();
        receipt.semantic_contract_id = format!(
            "{}::{}::{}",
            cell.backend, cell.graph_family, cell.shape_profile
        );
        receipt.shape_profile = cell.shape_profile.clone();
        receipt.graph_status = if canonical_family_name(cell.graph_family.as_str())
            == identity_baseline_family_name()
        {
            "baseline".to_string()
        } else {
            "normal".to_string()
        };
        receipt.op_count = family_op_count(cell.graph_family.as_str());
        receipt.input_shape = profile.input_shape();
        receipt.weight_shape = profile.weight_shape();
        receipt.output_shapes = family_output_shapes(cell.graph_family.as_str(), profile);
        receipt.dtype = "float32".to_string();
        receipt.matrix_name = matrix_name.to_string();
        receipt.matrix_required = true;
        receipt.configured_warmup_iterations = 10;
        receipt.configured_steady_iterations = 100;
        receipt.tolerance = 1e-4;
        receipt.percentile_method = "nearest_rank".to_string();
        receipt.memory_measurement_method = "task_info_resident_size".to_string();
        receipt.backend = cell.backend.clone();
        receipt.backend_runtime_policy = cell.runtime_policy.clone();
        receipt.lattice_cell_id = cell.to_cell_id();
        receipt.reference_output_hashes_populated = true;
        receipt.reference_output_hashes = output_hashes_for(
            cell.graph_family.as_str(),
            cell.shape_profile.as_str(),
            &format!("refhash-{}", cell.backend),
        );
        receipt.process_rss_before_materialize_kb = 1024;
        receipt
    }

    fn writer_like_coreml_receipt(
        run_id: &str,
        cell: &LatticeCellKey,
        outcome: WriterOutcome,
    ) -> DecodeAttributionReceipt {
        let is_pass = matches!(outcome, WriterOutcome::Pass);
        let mut receipt = writer_like_receipt(run_id, cell, "matrix_lattice");
        receipt.runtime_compute_units = cell.runtime_policy.clone();
        receipt.materialization_kind = "mil_package_write".to_string();
        receipt.compile_kind = "xcrun_coremlcompiler".to_string();
        receipt.load_kind = "mlmodel_load".to_string();
        receipt.execution_kind = if canonical_family_name(cell.graph_family.as_str())
            == identity_baseline_family_name()
        {
            "identity_passthrough_cpu".to_string()
        } else {
            "coreml_predict".to_string()
        };
        receipt.backend_support_status = "supported".to_string();
        receipt.support_tier = "supported_native".to_string();
        receipt.materialize_status = if is_pass { "ok" } else { "error" }.to_string();
        receipt.compile_status = if is_pass { "ok" } else { "error" }.to_string();
        receipt.load_status = if is_pass { "ok" } else { "error" }.to_string();
        receipt.load_success = is_pass;
        receipt.backend_prepare_duration_ns = if is_pass { 1500 } else { 0 };
        if is_pass {
            receipt.materialize_duration_ns = 111;
            receipt.compile_duration_ns = 222;
            receipt.compiled_artifact_sha256 = "compiled-artifact-sha256".to_string();
            receipt.source_package_sha256 = "source-package-sha256".to_string();
            receipt.compile_exit_status = 0;
            receipt.compiler_stdout_sha256 = "compiler-stdout-sha256".to_string();
            receipt.compiler_stderr_sha256 = "compiler-stderr-sha256".to_string();
            receipt.compiler_stdout_sidecar_path = Some(format!(
                "decode_attribution_runs/{}/{}_stdout.txt",
                run_id, cell.graph_family
            ));
            receipt.compiler_stderr_sidecar_path = Some(format!(
                "decode_attribution_runs/{}/{}_stderr.txt",
                run_id, cell.graph_family
            ));
            receipt.coreml_mil_build_ns = 10;
            receipt.coreml_package_write_ns = 20;
            receipt.coreml_compiler_ns = 30;
            receipt.coreml_model_load_ns = 40;
            receipt.load_duration_ns = 1500;
            receipt.cold_status = "ok".to_string();
            receipt.warmup_status = "ok".to_string();
            receipt.steady_status = "ok".to_string();
            receipt.cold_first_predict_ns = 50;
            receipt.cold_output_hashes = output_hashes_for(
                cell.graph_family.as_str(),
                cell.shape_profile.as_str(),
                "coldhash-coreml",
            );
            receipt.warmup_iterations = receipt.configured_warmup_iterations;
            receipt.warmup_total_ns = 500;
            receipt.steady_iterations = receipt.configured_steady_iterations;
            receipt.steady_sample_ns = vec![5, 6, 7];
            receipt.steady_total_ns = 700;
            receipt.steady_p50_ns = 7;
            receipt.steady_p90_ns = 8;
            receipt.steady_p99_ns = 9;
            receipt.steady_min_ns = 5;
            receipt.steady_max_ns = 9;
            receipt.steady_mean_ns = 7.0;
            receipt.steady_stddev_ns = 1.0;
            receipt.steady_mad_ns = 0.5;
            receipt.steady_iqr_ns = 1.0;
            receipt.steady_outlier_count = 0;
            receipt.process_rss_before_load_kb = 2048;
            receipt.process_rss_after_load_kb = 3072;
            receipt.process_rss_after_cold_predict_kb = 4096;
            receipt.process_rss_after_steady_kb = 5120;
            receipt.max_absolute_error = 0.0;
            receipt.max_relative_error = 0.0;
            receipt.mean_absolute_error = 0.0;
            receipt.cosine_similarity = 1.0;
            receipt.matches_tolerance = true;
            receipt.reference_status = "ok".to_string();
            receipt.status = "pass".to_string();
            receipt.predict_status = "pass".to_string();
            receipt.predict_failure_classification.clear();
            receipt.terminal_phase = "complete".to_string();
            receipt.failure_reason = None;
            receipt.failure_diagnostics = None;
            receipt.compiler_exit_code = Some(0);
            receipt.compute_plan_status = "unavailable".to_string();
            receipt.execution_proof = ExecutionProof {
                engine: "coreml".into(),
                accelerated_ops: family_ops(cell.graph_family.as_str()),
                cpu_ops: vec![],
                reference_ops: vec![],
                accelerate_blas_ops: vec![],
                accelerate_vdsp_ops: vec![],
                accelerate_vforce_ops: vec![],
                cpu_glue_ops: vec![],
                bridge_path: Some("coreml_predict_bridge".into()),
                notes: Some(format!("Compiled via coremlcompiler, island=false")),
            };
        } else {
            receipt.materialize_duration_ns = 0;
            receipt.compile_duration_ns = 0;
            receipt.compiled_artifact_sha256.clear();
            receipt.source_package_sha256.clear();
            receipt.compile_exit_status = 1;
            receipt.compiler_stdout_sha256 = "compiler-stdout-sha256".to_string();
            receipt.compiler_stderr_sha256 = "compiler-stderr-sha256".to_string();
            receipt.compiler_stdout_sidecar_path = Some(format!(
                "decode_attribution_runs/{}/{}_stdout.txt",
                run_id, cell.graph_family
            ));
            receipt.compiler_stderr_sidecar_path = Some(format!(
                "decode_attribution_runs/{}/{}_stderr.txt",
                run_id, cell.graph_family
            ));
            receipt.coreml_mil_build_ns = 0;
            receipt.coreml_package_write_ns = 0;
            receipt.coreml_compiler_ns = 0;
            receipt.coreml_model_load_ns = 0;
            receipt.cold_status.clear();
            receipt.warmup_status.clear();
            receipt.steady_status.clear();
            receipt.cold_first_predict_ns = 0;
            receipt.cold_output_hashes.clear();
            receipt.warmup_iterations = 0;
            receipt.warmup_total_ns = 0;
            receipt.steady_iterations = 0;
            receipt.steady_sample_ns.clear();
            receipt.steady_total_ns = 0;
            receipt.steady_p50_ns = 0;
            receipt.steady_p90_ns = 0;
            receipt.steady_p99_ns = 0;
            receipt.steady_min_ns = 0;
            receipt.steady_max_ns = 0;
            receipt.steady_mean_ns = 0.0;
            receipt.steady_stddev_ns = 0.0;
            receipt.steady_mad_ns = 0.0;
            receipt.steady_iqr_ns = 0.0;
            receipt.steady_outlier_count = 0;
            receipt.process_rss_before_load_kb = 0;
            receipt.process_rss_after_load_kb = 0;
            receipt.process_rss_after_cold_predict_kb = 0;
            receipt.process_rss_after_steady_kb = 0;
            receipt.max_absolute_error = 0.25;
            receipt.max_relative_error = 0.25;
            receipt.mean_absolute_error = 0.25;
            receipt.cosine_similarity = 0.0;
            receipt.matches_tolerance = false;
            receipt.reference_status = "ok".to_string();
            receipt.status = "compile_error".to_string();
            receipt.predict_status = "compile_limited".to_string();
            receipt.predict_failure_classification = "compile_limited".to_string();
            receipt.terminal_phase = "mil_build".to_string();
            receipt.failure_reason =
                Some("coreml prepare failed: synthetic compiler failure".to_string());
            receipt.failure_diagnostics =
                Some("coreml prepare: synthetic compiler failure".to_string());
            receipt.compiler_exit_code = Some(1);
            receipt.compute_plan_status.clear();
            receipt.execution_proof = ExecutionProof {
                engine: "coreml".into(),
                accelerated_ops: family_ops(cell.graph_family.as_str()),
                cpu_ops: vec![],
                reference_ops: vec![],
                accelerate_blas_ops: vec![],
                accelerate_vdsp_ops: vec![],
                accelerate_vforce_ops: vec![],
                cpu_glue_ops: vec![],
                bridge_path: None,
                notes: Some(format!(
                    "backend=coreml family={} status=compile_error",
                    cell.graph_family
                )),
            };
        }
        receipt
    }

    fn writer_like_mlx_receipt(
        run_id: &str,
        cell: &LatticeCellKey,
        outcome: WriterOutcome,
    ) -> DecodeAttributionReceipt {
        let is_pass = matches!(outcome, WriterOutcome::Pass);
        let mut receipt = writer_like_receipt(run_id, cell, "matrix_lattice");
        receipt.materialization_kind = "mlx_array_construct".to_string();
        receipt.compile_kind = "not_applicable".to_string();
        receipt.load_kind = "not_applicable".to_string();
        receipt.execution_kind = "mlx_eval".to_string();
        receipt.materialize_status = "ok".to_string();
        receipt.compile_status = "not_applicable".to_string();
        receipt.load_status = "not_applicable".to_string();
        receipt.support_tier = mlx_support_tier_for(cell.graph_family.as_str()).to_string();
        receipt.backend_support_status = "supported".to_string();
        receipt.mlx_device = "Apple GPU".to_string();
        receipt.mlx_eval_forced = true;
        receipt.mlx_eval_method = "eval()".to_string();
        receipt.mlx_compile_attempted = false;
        receipt.python_boundary_ns = Some(0);
        receipt.reference_status = "ok".to_string();

        if is_pass {
            receipt.backend_prepare_duration_ns = 0;
            receipt.process_rss_before_load_kb = 2048;
            receipt.mlx_array_construct_ns = 10;
            receipt.mlx_graph_build_ns = 20;
            receipt.mlx_eval_only_ns = 30;
            receipt.mlx_readback_ns = 40;
            receipt.mlx_cache_hit = false;
            receipt.load_success = false;
            receipt.cold_status = "ok".to_string();
            receipt.warmup_status = "ok".to_string();
            receipt.steady_status = "ok".to_string();
            receipt.cold_first_predict_ns = 60;
            receipt.cold_output_hashes = output_hashes_for(
                cell.graph_family.as_str(),
                cell.shape_profile.as_str(),
                "coldhash-mlx",
            );
            receipt.warmup_iterations = receipt.configured_warmup_iterations;
            receipt.warmup_total_ns = 600;
            receipt.steady_iterations = receipt.configured_steady_iterations;
            receipt.steady_sample_ns = vec![6, 7, 8];
            receipt.steady_total_ns = 800;
            receipt.steady_p50_ns = 8;
            receipt.steady_p90_ns = 9;
            receipt.steady_p99_ns = 10;
            receipt.steady_min_ns = 6;
            receipt.steady_max_ns = 10;
            receipt.steady_mean_ns = 8.0;
            receipt.steady_stddev_ns = 1.0;
            receipt.steady_mad_ns = 0.5;
            receipt.steady_iqr_ns = 1.0;
            receipt.steady_outlier_count = 0;
            receipt.process_rss_after_cold_predict_kb = 3072;
            receipt.process_rss_after_steady_kb = 4096;
            receipt.max_absolute_error = 0.0;
            receipt.max_relative_error = 0.0;
            receipt.mean_absolute_error = 0.0;
            receipt.cosine_similarity = 1.0;
            receipt.matches_tolerance = true;
            receipt.status = "pass".to_string();
            receipt.predict_status = "pass".to_string();
            receipt.predict_failure_classification.clear();
            receipt.terminal_phase = "complete".to_string();
            receipt.failure_reason = None;
            receipt.failure_diagnostics = None;
            receipt.execution_proof = ExecutionProof {
                engine: "mlx".into(),
                accelerated_ops: family_ops(cell.graph_family.as_str()),
                cpu_ops: vec![],
                reference_ops: vec![],
                accelerate_blas_ops: vec![],
                accelerate_vdsp_ops: vec![],
                accelerate_vforce_ops: vec![],
                cpu_glue_ops: vec![],
                bridge_path: None,
                notes: Some("MLX eval() with forced materialization".into()),
            };
        } else {
            receipt.backend_prepare_duration_ns = 0;
            receipt.mlx_array_construct_ns = 0;
            receipt.mlx_graph_build_ns = 0;
            receipt.mlx_eval_only_ns = 0;
            receipt.mlx_readback_ns = 0;
            receipt.mlx_cache_hit = false;
            receipt.cold_status.clear();
            receipt.warmup_status.clear();
            receipt.steady_status.clear();
            receipt.cold_first_predict_ns = 0;
            receipt.cold_output_hashes.clear();
            receipt.warmup_iterations = 0;
            receipt.warmup_total_ns = 0;
            receipt.steady_iterations = 0;
            receipt.steady_sample_ns.clear();
            receipt.steady_total_ns = 0;
            receipt.steady_p50_ns = 0;
            receipt.steady_p90_ns = 0;
            receipt.steady_p99_ns = 0;
            receipt.steady_min_ns = 0;
            receipt.steady_max_ns = 0;
            receipt.steady_mean_ns = 0.0;
            receipt.steady_stddev_ns = 0.0;
            receipt.steady_mad_ns = 0.0;
            receipt.steady_iqr_ns = 0.0;
            receipt.steady_outlier_count = 0;
            receipt.process_rss_before_load_kb = 0;
            receipt.process_rss_after_cold_predict_kb = 0;
            receipt.process_rss_after_steady_kb = 0;
            receipt.max_absolute_error = 0.0;
            receipt.max_relative_error = 0.0;
            receipt.mean_absolute_error = 0.0;
            receipt.cosine_similarity = 0.0;
            receipt.matches_tolerance = false;
            receipt.status = "prediction_error".to_string();
            receipt.predict_status = "predict_blocked".to_string();
            receipt.predict_failure_classification = "predict_blocked".to_string();
            receipt.terminal_phase = "predict".to_string();
            receipt.failure_reason = Some("mlx prepare_graph: synthetic failure".to_string());
            receipt.failure_diagnostics = Some("mlx prepare_graph: synthetic failure".to_string());
            receipt.execution_proof = ExecutionProof {
                engine: "mlx".into(),
                accelerated_ops: family_ops(cell.graph_family.as_str()),
                cpu_ops: vec![],
                reference_ops: vec![],
                accelerate_blas_ops: vec![],
                accelerate_vdsp_ops: vec![],
                accelerate_vforce_ops: vec![],
                cpu_glue_ops: vec![],
                bridge_path: None,
                notes: None,
            };
        }

        receipt
    }

    fn writer_like_accelerate_receipt(
        run_id: &str,
        cell: &LatticeCellKey,
        outcome: WriterOutcome,
    ) -> DecodeAttributionReceipt {
        let is_pass = matches!(outcome, WriterOutcome::Pass);
        let mut receipt = writer_like_receipt(run_id, cell, "matrix_lattice");
        receipt.materialization_kind = "array_pack".to_string();
        receipt.compile_kind = "not_applicable".to_string();
        receipt.load_kind = "not_applicable".to_string();
        receipt.execution_kind = if canonical_family_name(cell.graph_family.as_str())
            == identity_baseline_family_name()
        {
            "identity_memcpy".to_string()
        } else {
            "cblas_sgemm".to_string()
        };
        receipt.materialize_status = "ok".to_string();
        receipt.compile_status = "not_applicable".to_string();
        receipt.load_status = if matches!(outcome, WriterOutcome::AccelerateSkippedBySupport) {
            "not_applicable".to_string()
        } else {
            "ok".to_string()
        };

        if matches!(outcome, WriterOutcome::AccelerateSkippedBySupport) {
            receipt.backend_support_status = "unsupported_graph".to_string();
            receipt.support_tier = "unsupported_graph".to_string();
            receipt.cold_status = "skipped".to_string();
            receipt.warmup_status = "skipped".to_string();
            receipt.steady_status = "skipped".to_string();
            receipt.predict_status = "skipped_by_support".to_string();
            receipt.predict_failure_classification = "skipped_by_support".to_string();
            receipt.status = "skipped_by_support".to_string();
            receipt.terminal_phase = "skipped_by_support".to_string();
            receipt.reference_status = "ok".to_string();
            receipt.execution_proof = ExecutionProof {
                engine: "reference_evaluator".into(),
                accelerated_ops: vec![],
                cpu_ops: vec![],
                reference_ops: family_ops(cell.graph_family.as_str()),
                accelerate_blas_ops: vec![],
                accelerate_vdsp_ops: vec![],
                accelerate_vforce_ops: vec![],
                cpu_glue_ops: vec![],
                bridge_path: None,
                notes: Some(format!(
                    "Accelerate does not support {}; output from reference evaluator",
                    cell.graph_family
                )),
            };
            return receipt;
        }

        receipt.support_tier = accelerate_support_tier_for(cell.graph_family.as_str()).to_string();
        receipt.backend_support_status = if receipt.support_tier == "unsupported_graph" {
            "unsupported_graph".to_string()
        } else {
            "supported".to_string()
        };

        if is_pass {
            receipt.backend_prepare_duration_ns = 0;
            receipt.cold_status = "ok".to_string();
            receipt.cold_first_predict_ns = 70;
            receipt.cold_output_hashes = output_hashes_for(
                cell.graph_family.as_str(),
                cell.shape_profile.as_str(),
                "coldhash-accelerate",
            );
            receipt.steady_iterations = receipt.configured_steady_iterations;
            receipt.steady_total_ns = 900;
            receipt.steady_sample_ns = vec![9, 10, 11];
            receipt.steady_p50_ns = 9;
            receipt.steady_p90_ns = 10;
            receipt.steady_p99_ns = 11;
            receipt.steady_min_ns = 9;
            receipt.steady_max_ns = 11;
            receipt.steady_mean_ns = 9.0;
            receipt.steady_stddev_ns = 1.0;
            receipt.steady_mad_ns = 0.5;
            receipt.steady_iqr_ns = 1.0;
            receipt.steady_outlier_count = 0;
            receipt.steady_status = "ok".to_string();
            receipt.warmup_status = "skipped".to_string();
            receipt.warmup_iterations = 0;
            receipt.warmup_total_ns = 0;
            receipt.load_success = false;
            receipt.load_duration_ns = 0;
            receipt.process_rss_after_cold_predict_kb = 3072;
            receipt.process_rss_after_steady_kb = 4096;
            receipt.max_absolute_error = 0.0;
            receipt.max_relative_error = 0.0;
            receipt.mean_absolute_error = 0.0;
            receipt.cosine_similarity = 1.0;
            receipt.matches_tolerance = true;
            receipt.reference_status = "ok".to_string();
            receipt.status = "pass".to_string();
            receipt.predict_status = "pass".to_string();
            receipt.predict_failure_classification.clear();
            receipt.terminal_phase = "complete".to_string();
            receipt.execution_proof = ExecutionProof {
                engine: "accelerate".into(),
                accelerated_ops: family_ops(cell.graph_family.as_str()),
                cpu_ops: vec![],
                reference_ops: vec![],
                accelerate_blas_ops: accel_blas_ops_for(cell.graph_family.as_str()),
                accelerate_vdsp_ops: accel_vdsp_ops_for(cell.graph_family.as_str()),
                accelerate_vforce_ops: accel_vforce_ops_for(cell.graph_family.as_str()),
                cpu_glue_ops: vec![],
                bridge_path: None,
                notes: Some("Accelerate composed path".into()),
            };
        }

        receipt
    }

    fn realistic_complete_lattice(run_id: &str) -> Vec<DecodeAttributionReceipt> {
        let mut receipts = Vec::with_capacity(96);
        for cell in expected_lattice_cells() {
            let outcome = match (
                cell.backend.as_str(),
                cell.graph_family.as_str(),
                cell.shape_profile.as_str(),
                cell.runtime_policy.as_str(),
            ) {
                ("coreml", "branch_rejoin", "medium", "cpuOnly") => {
                    WriterOutcome::CoreMlCompileLimited
                }
                ("mlx", "multi_output", "large", "mlx_default") => WriterOutcome::MlxPredictBlocked,
                ("accelerate", "softmax_tail", "small", "accelerate_cpu") => {
                    WriterOutcome::AccelerateSkippedBySupport
                }
                _ => WriterOutcome::Pass,
            };

            let receipt = match cell.backend.as_str() {
                "coreml" => writer_like_coreml_receipt(run_id, &cell, outcome),
                "mlx" => writer_like_mlx_receipt(run_id, &cell, outcome),
                "accelerate" => writer_like_accelerate_receipt(run_id, &cell, outcome),
                other => panic!("unexpected backend {other}"),
            };
            receipts.push(receipt);
        }
        receipts
    }

    fn synthetic_receipt(
        run_id: &str,
        backend: &str,
        family: &str,
        shape: &str,
        policy: &str,
        support_tier: &str,
        predict_status: &str,
    ) -> DecodeAttributionReceipt {
        let lattice_cell_id =
            super::super::lattice::lattice_cell_id(backend, family, shape, policy);
        let mut receipt = DecodeAttributionReceipt::default();
        receipt.run_id = run_id.to_string();
        receipt.commit_sha = "commit-sha-1".to_string();
        receipt.branch = "main".to_string();
        receipt.timestamp = "2026-06-13T00:00:00Z".to_string();
        receipt.schema_version = "decode-attribution.v1".to_string();
        receipt.graph_family = family.to_string();
        receipt.shape_profile = shape.to_string();
        receipt.backend = backend.to_string();
        receipt.backend_runtime_policy = policy.to_string();
        receipt.lattice_cell_id = lattice_cell_id;
        receipt.backend_support_status =
            if matches!(support_tier, "unsupported_graph" | "not_implemented") {
                support_tier.to_string()
            } else {
                "supported".to_string()
            };
        receipt.materialize_status = "ok".to_string();
        receipt.compile_status = "ok".to_string();
        receipt.load_status = "ok".to_string();
        receipt.terminal_phase = "complete".to_string();
        receipt.predict_status = predict_status.to_string();
        receipt.predict_failure_classification = if matches!(predict_status, "pass" | "passed") {
            String::new()
        } else {
            predict_status.to_string()
        };
        receipt.support_tier = support_tier.to_string();
        receipt.reference_output_hashes_populated = true;
        receipt.reference_output_hashes = vec!["refhash-1".to_string()];
        receipt.cold_output_hashes = vec!["backendhash-1".to_string()];
        receipt.cold_first_predict_ns = 10;
        receipt.steady_p50_ns = 20;
        receipt.materialize_duration_ns = 30;
        receipt.compile_duration_ns = 40;
        receipt.load_duration_ns = 50;
        receipt.max_absolute_error = 0.0;
        receipt.status = predict_status.to_string();
        receipt
    }

    fn synthetic_complete_lattice(run_id: &str) -> Vec<DecodeAttributionReceipt> {
        let mut receipts = Vec::new();
        for cell in expected_lattice_cells() {
            let support_tier = match cell.backend.as_str() {
                "coreml" => "supported_native",
                _ => "supported_composed",
            };
            receipts.push(synthetic_receipt(
                run_id,
                &cell.backend,
                &cell.graph_family,
                &cell.shape_profile,
                &cell.runtime_policy,
                support_tier,
                "pass",
            ));
        }
        receipts
    }

    #[test]
    fn validator_accepts_complete_synthetic_lattice() {
        let receipts = synthetic_complete_lattice("run-1");
        let receipt = validate_lattice("run-1", &receipts);
        assert!(receipt.passed);
        assert_eq!(receipt.observed_row_count, 96);
        assert_eq!(receipt.expected_cell_count, 96);
        assert_eq!(receipt.unique_cell_count, 96);
        assert!(receipt.missing_cells.is_empty());
        assert!(receipt.duplicate_cells.is_empty());
        assert!(receipt.invalid_cells.is_empty());
        assert_eq!(receipt.aggregate_input_summary.valid_rows, 96);
        assert_eq!(receipt.aggregate_input_summary.included_rows, 84);
        assert_eq!(receipt.aggregate_input_summary.excluded_rows, 12);
        assert_eq!(receipt.aggregate_exclusions.len(), 12);
    }

    #[test]
    fn validator_accepts_realistic_writer_like_lattice() {
        let receipts = realistic_complete_lattice("run-1");
        let receipt = validate_lattice("run-1", &receipts);
        assert!(receipt.passed);
        assert_eq!(receipt.observed_row_count, 96);
        assert_eq!(receipt.expected_cell_count, 96);
        assert_eq!(receipt.unique_cell_count, 96);
        assert!(receipt.missing_cells.is_empty());
        assert!(receipt.duplicate_cells.is_empty());
        assert!(receipt.invalid_cells.is_empty());
        assert_eq!(receipt.aggregate_input_summary.valid_rows, 96);
        assert_eq!(receipt.aggregate_input_summary.included_rows, 81);
        assert_eq!(receipt.aggregate_input_summary.excluded_rows, 15);
        assert_eq!(receipt.aggregate_exclusions.len(), 15);

        let coreml_pass = receipts
            .iter()
            .find(|r| {
                r.backend == "coreml"
                    && r.predict_status == "pass"
                    && canonical_family_name(r.graph_family.as_str())
                        != identity_baseline_family_name()
            })
            .expect("coreml pass row");
        assert_eq!(coreml_pass.backend_support_status, "supported");
        assert_eq!(coreml_pass.support_tier, "supported_native");
        assert_eq!(coreml_pass.materialization_kind, "mil_package_write");
        assert_eq!(coreml_pass.compile_kind, "xcrun_coremlcompiler");
        assert_eq!(coreml_pass.load_kind, "mlmodel_load");
        assert_eq!(coreml_pass.execution_kind, "coreml_predict");
        assert_eq!(coreml_pass.load_success, true);
        assert_eq!(coreml_pass.reference_output_hashes_populated, true);

        let coreml_non_pass = receipts
            .iter()
            .find(|r| r.backend == "coreml" && r.predict_status == "compile_limited")
            .expect("coreml non-pass row");
        assert_eq!(coreml_non_pass.backend_support_status, "supported");
        assert_eq!(
            coreml_non_pass.predict_failure_classification,
            "compile_limited"
        );
        assert_eq!(coreml_non_pass.status, "compile_error");
        assert_eq!(coreml_non_pass.terminal_phase, "mil_build");
        assert_eq!(coreml_non_pass.materialize_status, "error");
        assert_eq!(coreml_non_pass.compile_status, "error");
        assert_eq!(coreml_non_pass.load_status, "error");

        let mlx_pass = receipts
            .iter()
            .find(|r| {
                r.backend == "mlx"
                    && r.predict_status == "pass"
                    && canonical_family_name(r.graph_family.as_str())
                        != identity_baseline_family_name()
            })
            .expect("mlx pass row");
        assert_eq!(mlx_pass.backend_support_status, "supported");
        assert_eq!(mlx_pass.support_tier, "supported_native");
        assert_eq!(mlx_pass.materialization_kind, "mlx_array_construct");
        assert_eq!(mlx_pass.compile_kind, "not_applicable");
        assert_eq!(mlx_pass.load_kind, "not_applicable");
        assert_eq!(mlx_pass.execution_kind, "mlx_eval");
        assert_eq!(mlx_pass.mlx_eval_forced, true);
        assert_eq!(mlx_pass.mlx_compile_attempted, false);
        assert_eq!(mlx_pass.reference_output_hashes_populated, true);

        let mlx_non_pass = receipts
            .iter()
            .find(|r| r.backend == "mlx" && r.predict_status == "predict_blocked")
            .expect("mlx non-pass row");
        assert_eq!(mlx_non_pass.backend_support_status, "supported");
        assert_eq!(
            mlx_non_pass.predict_failure_classification,
            "predict_blocked"
        );
        assert_eq!(mlx_non_pass.status, "prediction_error");
        assert_eq!(mlx_non_pass.terminal_phase, "predict");
        assert_eq!(mlx_non_pass.materialization_kind, "mlx_array_construct");
        assert_eq!(mlx_non_pass.compile_kind, "not_applicable");
        assert_eq!(mlx_non_pass.load_kind, "not_applicable");

        let accelerate_pass = receipts
            .iter()
            .find(|r| {
                r.backend == "accelerate"
                    && r.predict_status == "pass"
                    && canonical_family_name(r.graph_family.as_str())
                        != identity_baseline_family_name()
            })
            .expect("accelerate pass row");
        assert_eq!(accelerate_pass.backend_support_status, "supported");
        assert!(matches!(
            accelerate_pass.support_tier.as_str(),
            "supported_composed" | "supported_native"
        ));
        assert_eq!(accelerate_pass.materialization_kind, "array_pack");
        assert_eq!(accelerate_pass.compile_kind, "not_applicable");
        assert_eq!(accelerate_pass.load_kind, "not_applicable");
        assert_eq!(accelerate_pass.execution_kind, "cblas_sgemm");
        assert_eq!(accelerate_pass.warmup_status, "skipped");
        assert_eq!(accelerate_pass.reference_output_hashes_populated, true);

        let accelerate_non_pass = receipts
            .iter()
            .find(|r| r.backend == "accelerate" && r.predict_status == "skipped_by_support")
            .expect("accelerate non-pass row");
        assert_eq!(
            accelerate_non_pass.backend_support_status,
            "unsupported_graph"
        );
        assert_eq!(accelerate_non_pass.support_tier, "unsupported_graph");
        assert_eq!(
            accelerate_non_pass.predict_failure_classification,
            "skipped_by_support"
        );
        assert_eq!(accelerate_non_pass.status, "skipped_by_support");
        assert_eq!(accelerate_non_pass.terminal_phase, "skipped_by_support");
        assert_eq!(accelerate_non_pass.cold_status, "skipped");
        assert_eq!(accelerate_non_pass.warmup_status, "skipped");
        assert_eq!(accelerate_non_pass.steady_status, "skipped");

        assert_eq!(
            receipts
                .iter()
                .filter(|r| r.backend == "coreml" && r.predict_status != "pass")
                .count(),
            1
        );
        assert_eq!(
            receipts
                .iter()
                .filter(|r| r.backend == "mlx" && r.predict_status != "pass")
                .count(),
            1
        );
        assert_eq!(
            receipts
                .iter()
                .filter(|r| r.backend == "accelerate" && r.predict_status != "pass")
                .count(),
            1
        );
    }

    #[test]
    fn validator_rejects_missing_lattice_cell_id() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].lattice_cell_id.clear();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "missing_lattice_cell_id");
    }

    #[test]
    fn validator_rejects_malformed_lattice_cell_id() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].lattice_cell_id = "coverage-lattice.v2/coreml".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "malformed_lattice_cell_id");
    }

    #[test]
    fn validator_rejects_cell_id_field_mismatch() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].backend = "mlx".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(
            receipt.invalid_cells[0].reason,
            "lattice_cell_id_row_field_mismatch"
        );
    }

    #[test]
    fn validator_rejects_missing_expected_cell() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts.pop();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.missing_cells.len(), 1);
    }

    #[test]
    fn validator_rejects_duplicate_cell() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts.push(receipts[0].clone());
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.duplicate_cells.len(), 1);
        assert_eq!(receipt.duplicate_cells[0].observed_count, 2);
    }

    #[test]
    fn validator_rejects_unexpected_cell() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].backend = "unknown".to_string();
        receipts[0].graph_family = "matmul".to_string();
        receipts[0].shape_profile = "small".to_string();
        receipts[0].backend_runtime_policy = "cpuOnly".to_string();
        receipts[0].lattice_cell_id =
            super::super::lattice::lattice_cell_id("unknown", "matmul", "small", "cpuOnly");
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "unexpected_lattice_cell");
    }

    #[test]
    fn validator_rejects_mixed_run_id() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].run_id = "run-2".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "mixed_run_id");
    }

    #[test]
    fn validator_rejects_mixed_commit_sha() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].commit_sha = "commit-sha-2".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "mixed_commit_sha");
    }

    #[test]
    fn validator_rejects_unknown_support_tier() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].support_tier = "mystery".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "unknown_support_tier");
    }

    #[test]
    fn validator_rejects_unknown_predict_status() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].predict_status = "mystery".to_string();
        receipts[0].predict_failure_classification = "mystery".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "unknown_predict_status");
    }

    #[test]
    fn validator_rejects_pass_with_failure_classification() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].predict_failure_classification = "predict_blocked".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(
            receipt.invalid_cells[0].reason,
            "pass_with_failure_classification"
        );
    }

    #[test]
    fn validator_rejects_failed_without_failure_classification() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].predict_status = "failed".to_string();
        receipts[0].status = "failed".to_string();
        receipts[0].predict_failure_classification.clear();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(
            receipt.invalid_cells[0].reason,
            "failed_without_failure_classification"
        );
    }

    #[test]
    fn validator_rejects_unsupported_graph_with_passed_status() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].support_tier = "unsupported_graph".to_string();
        receipts[0].backend_support_status = "unsupported_graph".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(
            receipt.invalid_cells[0].reason,
            "unsupported_graph_with_passed_status"
        );
    }

    #[test]
    fn validator_requires_reference_hashes_for_every_row() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].reference_output_hashes_populated = false;
        receipts[0].reference_output_hashes.clear();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(receipt.invalid_cells[0].reason, "missing_reference_hashes");
    }

    #[test]
    fn validator_rejects_numerical_divergence_without_backend_output() {
        let mut receipts = synthetic_complete_lattice("run-1");
        receipts[0].predict_status = "numerical_divergence".to_string();
        receipts[0].status = "numerical_divergence".to_string();
        receipts[0].predict_failure_classification = "numerical_divergence".to_string();
        receipts[0].cold_output_hashes.clear();
        receipts[0].accelerate_output_hashes.clear();
        let receipt = validate_lattice("run-1", &receipts);
        assert!(!receipt.passed);
        assert_eq!(
            receipt.invalid_cells[0].reason,
            "numerical_divergence_without_backend_output"
        );
    }

    #[test]
    fn validator_excludes_skipped_rows_from_aggregates() {
        let mut receipts = synthetic_complete_lattice("run-1");
        let receipt = receipts
            .iter_mut()
            .find(|r| canonical_family_name(r.graph_family.as_str()) != "identity_passthrough")
            .expect("non-identity receipt");
        receipt.predict_status = "skipped_by_support".to_string();
        receipt.status = "skipped_by_support".to_string();
        receipt.predict_failure_classification = "skipped_by_support".to_string();
        receipt.support_tier = "unsupported_graph".to_string();
        receipt.backend_support_status = "unsupported_graph".to_string();
        let receipt = validate_lattice("run-1", &receipts);
        assert_eq!(receipt.aggregate_exclusions.len(), 13);
        assert!(receipt
            .aggregate_exclusions
            .iter()
            .any(|entry| entry.reason == "skipped_by_support"));
        assert_eq!(receipt.aggregate_input_summary.excluded_rows, 13);
    }

    #[test]
    fn validator_excludes_identity_from_latency_aggregates() {
        let receipts = synthetic_complete_lattice("run-1");
        let receipt = validate_lattice("run-1", &receipts);
        assert!(receipt.passed);
        assert_eq!(receipt.aggregate_exclusions.len(), 12);
        assert_eq!(
            receipt.aggregate_exclusions[0].reason,
            identity_baseline_family_name()
        );
        assert_eq!(receipt.aggregate_input_summary.included_rows, 84);
    }
}
