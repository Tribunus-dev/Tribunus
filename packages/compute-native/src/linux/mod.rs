pub mod device;
pub mod backends;

use crate::backend::{TensorBackend, DType, MatmulOp, QuantizedMatmulOp, QuantizedWeightHandle, RmsNormOp, RoPEOp, EvaluationReceipt, ReadbackReceipt, BackendCapabilities};
use crate::backend::tensor_registry::TensorHandle;

pub enum LinuxBackend {
    Vulkan,
    LevelZero,
    XdnaNpu,
    OpenvinoNpu,
    Cpu,
    ScalarFallback,
}

impl LinuxBackend {
    pub fn new() -> Self {
        #[cfg(feature = "linux-vulkan")]
        {
            if let Ok(_) = backends::detect_amd_vulkan() {
                return LinuxBackend::Vulkan;
            }
        }
        
        #[cfg(feature = "linux-intel")]
        {
            if let Ok(_) = backends::detect_intel_level_zero() {
                return LinuxBackend::LevelZero;
            }
        }

        #[cfg(feature = "linux-cpu")]
        {
            if backends::detect_openblas() || backends::detect_amx() || backends::detect_onednn() || device::cpu_has_avx2() {
                return LinuxBackend::Cpu;
            }
        }

        LinuxBackend::ScalarFallback
    }
}


impl TensorBackend for LinuxBackend {
    fn create_f32(&mut self, data: &[f32], shape: &[i32]) -> Result<TensorHandle, String> {
        match self {
            // In a real implementation this would delegate, but for now we stub it or use a default
            _ => Err("Not implemented in LinuxBackend dispatcher".to_string()),
        }
    }

    fn create_u32(&mut self, data: &[u32], shape: &[i32]) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn create_f32_from_bf16_bits(
        &mut self,
        data: &[u16],
        shape: &[i32],
    ) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn create_owned_from_bytes(
        &mut self,
        data: &[u8],
        shape: &[i32],
        dtype: DType,
    ) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn quantized_matmul(
        &mut self,
        op: &QuantizedMatmulOp,
        x: TensorHandle,
        w: QuantizedWeightHandle,
        scales: TensorHandle,
        biases: TensorHandle,
    ) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn matmul(&mut self, op: &MatmulOp, a: TensorHandle, b: TensorHandle) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn rms_norm(
        &mut self,
        op: &RmsNormOp,
        x: TensorHandle,
        weight: TensorHandle,
    ) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn rope(&mut self, op: &RoPEOp, x: TensorHandle) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn add(&mut self, a: TensorHandle, b: TensorHandle) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn multiply(&mut self, a: TensorHandle, b: TensorHandle) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn silu(&mut self, x: TensorHandle) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn transpose(&mut self, x: TensorHandle, dims: &[i32]) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn reshape(&mut self, x: TensorHandle, shape: &[i32]) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn softmax(&mut self, x: TensorHandle, axis: i32) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn index_select(
        &mut self,
        x: TensorHandle,
        indices: &[u32],
        axis: i32,
    ) -> Result<TensorHandle, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn evaluate(&mut self, group_id: u64, outputs: &[TensorHandle]) -> Result<EvaluationReceipt, String> { Err("Not implemented in LinuxBackend dispatcher".to_string()) }

    fn read_f32(&mut self, handle: TensorHandle) -> Result<ReadbackReceipt, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn shape(&self, handle: TensorHandle) -> Result<Vec<i32>, String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn release(&mut self, handle: TensorHandle) -> Result<(), String> {
        Err("Not implemented in LinuxBackend dispatcher".to_string())
    }

    fn active_memory(&self) -> (u64, u64) {
        (0, 0)
    }

    fn backend_capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            can_gpu: false,
            can_cpu: true,
            supports_quantized: false,
            supports_bf16_native: false,
            backend_name: "LinuxScalarFallback".to_string(),
        }
    }
}

