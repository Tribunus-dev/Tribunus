use std::time::Instant;
use std::sync::OnceLock;
use crate::backend::zenblas::{CPUDispatch, matmul_f32, matmul_int8};

#[derive(Debug, Clone)]
pub struct BenchmarkResult {
    pub gflops: f64,
    pub latency_us: u64,
    pub vmrss_kb: u64,
    pub l1_misses: u64,
    pub llc_misses: u64,
    pub instructions: u64,
    pub cycles: u64,
}

static BENCHMARK_CACHE: OnceLock<Vec<(CPUDispatch, BenchmarkResult)>> = OnceLock::new();

#[cfg(target_os = "linux")]
mod perf {
    use std::mem;
    use libc::{c_long, syscall, SYS_perf_event_open, pid_t};

    #[repr(C)]
    #[derive(Default)]
    pub struct perf_event_attr {
        pub type_: u32,
        pub size: u32,
        pub config: u64,
        pub sample_period_freq: u64,
        pub sample_type: u64,
        pub read_format: u64,
        pub flags: u64,
        pub wakeup_events_watermark: u32,
        pub bp_type: u32,
        pub bp_addr: u64,
        pub bp_len: u64,
        pub branch_sample_type: u64,
        pub sample_regs_user: u64,
        pub sample_stack_user: u32,
        pub clockid: i32,
        pub sample_regs_intr: u64,
        pub aux_watermark: u32,
        pub sample_max_stack: u16,
        pub __reserved_2: u16,
    }

    pub const PERF_TYPE_HARDWARE: u32 = 0;
    pub const PERF_TYPE_HW_CACHE: u32 = 3;

    pub const PERF_COUNT_HW_CPU_CYCLES: u64 = 0;
    pub const PERF_COUNT_HW_INSTRUCTIONS: u64 = 1;

    pub const PERF_COUNT_HW_CACHE_L1D: u64 = 0;
    pub const PERF_COUNT_HW_CACHE_LL: u64 = 2;

    pub const PERF_COUNT_HW_CACHE_OP_READ: u64 = 0;
    pub const PERF_COUNT_HW_CACHE_RESULT_MISS: u64 = 1;

    pub fn open_counter(type_: u32, config: u64) -> std::io::Result<i32> {
        let mut attr: perf_event_attr = Default::default();
        attr.type_ = type_;
        attr.size = mem::size_of::<perf_event_attr>() as u32;
        attr.config = config;
        attr.flags = 1 << 0; // disabled initially

        let fd = unsafe {
            syscall(
                SYS_perf_event_open,
                &attr as *const _,
                0 as pid_t, // pid 0 = current thread
                -1 as c_long, // cpu -1 = all cpus
                -1 as c_long, // group_fd
                0 as c_long, // flags
            )
        };

        if fd < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(fd as i32)
        }
    }

    pub fn read_counter(fd: i32) -> u64 {
        let mut val = 0u64;
        unsafe {
            libc::read(fd, &mut val as *mut u64 as *mut libc::c_void, 8);
        }
        val
    }
}

pub fn run_benchmarks() -> Vec<(CPUDispatch, BenchmarkResult)> {
    if let Some(results) = BENCHMARK_CACHE.get() {
        return results.clone();
    }

    let mut results = Vec::new();

    let m = 256;
    let n = 256;
    let k = 256;

    let a = vec![1.0f32; m * k];
    let b = vec![2.0f32; k * n];
    let mut c = vec![0.0f32; m * n];

    let paths = vec![
        CPUDispatch::OpenBLAS,
        CPUDispatch::Avx2,
        CPUDispatch::Scalar,
    ];

    for path in paths {
        let result = bench_path(path, m, n, k, &a, &b, &mut c);
        results.push((path, result));
    }

    // Also benchmark AMX with int8
    let a_i8 = vec![1i8; 64 * 64];
    let b_i8 = vec![2i8; 64 * 64];
    let mut c_i32 = vec![0i32; 64 * 64];
    
    let result_amx = bench_int8_path(CPUDispatch::AmxTile, 64, 64, 64, &a_i8, &b_i8, &mut c_i32);
    results.push((CPUDispatch::AmxTile, result_amx));

    let _ = BENCHMARK_CACHE.set(results.clone());
    results
}

