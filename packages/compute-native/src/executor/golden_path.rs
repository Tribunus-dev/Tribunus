use crate::compiler::aot::compiler::{DispatchEntry, TribunusExecutable};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

pub struct GoldenPathExecutor {
    executable: Arc<TribunusExecutable>,
}

impl GoldenPathExecutor {
    pub fn new(executable: TribunusExecutable) -> Self {
        Self {
            executable: Arc::new(executable),
        }
    }

    /// Golden path executor runs the .tribunus-exe with all processors concurrently
    /// (GPU layer N, NPU layer N+1, CPU layer N+2 simultaneously)
    pub fn execute(&self) {
        let exec = Arc::clone(&self.executable);

        // Simulated concurrency
        let gpu_thread = thread::spawn(move || {
            for entry in &exec.dispatch_table {
                println!(
                    "GPU executing kernel {} for layer {}",
                    entry.kernel_name, entry.layer_idx
                );
                thread::sleep(Duration::from_millis(10));
            }
        });

        let exec_npu = Arc::clone(&self.executable);
        let npu_thread = thread::spawn(move || {
            for entry in &exec_npu.dispatch_table {
                println!(
                    "NPU executing kernel {} for layer {}",
                    entry.kernel_name,
                    entry.layer_idx + 1
                );
                thread::sleep(Duration::from_millis(10));
            }
        });

        let exec_cpu = Arc::clone(&self.executable);
        let cpu_thread = thread::spawn(move || {
            for entry in &exec_cpu.dispatch_table {
                println!(
                    "CPU executing kernel {} for layer {}",
                    entry.kernel_name,
                    entry.layer_idx + 2
                );
                thread::sleep(Duration::from_millis(10));
            }
        });

        gpu_thread.join().unwrap();
        npu_thread.join().unwrap();
        cpu_thread.join().unwrap();
    }
}
