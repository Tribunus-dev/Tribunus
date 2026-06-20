//! Transformer Operator Decomposition Contracts.
//!
//! Canonical phase boundaries and tensor/layout contracts for the six transformer
//! operations Tribunus must compile.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MemoryPlacement {
    L1,
    DRAM,
    SystemMemory,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensixAffordance {
    pub acceptable_tile_sizes: Vec<[u32; 2]>,
    pub cb_depth_hint: u32,
    pub preferred_placement: MemoryPlacement,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum QuantizationFamily {
    None,
    BFP8,
    Int8,
    FP16,
    BF16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TensorContract {
    pub logical_shape: Vec<usize>,
    pub data_format: String,
    pub tile_layout_constraints: Option<[u32; 2]>,
    pub memory_placement: MemoryPlacement,
    pub supported_quantization: Vec<QuantizationFamily>,
}

pub trait OperatorContract {
    fn inputs(&self) -> Vec<TensorContract>;
    fn outputs(&self) -> Vec<TensorContract>;
    fn numerical_tolerance(&self) -> f32;
    fn tensix_affordances(&self) -> Option<TensixAffordance>;
}

// 1. RMSNorm
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RMSNormContract {
    pub input: TensorContract,
    pub weight: TensorContract,
    pub output: TensorContract,
    pub eps: f32,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for RMSNormContract {
    fn inputs(&self) -> Vec<TensorContract> {
        vec![self.input.clone(), self.weight.clone()]
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        1e-4
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

impl RMSNormContract {
    pub fn lower_to_tensix_ir(&self) -> crate::compiler::lowering::tensix::ir::TensixScheduleIR {
        crate::compiler::lowering::tensix::ir::TensixScheduleIR {
            tile_geometry: self
                .tensix
                .as_ref()
                .and_then(|t| t.acceptable_tile_sizes.first().cloned())
                .unwrap_or([32, 32]),
            core_partitioning: [1, 1], // Default
            cb_allocations: std::collections::HashMap::new(),
            dram_sharding: true,
            data_format: self.output.data_format.clone(),
        }
    }
}

// 2. RoPE
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoPEContract {
    pub input: TensorContract,
    pub sin: TensorContract,
    pub cos: TensorContract,
    pub output: TensorContract,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for RoPEContract {
    fn inputs(&self) -> Vec<TensorContract> {
        vec![self.input.clone(), self.sin.clone(), self.cos.clone()]
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        1e-4
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

// 3. QKV Projection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QKVProjectionContract {
    pub input: TensorContract,
    pub weight: TensorContract,
    pub bias: Option<TensorContract>,
    pub output: TensorContract,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for QKVProjectionContract {
    fn inputs(&self) -> Vec<TensorContract> {
        let mut i = vec![self.input.clone(), self.weight.clone()];
        if let Some(b) = &self.bias {
            i.push(b.clone());
        }
        i
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        1e-3
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

impl QKVProjectionContract {
    pub fn lower_to_tensix_ir(&self) -> crate::compiler::lowering::tensix::ir::TensixScheduleIR {
        crate::compiler::lowering::tensix::ir::TensixScheduleIR {
            tile_geometry: self
                .tensix
                .as_ref()
                .and_then(|t| t.acceptable_tile_sizes.first().cloned())
                .unwrap_or([32, 32]),
            core_partitioning: [8, 8], // Example for Matmul
            cb_allocations: std::collections::HashMap::new(),
            dram_sharding: true,
            data_format: self.output.data_format.clone(),
        }
    }
}

// 4. Attention Decode
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AttentionDecodeContract {
    pub q: TensorContract,
    pub k: TensorContract,
    pub v: TensorContract,
    pub output: TensorContract,
    pub is_gqa: bool,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for AttentionDecodeContract {
    fn inputs(&self) -> Vec<TensorContract> {
        vec![self.q.clone(), self.k.clone(), self.v.clone()]
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        5e-3
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

// 5. Residual Add
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResidualAddContract {
    pub input1: TensorContract,
    pub input2: TensorContract,
    pub output: TensorContract,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for ResidualAddContract {
    fn inputs(&self) -> Vec<TensorContract> {
        vec![self.input1.clone(), self.input2.clone()]
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        1e-4
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

// 6. MLP (SwiGLU / GELU)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MLPContract {
    pub input: TensorContract,
    pub gate_proj: Option<TensorContract>, // For SwiGLU
    pub up_proj: TensorContract,
    pub down_proj: TensorContract,
    pub output: TensorContract,
    pub activation: MLPActivation,
    pub tensix: Option<TensixAffordance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MLPActivation {
    SwiGLU,
    GELU,
}

impl OperatorContract for MLPContract {
    fn inputs(&self) -> Vec<TensorContract> {
        let mut i = vec![self.input.clone()];
        if let Some(g) = &self.gate_proj {
            i.push(g.clone());
        }
        i.push(self.up_proj.clone());
        i.push(self.down_proj.clone());
        i
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        5e-3
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

// 7. Logits Projection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogitsProjectionContract {
    pub input: TensorContract,
    pub weight: TensorContract,
    pub output: TensorContract,
    pub tensix: Option<TensixAffordance>,
}

impl OperatorContract for LogitsProjectionContract {
    fn inputs(&self) -> Vec<TensorContract> {
        vec![self.input.clone(), self.weight.clone()]
    }
    fn outputs(&self) -> Vec<TensorContract> {
        vec![self.output.clone()]
    }
    fn numerical_tolerance(&self) -> f32 {
        5e-3
    }
    fn tensix_affordances(&self) -> Option<TensixAffordance> {
        self.tensix.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json;

    #[test]
    fn test_rmsnorm_serialization() {
        let contract = RMSNormContract {
            input: TensorContract {
                logical_shape: vec![1, 32, 128],
                data_format: "fp16".to_string(),
                tile_layout_constraints: Some([32, 32]),
                memory_placement: MemoryPlacement::L1,
                supported_quantization: vec![QuantizationFamily::None],
            },
            weight: TensorContract {
                logical_shape: vec![128],
                data_format: "fp16".to_string(),
                tile_layout_constraints: None,
                memory_placement: MemoryPlacement::DRAM,
                supported_quantization: vec![QuantizationFamily::None],
            },
            output: TensorContract {
                logical_shape: vec![1, 32, 128],
                data_format: "fp16".to_string(),
                tile_layout_constraints: Some([32, 32]),
                memory_placement: MemoryPlacement::L1,
                supported_quantization: vec![QuantizationFamily::None],
            },
            eps: 1e-5,
            tensix: Some(TensixAffordance {
                acceptable_tile_sizes: vec![[32, 32]],
                cb_depth_hint: 2,
                preferred_placement: MemoryPlacement::L1,
            }),
        };

        let json = serde_json::to_string_pretty(&contract).unwrap();
        println!("RMSNorm JSON:\n{}", json);
        assert!(json.contains("logical_shape"));
    }

    #[test]
    fn test_qkv_serialization() {
        let contract = QKVProjectionContract {
            input: TensorContract {
                logical_shape: vec![1, 32, 128],
                data_format: "fp16".to_string(),
                tile_layout_constraints: Some([32, 32]),
                memory_placement: MemoryPlacement::L1,
                supported_quantization: vec![QuantizationFamily::None],
            },
            weight: TensorContract {
                logical_shape: vec![128, 384],
                data_format: "fp16".to_string(),
                tile_layout_constraints: Some([32, 32]),
                memory_placement: MemoryPlacement::DRAM,
                supported_quantization: vec![QuantizationFamily::BFP8],
            },
            bias: None,
            output: TensorContract {
                logical_shape: vec![1, 32, 384],
                data_format: "fp16".to_string(),
                tile_layout_constraints: Some([32, 32]),
                memory_placement: MemoryPlacement::L1,
                supported_quantization: vec![QuantizationFamily::None],
            },
            tensix: Some(TensixAffordance {
                acceptable_tile_sizes: vec![[32, 32], [16, 16]],
                cb_depth_hint: 2,
                preferred_placement: MemoryPlacement::L1,
            }),
        };

        let json = serde_json::to_string_pretty(&contract).unwrap();
        println!("QKV JSON:\n{}", json);
        assert!(json.contains("logical_shape"));
    }
}
