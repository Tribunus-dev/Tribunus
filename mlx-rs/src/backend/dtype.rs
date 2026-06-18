#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "evidence", derive(serde::Serialize, serde::Deserialize))]
pub enum DType {
    Bool,
    U8,
    I32,
    I64,
    F16,
    BF16,
    F32,
    F64,
}

impl TryFrom<crate::Dtype> for DType {
    type Error = crate::backend::error::MlxError;

    fn try_from(dtype: crate::Dtype) -> Result<Self, Self::Error> {
        match dtype {
            crate::Dtype::Bool => Ok(DType::Bool),
            crate::Dtype::Uint8 => Ok(DType::U8),
            crate::Dtype::Int32 => Ok(DType::I32),
            crate::Dtype::Int64 => Ok(DType::I64),
            crate::Dtype::Float16 => Ok(DType::F16),
            crate::Dtype::Bfloat16 => Ok(DType::BF16),
            crate::Dtype::Float32 => Ok(DType::F32),
            crate::Dtype::Float64 => Ok(DType::F64),
            _ => Err(crate::backend::error::MlxError::UnsupportedDType),
        }
    }
}

impl From<DType> for crate::Dtype {
    fn from(dtype: DType) -> Self {
        match dtype {
            DType::Bool => crate::Dtype::Bool,
            DType::U8 => crate::Dtype::Uint8,
            DType::I32 => crate::Dtype::Int32,
            DType::I64 => crate::Dtype::Int64,
            DType::F16 => crate::Dtype::Float16,
            DType::BF16 => crate::Dtype::Bfloat16,
            DType::F32 => crate::Dtype::Float32,
            DType::F64 => crate::Dtype::Float64,
        }
    }
}
