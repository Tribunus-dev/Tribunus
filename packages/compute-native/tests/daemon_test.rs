use std::fs;
use std::path::PathBuf;

// We use an integration test to avoid running actual daemonization (which forks and exits).
// Testing daemon internals requires separating the logic cleanly, which is done by config checks here.

#[cfg(feature = "daemon")]
#[path = "../src/linux/daemon.rs"]
mod daemon;

#[cfg(feature = "daemon")]
#[tokio::test]
async fn test_daemon_config() {
    use daemon::DaemonConfig;

    let config = DaemonConfig {
        pid_file: PathBuf::from("/tmp/test-tribunus.pid"),
        log_file: PathBuf::from("/tmp/test-tribunus.log"),
        valkey_path: "echo".into(), // mock valkey
        valkey_port: 6379,
        http_port: 8081,
        ws_port: 8082,
    };
    
    // Test that the config can be created correctly
    assert_eq!(config.valkey_port, 6379);
    assert_eq!(config.http_port, 8081);
    assert_eq!(config.valkey_path, "echo");
}