use std::path::PathBuf;

#[cfg(feature = "daemon")]
mod daemon;

#[cfg(feature = "daemon")]
use daemon::{DaemonConfig, LinuxDaemon};

#[cfg(feature = "daemon")]
fn main() -> std::io::Result<()> {
    // Determine the runtime directory based on user ID
    let uid = unsafe { libc::getuid() };
    let run_dir_str = format!("/run/user/{}", uid);
    let run_dir = PathBuf::from(&run_dir_str);

    let config = DaemonConfig {
        pid_file: PathBuf::from(&run_dir_str).join("tribunus-compute.pid"),
        log_file: PathBuf::from("/var/log/tribunus/compute.log"),
        valkey_path: "valkey-server".into(),
        valkey_port: 6379,
        http_port: 8081,
        ws_port: 8082,
    };
    
    // Fallback for permissions
    let pid_file = if std::fs::create_dir_all(&run_dir).is_ok() {
        config.pid_file
    } else if let Ok(xdg) = std::env::var("XDG_RUNTIME_DIR") {
        PathBuf::from(xdg).join("tribunus-compute.pid")
    } else {
        PathBuf::from("/tmp/tribunus-compute.pid")
    };

    let log_file = if std::fs::create_dir_all("/var/log/tribunus").is_ok() {
        config.log_file
    } else {
        PathBuf::from("/tmp/tribunus-compute.log")
    };

    let final_config = DaemonConfig {
        pid_file,
        log_file,
        ..config
    };

    // Daemonize BEFORE creating the Tokio runtime
    daemon::daemonize(&final_config.log_file)?;

    // Now that we're in the daemon child process, create the runtime
    let rt = tokio::runtime::Runtime::new()?;
    rt.block_on(async {
        let mut daemon = LinuxDaemon::new(final_config);
        daemon.run().await
    })
}

#[cfg(not(feature = "daemon"))]
fn main() {
    println!("Daemon feature not enabled");
}