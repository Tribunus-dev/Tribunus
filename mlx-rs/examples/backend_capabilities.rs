use mlx_rs::backend::MlxBackendCapabilities;

fn main() {
    let caps = MlxBackendCapabilities::detect();
    match serde_json::to_string_pretty(&caps) {
        Ok(s) => println!("{}", s),
        Err(e) => {
            eprintln!("Failed to serialize capabilities: {}", e);
            std::process::exit(1);
        }
    }
}
