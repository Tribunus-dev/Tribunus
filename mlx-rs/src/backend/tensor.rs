use super::dtype::DType;
use super::error::{MlxError, MlxResult};

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum TensorLayout {
    Dense,
    Strided { strides: Vec<usize> },
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum DevicePreference {
    Default,
    Cpu,
    Gpu,
    GpuPreferred,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum TensorRole {
    Input,
    Output,
    Weight,
    Bias,
    Activation,
    Constant,
    KvKey,
    KvValue,
    KvView,
    Scratch,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub struct TensorSpec {
    pub name: Option<String>,
    pub dtype: DType,
    pub shape: Vec<usize>,
    pub layout: TensorLayout,
    pub device: DevicePreference,
    pub role: TensorRole,
}

impl TensorSpec {
    pub fn dense(dtype: DType, shape: Vec<usize>, device: DevicePreference) -> Self {
        Self {
            name: None,
            dtype,
            shape,
            layout: TensorLayout::Dense,
            device,
            role: TensorRole::Unknown,
        }
    }

    pub fn validate(&self) -> MlxResult<()> {
        if self.shape.is_empty() {
            // we will allow scalar shapes as empty vector for now or require [1], let's allow empty for scalar.
            // but the spec mentioned "unless scalar tensors are explicitly supported, all dimensions are greater than zero".
            // Let's explicitly support empty shape for scalar tensors.
        }
        for dim in &self.shape {
            if *dim == 0 {
                return Err(MlxError::InvalidTensorSpec);
            }
        }
        Ok(())
    }
}
