use super::evidence::EvidenceAdapter;
use super::resolver::Resolver;
use super::schema::{BackendVersions, ComputeImageV0, TargetContext};
use std::time::{SystemTime, UNIX_EPOCH};
use super::canonical_hash::compute_canonical_hash;

pub struct EmitterOptions {
    pub run_id: String,
    pub git_commit: String,
    pub compute_scope_dirty: bool,
    pub dirty_paths_sample: Vec<String>,
    pub evidence_root: String,
    pub allow_contract_only_kv: bool,
    pub target_context: TargetContext,
    pub is_synthetic: bool,
}

impl Default for EmitterOptions {
    fn default() -> Self {
        Self {
            run_id: "test-run".into(),
            git_commit: "HEAD".into(),
            compute_scope_dirty: false,
            dirty_paths_sample: vec![],
            evidence_root: "/artifacts".into(),
            allow_contract_only_kv: false,
            is_synthetic: true,
            target_context: TargetContext {
                repository_provenance: "https://github.com/Tribunus-dev/tribunus".into(),
                device_profile: "apple_m3_max".into(),
                model_profile: "gemma2-9b".into(),
                shape_profile: "batch_1_seq_1".into(),
                dtype: "f16".into(),
                compute_policy: "strict_truth".into(),
                backend_versions: BackendVersions {
                    mlx: Some("0.22.1".into()),
                    coreml: Some("9.0".into()),
                    accelerate: Some("15.5".into()),
                },
                source_gate_references: vec![],
            },
        }
    }
}

pub fn emit_v0_image(
    adapter: &dyn EvidenceAdapter,
    options: EmitterOptions,
) -> Result<(ComputeImageV0, String), String> {
    let evidence = adapter.load_evidence()?;
    let resolver = Resolver::new(options.allow_contract_only_kv);

    let mut phases = Vec::new();
    for ev in &evidence {
        phases.push(resolver.resolve_phase(ev));
    }

    let created_at = format_iso8601(
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    );

    let mut image = ComputeImageV0 {
        schema: "tribunus.compute_image.v0".into(),
        schema_hash: "".into(), // Will compute below
        evidence_source_kind: if options.is_synthetic { "synthetic_fixture".into() } else { "normalized_json".into() },
        resolution_policy: super::schema::ResolutionPolicy {
            policy_name: "strict_truth".into(),
            backend_preference_order: vec!["mlx".into(), "coreml".into(), "accelerate".into()],
            allow_contract_only_kv: options.allow_contract_only_kv,
            require_runtime_qualified_kv: true,
            allow_synthetic_evidence: true,
            required_phase_set: "strict_v0".into(),
        },
        verdict: "".into(), // Computed by markdown generator for now
        created_at,
        run_id: options.run_id,
        git_commit: options.git_commit,
        compute_scope_dirty: options.compute_scope_dirty,
        dirty_paths_sample: options.dirty_paths_sample,
        evidence_root: options.evidence_root,
        target_context: options.target_context,
        phases,
    };

    let (markdown, verdict) = generate_markdown_summary(&image);
    image.verdict = verdict;

    image.schema_hash = compute_canonical_hash(&image);

    Ok((image, markdown))
}

