use crate::model::lane::ExecutionVariant;

/// Manifest defining the selected variants for decoding.
pub struct DecodeVariantManifest {
    pub variants: Vec<ExecutionVariant>,
}

impl DecodeVariantManifest {
    pub fn new(variants: Vec<ExecutionVariant>) -> Self {
        Self { variants }
    }
}
