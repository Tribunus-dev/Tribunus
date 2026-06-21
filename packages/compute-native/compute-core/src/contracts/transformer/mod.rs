use crate::backend::DType;

/// Tensix Affordance trait.
pub trait TensixAffordance {
    fn lower_to_tensix_ir(
        &self,
    ) -> Result<crate::compiler::lowering::tensix::ir::TensixScheduleIR, String>;
}

/// RMSNorm Contract.
#[derive(Debug, Clone)]
pub struct RmsNormContract {
    pub input_shape: Vec<usize>,
    pub weight_shape: Vec<usize>,
    pub output_shape: Vec<usize>,
    pub dtype: DType,
    pub eps: f32,
}

impl TensixAffordance for RmsNormContract {
    fn lower_to_tensix_ir(
        &self,
    ) -> Result<crate::compiler::lowering::tensix::ir::TensixScheduleIR, String> {
        // Mock implementation
        Ok(crate::compiler::lowering::tensix::ir::TensixScheduleIR {})
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RopeRotationMode {
    HalfRotation, // Interleaved: (q0*c - q1*s, q1*c + q0*s)
    FullNeox,     // Neox: (q_i*c - q_{i+d/2}*s, q_{i+d/2}*c + q_i*s)
}

/// RoPE Contract.
#[derive(Debug, Clone)]
pub struct RopeContract {
    pub query_shape: Vec<usize>,
    pub head_dim: usize,
    pub max_seq_len: usize,
    pub dtype: DType,
    pub mode: RopeRotationMode,
    // Add missing position index and cos/sin tables to the contract
    pub position_index: usize,
    pub cos_table: Vec<f32>,
    pub sin_table: Vec<f32>,
}

impl TensixAffordance for RopeContract {
    fn lower_to_tensix_ir(
        &self,
    ) -> Result<crate::compiler::lowering::tensix::ir::TensixScheduleIR, String> {
        // Mock implementation
        Ok(crate::compiler::lowering::tensix::ir::TensixScheduleIR {})
    }
}