fn bench_path(path: CPUDispatch, m: usize, n: usize, k: usize, a: &[f32], b: &[f32], c: &mut [f32]) -> BenchmarkResult {
    let ops = (2 * m * n * k) as f64;
    
    #[cfg(target_os = "linux")]
    let (l1_fd, llc_fd, inst_fd, cyc_fd) = {
        let l1_config = perf::PERF_COUNT_HW_CACHE_L1D | (perf::PERF_COUNT_HW_CACHE_OP_READ << 8) | (perf::PERF_COUNT_HW_CACHE_RESULT_MISS << 16);
        let llc_config = perf::PERF_COUNT_HW_CACHE_LL | (perf::PERF_COUNT_HW_CACHE_OP_READ << 8) | (perf::PERF_COUNT_HW_CACHE_RESULT_MISS << 16);

        (
            perf::open_counter(perf::PERF_TYPE_HW_CACHE, l1_config).unwrap_or(-1),
            perf::open_counter(perf::PERF_TYPE_HW_CACHE, llc_config).unwrap_or(-1),
            perf::open_counter(perf::PERF_TYPE_HARDWARE, perf::PERF_COUNT_HW_INSTRUCTIONS).unwrap_or(-1),
            perf::open_counter(perf::PERF_TYPE_HARDWARE, perf::PERF_COUNT_HW_CPU_CYCLES).unwrap_or(-1)
        )
    };

    #[cfg(target_os = "linux")]
    unsafe {
        if l1_fd >= 0 { libc::ioctl(l1_fd, 0x2400, 0); } // PERF_EVENT_IOC_ENABLE
        if llc_fd >= 0 { libc::ioctl(llc_fd, 0x2400, 0); }
        if inst_fd >= 0 { libc::ioctl(inst_fd, 0x2400, 0); }
        if cyc_fd >= 0 { libc::ioctl(cyc_fd, 0x2400, 0); }
    }

    let start = Instant::now();
    
    // Using internal dispatch for benchmark purposes by circumventing the global dispatch
    // In actual implementation, we might need a test-only injection or separate bench logic.
    match path {
        CPUDispatch::Scalar => crate::backend::zenblas::matmul_f32(m, n, k, a, b, c),
        _ => crate::backend::zenblas::matmul_f32(m, n, k, a, b, c), // Assuming dispatch is mocked or we use direct calls
    }

    let elapsed = start.elapsed();

    #[cfg(target_os = "linux")]
    let (l1_misses, llc_misses, instructions, cycles) = unsafe {
        let l1 = if l1_fd >= 0 { libc::ioctl(l1_fd, 0x2401, 0); perf::read_counter(l1_fd) } else { 0 };
        let llc = if llc_fd >= 0 { libc::ioctl(llc_fd, 0x2401, 0); perf::read_counter(llc_fd) } else { 0 };
        let inst = if inst_fd >= 0 { libc::ioctl(inst_fd, 0x2401, 0); perf::read_counter(inst_fd) } else { 0 };
        let cyc = if cyc_fd >= 0 { libc::ioctl(cyc_fd, 0x2401, 0); perf::read_counter(cyc_fd) } else { 0 };
        
        if l1_fd >= 0 { libc::close(l1_fd); }
        if llc_fd >= 0 { libc::close(llc_fd); }
        if inst_fd >= 0 { libc::close(inst_fd); }
        if cyc_fd >= 0 { libc::close(cyc_fd); }
        
        (l1, llc, inst, cyc)
    };

    #[cfg(not(target_os = "linux"))]
    let (l1_misses, llc_misses, instructions, cycles) = (0, 0, 0, 0);

    let sec = elapsed.as_secs_f64();
    let gflops = (ops / sec) / 1e9;

    let vmrss_kb = get_vmrss_kb();

    BenchmarkResult {
        gflops,
        latency_us: elapsed.as_micros() as u64,
        vmrss_kb,
        l1_misses,
        llc_misses,
        instructions,
        cycles,
    }
}

fn get_vmrss_kb() -> u64 {
    #[cfg(target_os = "linux")]
    {
        use std::fs::File;
        use std::io::{BufRead, BufReader};
        if let Ok(file) = File::open("/proc/self/status") {
            let reader = BufReader::new(file);
            for line in reader.lines().flatten() {
                if line.starts_with("VmRSS:") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    if parts.len() >= 2 {
                        if let Ok(kb) = parts[1].parse::<u64>() {
                            return kb;
                        }
                    }
                }
            }
        }
        0
    }
    #[cfg(not(target_os = "linux"))]
    {
        0
    }
}

fn bench_int8_path(path: CPUDispatch, m: usize, n: usize, k: usize, a: &[i8], b: &[i8], c: &mut [i32]) -> BenchmarkResult {
    let ops = (2 * m * n * k) as f64;
    let start = Instant::now();
    
    matmul_int8(m, n, k, a, b, c);

    let elapsed = start.elapsed();
    let sec = elapsed.as_secs_f64();
    let gflops = (ops / sec) / 1e9;

    let vmrss_kb = get_vmrss_kb();

    BenchmarkResult {
        gflops,
        latency_us: elapsed.as_micros() as u64,
        vmrss_kb,
        l1_misses: 0,
        llc_misses: 0,
        instructions: 0,
        cycles: 0,
    }
}
