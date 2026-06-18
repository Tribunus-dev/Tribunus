use mlx_rs::backend::{BackendConformanceRunner, MlxBackendCapabilities};

fn main() {
    let caps = MlxBackendCapabilities::detect();
    let runner = BackendConformanceRunner::default().with_capabilities(caps);

    let evidence = match runner.run_core_ops() {
        Ok(v) => v,
        Err(e) => {
            eprintln!("Failed to run core ops: {}", e);
            std::process::exit(1);
        }
    };

    let mut failed = false;
    for record in evidence {
        if record.error.is_some()
            || record
                .comparison
                .as_ref()
                .map(|c| !c.passed)
                .unwrap_or(false)
        {
            failed = true;
        }
        match serde_json::to_string(&record) {
            Ok(s) => println!("{}", s),
            Err(e) => {
                eprintln!("Failed to serialize evidence: {}", e);
                std::process::exit(1);
            }
        }
    }

    if failed {
        std::process::exit(1);
    }
}
