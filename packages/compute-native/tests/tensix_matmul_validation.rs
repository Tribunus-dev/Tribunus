use tribunus_compute_native::tensix::device::{DeviceWeightResidency, ResidencyHandle};
use tribunus_compute_native::tensix::matmul::{
    DeviceTiming, FailureClassification, MatmulProvider, MatmulValidationReport,
};
use std::time::Duration;

// -----------------------------------------------------------------------------
// CPU Reference Implementation
// -----------------------------------------------------------------------------
fn cpu_reference_matmul(a: &[i8], a_shape: &[usize], w: &[i8], w_shape: &[usize]) -> Vec<f32> {
    let m = a_shape[0];
    let k = a_shape[1];
    let n = w_shape[1];
    assert_eq!(k, w_shape[0]);

    let mut out = vec![0.0; m * n];
    for i in 0..m {
        for j in 0..n {
            let mut sum = 0.0;
            for l in 0..k {
                sum += (a[i * k + l] as f32) * (w[l * n + j] as f32);
            }
            out[i * n + j] = sum;
        }
    }
    out
}

// -----------------------------------------------------------------------------
// Mock Provider (Hardware Absent)
// -----------------------------------------------------------------------------
pub struct MockTensixProvider {
    pub weights: std::collections::HashMap<usize, Vec<i8>>,
    pub next_handle: usize,
}

impl MockTensixProvider {
    pub fn new() -> Self {
        Self {
            weights: std::collections::HashMap::new(),
            next_handle: 0,
        }
    }
}

impl DeviceWeightResidency for MockTensixProvider {
    fn load_weights(&mut self, _tensor_id: &str, data: &[i8], _shape: &[usize]) -> Result<ResidencyHandle, String> {
        let handle = self.next_handle;
        self.next_handle += 1;
        self.weights.insert(handle, data.to_vec());
        Ok(ResidencyHandle(handle))
    }

    fn release_weights(&mut self, handle: ResidencyHandle) -> Result<(), String> {
        self.weights.remove(&handle.0);
        Ok(())
    }
}

impl MatmulProvider for MockTensixProvider {
    fn execute_matmul(
        &self,
        a_data: &[i8],
        a_shape: &[usize],
        w_handle: ResidencyHandle,
        w_shape: &[usize],
    ) -> Result<(Vec<f32>, MatmulValidationReport), FailureClassification> {
        let w_data = self.weights.get(&w_handle.0).ok_or(FailureClassification::HostBridgeIssue)?;

        let out = cpu_reference_matmul(a_data, a_shape, w_data, w_shape);

        let report = MatmulValidationReport {
            tolerance: 1e-2,
            max_error: 0.0,
            timing: DeviceTiming {
                compile_time: Duration::from_millis(1),
                load_time: Duration::from_millis(1),
                execute_time: Duration::from_millis(1),
                readback_time: Duration::from_millis(1),
            },
            classification: FailureClassification::Success,
            shape_a: a_shape.to_vec(),
            shape_b: w_shape.to_vec(),
        };

        Ok((out, report))
    }
}

// -----------------------------------------------------------------------------
// Hardware Provider Placeholder
// -----------------------------------------------------------------------------
// In a real device setup, this struct would hold the TT-Metalium bridge,
// dispatch queues, memory planners, and device IDs.
pub struct RealTensixProvider;

impl RealTensixProvider {
    pub fn new() -> Self {
        Self
    }
}

impl DeviceWeightResidency for RealTensixProvider {
    fn load_weights(&mut self, _tensor_id: &str, _data: &[i8], _shape: &[usize]) -> Result<ResidencyHandle, String> {
        // Real hardware implementation goes here.
        // Returning a mock handle to allow the test to compile and panic later.
        Ok(ResidencyHandle(0))
    }

    fn release_weights(&mut self, _handle: ResidencyHandle) -> Result<(), String> {
        Ok(())
    }
}

impl MatmulProvider for RealTensixProvider {
    fn execute_matmul(
        &self,
        _a_data: &[i8],
        _a_shape: &[usize],
        _w_handle: ResidencyHandle,
        _w_shape: &[usize],
    ) -> Result<(Vec<f32>, MatmulValidationReport), FailureClassification> {
        // This is where we would call out to src/backend/tt_metalium/bridge.rs
        // and lower the operation to TensixScheduleIR. Since those files do not
        // exist in the provided context and we are simulating the scaffold for now,
        // we explicitly panic if this is reached in a hardware test without an implementation.
        unimplemented!("Real hardware execution requires the tt_metalium bridge which is currently unlinked in this session.")
    }
}

// -----------------------------------------------------------------------------
// Test Harness
// -----------------------------------------------------------------------------
trait TestProvider: DeviceWeightResidency + MatmulProvider {}
impl TestProvider for MockTensixProvider {}
impl TestProvider for RealTensixProvider {}

fn get_provider() -> Box<dyn TestProvider> {
    if std::env::var("TENSIX_DEVICE_AVAILABLE").is_ok() {
        Box::new(RealTensixProvider::new())
    } else {
        Box::new(MockTensixProvider::new())
    }
}

fn test_matmul_shape(m: usize, k: usize, n: usize) {
    let mut provider = get_provider();

    let a_shape = vec![m, k];
    let w_shape = vec![k, n];

    let mut a_data = vec![0i8; m * k];
    let mut w_data = vec![0i8; k * n];

    // Simple deterministic initialization
    for i in 0..a_data.len() {
        a_data[i] = (i % 10) as i8;
    }
    for i in 0..w_data.len() {
        w_data[i] = (i % 10) as i8;
    }

    let w_handle = provider.load_weights("w1", &w_data, &w_shape).unwrap();

    let (device_out, report) = provider.execute_matmul(&a_data, &a_shape, w_handle.clone(), &w_shape).unwrap();
    let cpu_out = cpu_reference_matmul(&a_data, &a_shape, &w_data, &w_shape);

    let mut max_error = 0.0;
    for (d, c) in device_out.iter().zip(cpu_out.iter()) {
        let err = (d - c).abs();
        if err > max_error {
            max_error = err;
        }
    }

    assert!(max_error <= report.tolerance, "Max error {} exceeded tolerance {}", max_error, report.tolerance);
    assert!(matches!(report.classification, FailureClassification::Success));

    provider.release_weights(w_handle).unwrap();
}

#[test]
fn test_matmul_tile_aligned() {
    if std::env::var("TENSIX_DEVICE_AVAILABLE").is_ok() {
        test_matmul_shape(4096, 4096, 4096);
    } else {
        // Scaled down for mock CI performance
        test_matmul_shape(128, 128, 128);
    }
}

#[test]
fn test_matmul_decode_like() {
    if std::env::var("TENSIX_DEVICE_AVAILABLE").is_ok() {
        test_matmul_shape(1, 4096, 4096);
    } else {
        test_matmul_shape(1, 128, 128);
    }
}

#[test]
fn test_matmul_non_tile_aligned() {
    test_matmul_shape(100, 100, 100);
}
