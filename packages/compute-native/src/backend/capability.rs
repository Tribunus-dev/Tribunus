use std::sync::OnceLock;
use crate::decode_attribution::backend_adapters::BackendKind;

#[derive(Debug, Clone)]
pub struct BackendIdentity {
    pub kind: BackendKind,
    pub vendor: String,
    pub architecture: String,
    pub driver_version: String,
}

#[derive(Debug, Clone)]
pub struct MemoryModel {
    pub unified_memory: bool,
    pub max_allocation_bytes: u64,
    pub alignment_requirements: u32,
}

#[derive(Debug, Clone)]
pub struct DtypeSupport {
    pub supported_dtypes: Vec<crate::backend::DType>,
}

#[derive(Debug, Clone)]
pub struct OpVariant {
    pub input_dtypes: Vec<crate::backend::DType>,
    pub supported_ranks: Vec<usize>,
    pub alignment: u32,
    pub max_shared_memory: u64,
    pub roofline_flops: f64,
}

#[derive(Debug, Clone)]
pub struct OperationCapability {
    pub name: &'static str,
    pub variants: Vec<OpVariant>,
}

#[derive(Debug, Clone)]
pub struct AliasingContract {
    pub supports_inplace: bool,
    pub supports_views: bool,
}

#[derive(Debug, Clone)]
pub struct ShapeContract {
    pub supports_dynamic_shapes: bool,
}

#[derive(Debug, Clone)]
pub struct NumericalContract {
    pub deterministic: bool,
}

#[derive(Debug, Clone)]
pub struct AsyncContract {
    pub supports_async_execution: bool,
    pub max_streams: u32,
}

#[derive(Debug, Clone)]
pub struct GraphContract {
    pub supports_fusion: bool,
}

#[derive(Debug)]
pub struct BackendCapabilityData {
    pub identity: BackendIdentity,
    pub memory_model: MemoryModel,
    pub dtype_support: DtypeSupport,
    pub operation_catalog: Vec<OperationCapability>,
    pub aliasing_contract: AliasingContract,
    pub shape_contract: ShapeContract,
    pub numerical_contract: NumericalContract,
    pub async_contract: AsyncContract,
    pub graph_contract: GraphContract,
}

#[derive(Debug)]
pub struct BackendCapability {
    data: OnceLock<BackendCapabilityData>,
}

impl BackendCapability {
    pub fn new() -> Self {
        Self {
            data: OnceLock::new(),
        }
    }

    pub fn init(
        &self,
        identity: BackendIdentity,
        memory_model: MemoryModel,
        dtype_support: DtypeSupport,
        operation_catalog: Vec<OperationCapability>,
        aliasing_contract: AliasingContract,
        shape_contract: ShapeContract,
        numerical_contract: NumericalContract,
        async_contract: AsyncContract,
        graph_contract: GraphContract,
    ) {
        let _ = self.data.set(BackendCapabilityData {
            identity,
            memory_model,
            dtype_support,
            operation_catalog,
            aliasing_contract,
            shape_contract,
            numerical_contract,
            async_contract,
            graph_contract,
        });
    }

    pub fn get(&self) -> Option<&BackendCapabilityData> {
        self.data.get()
    }
}