fn generate_markdown_summary(image: &ComputeImageV0) -> (String, String) {
    let mut md = String::new();
    md.push_str("# Compute Image v0 Summary\n\n");
    md.push_str(&format!("- **Schema**: {}\n", image.schema));
    md.push_str(&format!("- **Schema Hash**: {}\n", image.schema_hash)); // Note: this will be empty at generation time and injected later if re-generated, but for now we put placeholder
    md.push_str(&format!("- **Evidence Source Kind**: {}\n", image.evidence_source_kind));
    md.push_str(&format!("- **Run ID**: {}\n", image.run_id));
    md.push_str(&format!("- **Git Commit**: {}\n", image.git_commit));
    md.push_str(&format!("- **Dirty Tree**: {}\n", image.compute_scope_dirty));
    md.push_str("\n## Target Context\n");
    md.push_str(&format!("- **Device**: {}\n", image.target_context.device_profile));
    md.push_str(&format!("- **Model**: {}\n", image.target_context.model_profile));
    md.push_str(&format!("- **Shape Profile**: {}\n", image.target_context.shape_profile));
    md.push_str(&format!("- **Policy**: {}\n", image.target_context.compute_policy));
    md.push_str("\n## Resolution Policy\n");
    md.push_str(&format!("- **Policy Name**: {}\n", image.resolution_policy.policy_name));
    md.push_str(&format!("- **Allow Contract Only KV**: {}\n", image.resolution_policy.allow_contract_only_kv));
    md.push_str(&format!("- **Required Phase Set**: {}\n", image.resolution_policy.required_phase_set));
    md.push_str("\n## Phase Placements\n");

    let mut _usable_count = 0;
    let mut fallback_count = 0;
    let mut blocked_count = 0;

    let mut blocked_sections = Vec::new();
    let mut compile_limited_sections = Vec::new();
    let mut num_divergence_sections = Vec::new();
    let mut fallback_sections = Vec::new();

    for phase in &image.phases {
        let mut is_fallback = false;

        if let Some(selected) = &phase.selected_backend {
            if let Some(cand) = phase.backend_candidates.iter().find(|c| &c.backend_name == selected) {
                // If it isn't "pass", it's a degraded fallback (e.g. ContractOnly KV that was selected)
                if cand.status != super::schema::BackendStatus::Pass {
                    is_fallback = true;
                }
            }
            // If the selected backend isn't MLX, but MLX passed, then it's a fallback.
            // A phase that selected Accelerate because MLX failed is also considered a fallback
            // since Accelerate is the lower-priority backend.
            if selected != "mlx" && selected != "coreml" {
                is_fallback = true;
            } else if selected == "coreml" && phase.backend_candidates.iter().any(|c| c.backend_name == "mlx" && c.status == super::schema::BackendStatus::Pass) {
                is_fallback = true; // Technically impossible under current default policy, but robust
            }
        }

        if phase.selected_backend.is_none() {
            blocked_count += 1;
            blocked_sections.push(phase.phase_name.clone());
        } else if is_fallback {
            fallback_count += 1;
            fallback_sections.push(format!("{} -> {}", phase.phase_name, phase.selected_backend.as_ref().unwrap()));
        } else {
            _usable_count += 1;
        }

        // Gather reasons
        for cand in &phase.backend_candidates {
            match cand.status {
                super::schema::BackendStatus::CompileLimited => {
                    compile_limited_sections.push(format!("{} ({})", phase.phase_name, cand.backend_name));
                }
                super::schema::BackendStatus::NumericalDivergence => {
                    num_divergence_sections.push(format!("{} ({})", phase.phase_name, cand.backend_name));
                }
                _ => {}
            }
        }

        md.push_str(&format!(
            "- **{}**: {}\n",
            phase.phase_name,
            phase.selected_backend.as_deref().unwrap_or("BLOCKED")
        ));
    }

    if !blocked_sections.is_empty() {
        md.push_str("\n### Blocked Phases\n");
        for p in &blocked_sections {
            md.push_str(&format!("- {}\n", p));
        }
    }

    if !compile_limited_sections.is_empty() {
        md.push_str("\n### Compile Limited\n");
        for p in &compile_limited_sections {
            md.push_str(&format!("- {}\n", p));
        }
    }

    if !num_divergence_sections.is_empty() {
        md.push_str("\n### Numerical Divergence\n");
        for p in &num_divergence_sections {
            md.push_str(&format!("- {}\n", p));
        }
    }

    if !fallback_sections.is_empty() {
        md.push_str("\n### Fallback Paths\n");
        for p in &fallback_sections {
            md.push_str(&format!("- {}\n", p));
        }
    }

    md.push_str("\n## Verdict\n");
    let verdict = if blocked_count > 0 {
        "blocked"
    } else if fallback_count > 0 {
        "usable_with_fallbacks"
    } else {
        "usable"
    };

    md.push_str(&format!("**verdict: {}**\n", verdict));

    (md, verdict.to_string())
}

fn format_iso8601(secs: u64) -> String {
    let days = secs / 86400;
    let day_secs = secs % 86400;
    let hour = day_secs / 3600;
    let min = (day_secs % 3600) / 60;
    let sec = day_secs % 60;

    let z = days as i64 + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if m <= 2 { y + 1 } else { y };

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, m as u32, d as u32, hour, min, sec,
    )
}
