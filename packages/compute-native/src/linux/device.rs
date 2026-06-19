use std::fs;
use std::path::Path;

pub fn is_amd_gpu_present() -> bool {
    check_gpu_vendor("0x1002") // AMD Vendor ID
}

pub fn is_intel_gpu_present() -> bool {
    check_gpu_vendor("0x8086") // Intel Vendor ID
}

fn check_gpu_vendor(target_vendor: &str) -> bool {
    let drm_path = Path::new("/sys/class/drm");
    if !drm_path.exists() {
        return false;
    }

    if let Ok(entries) = fs::read_dir(drm_path) {
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.file_name().and_then(|n| n.to_str()).map_or(false, |n| n.starts_with("card")) {
                let vendor_path = path.join("device/vendor");
                if let Ok(vendor) = fs::read_to_string(vendor_path) {
                    if vendor.trim().eq_ignore_ascii_case(target_vendor) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn cpu_has_amx() -> bool {
    check_cpu_feature("amx_tile")
}

pub fn cpu_has_avx2() -> bool {
    check_cpu_feature("avx2")
}

pub fn cpu_has_avx512() -> bool {
    check_cpu_feature("avx512")
}

pub fn cpu_has_f16c() -> bool {
    check_cpu_feature("f16c")
}

fn check_cpu_feature(feature: &str) -> bool {
    if let Ok(cpuinfo) = fs::read_to_string("/proc/cpuinfo") {
        for line in cpuinfo.lines() {
            if line.starts_with("flags") || line.starts_with("Features") {
                if line.contains(feature) {
                    return true;
                }
            }
        }
    }
    false
}

pub struct MemoryInfo {
    pub total: u64,
    pub available: u64,
}

pub fn get_memory_info() -> Option<MemoryInfo> {
    if let Ok(meminfo) = fs::read_to_string("/proc/meminfo") {
        let mut total = 0;
        let mut available = 0;
        for line in meminfo.lines() {
            if line.starts_with("MemTotal:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Ok(kb) = parts[1].parse::<u64>() {
                        total = kb * 1024;
                    }
                }
            }
            if line.starts_with("MemAvailable:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 2 {
                    if let Ok(kb) = parts[1].parse::<u64>() {
                        available = kb * 1024;
                    }
                }
            }
        }
        if total > 0 {
            return Some(MemoryInfo { total, available });
        }
    }
    None
}

pub struct CacheInfo {
    pub l1_data: u64,
    pub l2: u64,
    pub l3: u64,
}

pub fn get_cpu_cache_info() -> CacheInfo {
    let mut cache = CacheInfo { l1_data: 0, l2: 0, l3: 0 };
    
    // CPU 0 is usually representative
    let base_path = Path::new("/sys/devices/system/cpu/cpu0/cache");
    if base_path.exists() {
        if let Ok(entries) = fs::read_dir(base_path) {
            for entry in entries.filter_map(Result::ok) {
                let index_path = entry.path();
                let level_path = index_path.join("level");
                let type_path = index_path.join("type");
                let size_path = index_path.join("size");
                
                if let (Ok(level_str), Ok(type_str), Ok(size_str)) = (
                    fs::read_to_string(&level_path),
                    fs::read_to_string(&type_path),
                    fs::read_to_string(&size_path)
                ) {
                    let level = level_str.trim();
                    let cache_type = type_str.trim();
                    let size_str = size_str.trim().trim_end_matches('K');
                    
                    if let Ok(size_kb) = size_str.parse::<u64>() {
                        let size_bytes = size_kb * 1024;
                        if level == "1" && cache_type == "Data" {
                            cache.l1_data = size_bytes;
                        } else if level == "2" {
                            cache.l2 = size_bytes;
                        } else if level == "3" {
                            cache.l3 = size_bytes;
                        }
                    }
                }
            }
        }
    }
    
    cache
}
