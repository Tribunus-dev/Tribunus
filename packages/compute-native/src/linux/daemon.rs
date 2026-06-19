use std::fs::{File, OpenOptions};
use std::io::{self, Error, ErrorKind, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use tokio::task::JoinHandle;
use libc::{c_int, pid_t};
use std::os::fd::AsRawFd;

pub struct DaemonConfig {
    pub pid_file: PathBuf,
    pub log_file: PathBuf,
    pub valkey_path: String,
    pub valkey_port: u16,
    pub http_port: u16,
    pub ws_port: u16,
}

pub struct LinuxDaemon {
    config: DaemonConfig,
    valkey_handle: Option<Child>,
    compute_handle: Option<JoinHandle<()>>,
    shutdown: tokio::sync::watch::Sender<bool>,
}

impl LinuxDaemon {
    pub fn new(config: DaemonConfig) -> Self {
        let (shutdown_tx, _) = tokio::sync::watch::channel(false);
        Self {
            config,
            valkey_handle: None,
            compute_handle: None,
            shutdown: shutdown_tx,
        }
    }

    pub async fn run(&mut self) -> io::Result<()> {
        // 1. write PID file
        write_pid_file(&self.config.pid_file)?;

        // 2. start valkey subprocess
        self.valkey_handle = Some(start_valkey(&self.config.valkey_path, self.config.valkey_port)?);

        // 3. start compute-native HTTP/WS server (dummy implementation for now)
        let mut shutdown_rx = self.shutdown.subscribe();
        self.compute_handle = Some(tokio::spawn(async move {
            // Wait for shutdown signal
            let _ = shutdown_rx.changed().await;
        }));

        // 4. wait for shutdown signal handling
        // Setup signal handlers
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate())?;
        let mut sigint = signal(SignalKind::interrupt())?;
        let mut sigusr1 = signal(SignalKind::user_defined1())?;
        let mut sigusr2 = signal(SignalKind::user_defined2())?;

        loop {
            tokio::select! {
                _ = sigterm.recv() => {
                    println!("Received SIGTERM, shutting down");
                    break;
                }
                _ = sigint.recv() => {
                    println!("Received SIGINT, shutting down");
                    break;
                }
                _ = sigusr1.recv() => {
                    println!("Received SIGUSR1 (log rotation)");
                    // Handle log rotation if needed
                }
                _ = sigusr2.recv() => {
                    println!("Received SIGUSR2 (dump state)");
                    // Handle state dump if needed
                }
                // Monitor valkey process
                _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                    if let Some(ref mut child) = self.valkey_handle {
                        match child.try_wait() {
                            Ok(Some(status)) => {
                                eprintln!("Valkey process exited with status: {}", status);
                                // Restart valkey
                                match start_valkey(&self.config.valkey_path, self.config.valkey_port) {
                                    Ok(new_child) => {
                                        println!("Restarted Valkey");
                                        self.valkey_handle = Some(new_child);
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to restart valkey: {}", e);
                                        break;
                                    }
                                }
                            }
                            Ok(None) => {
                                // Still running
                            }
                            Err(e) => {
                                eprintln!("Error waiting for valkey: {}", e);
                                break;
                            }
                        }
                    }
                }
            }
        }

        // 5. graceful shutdown: stop valkey, stop compute, remove PID file
        self.shutdown().await;

        Ok(())
    }

    pub async fn shutdown(&mut self) {
        // Signal compute tasks to stop
        let _ = self.shutdown.send(true);
        if let Some(handle) = self.compute_handle.take() {
            let _ = handle.await;
        }

        // Stop valkey
        if let Some(mut child) = self.valkey_handle.take() {
            let _ = child.kill();
            let _ = child.wait();
        }

        // Remove PID file
        let _ = std::fs::remove_file(&self.config.pid_file);
    }
}

pub fn daemonize(log_file: &Path) -> io::Result<()> {
    unsafe {
        // First fork
        let pid = libc::fork();
        if pid < 0 {
            return Err(Error::last_os_error());
        }
        if pid > 0 {
            std::process::exit(0);
        }

        // Create new session
        if libc::setsid() < 0 {
            return Err(Error::last_os_error());
        }

        // Second fork (optional but recommended to prevent acquiring a controlling terminal)
        let pid2 = libc::fork();
        if pid2 < 0 {
            return Err(Error::last_os_error());
        }
        if pid2 > 0 {
            std::process::exit(0);
        }

        // Set umask
        libc::umask(0o022);

        // Change working directory
        if libc::chdir(b"/\0".as_ptr() as *const _) < 0 {
            return Err(Error::last_os_error());
        }

        // Close all open file descriptors
        let max_fd = libc::sysconf(libc::_SC_OPEN_MAX);
        let max_fd = if max_fd < 0 { 1024 } else { max_fd as c_int };
        for fd in 0..max_fd {
            libc::close(fd);
        }

        // Open /dev/null for stdin
        let fd0 = libc::open(b"/dev/null\0".as_ptr() as *const _, libc::O_RDONLY);
        if fd0 != libc::STDIN_FILENO {
            return Err(Error::new(ErrorKind::Other, "Failed to redirect stdin"));
        }

        // Open log file for stdout/stderr
        if let Some(parent) = log_file.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        
        // CString should be used safely
        let log_path_str = log_file.to_str().ok_or_else(|| Error::new(ErrorKind::Other, "Invalid path"))?;
        let log_path_c = std::ffi::CString::new(log_path_str).map_err(|_| Error::new(ErrorKind::Other, "Invalid path"))?;
        let fd1 = libc::open(
            log_path_c.as_ptr(),
            libc::O_WRONLY | libc::O_CREAT | libc::O_APPEND,
            0o644,
        );
        if fd1 != libc::STDOUT_FILENO {
            return Err(Error::new(ErrorKind::Other, "Failed to redirect stdout"));
        }

        let fd2 = libc::dup(libc::STDOUT_FILENO);
        if fd2 != libc::STDERR_FILENO {
            return Err(Error::new(ErrorKind::Other, "Failed to redirect stderr"));
        }
    }

    Ok(())
}

fn write_pid_file(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    // Use flock to ensure exclusive access
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .open(path)?;

    unsafe {
        if libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) != 0 {
            let err = Error::last_os_error();
            if err.raw_os_error() == Some(libc::EWOULDBLOCK) {
                // Another daemon is running
                // Check if process is actually alive
                let current_content = std::fs::read_to_string(path)?;
                if let Ok(pid) = current_content.trim().parse::<i32>() {
                    if libc::kill(pid, 0) == 0 {
                        return Err(Error::new(ErrorKind::AlreadyExists, "Daemon already running"));
                    }
                }
            } else {
                return Err(err);
            }
        }
    }

    // Truncate and write current PID
    file.set_len(0)?;
    writeln!(file, "{}", std::process::id())?;

    Ok(())
}

fn start_valkey(path: &str, port: u16) -> io::Result<Child> {
    let mut child = Command::new(path)
        .arg("--port")
        .arg(port.to_string())
        .stdout(Stdio::null()) // Or redirect to log
        .stderr(Stdio::null())
        .spawn()?;

    // Check if it's still alive after a short delay
    std::thread::sleep(std::time::Duration::from_millis(100));
    if let Ok(Some(status)) = child.try_wait() {
        return Err(Error::new(ErrorKind::Other, format!("Valkey exited immediately with status: {}", status)));
    }

    Ok(child)
}