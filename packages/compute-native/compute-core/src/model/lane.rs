use crate::model::execution::ExecuteOn;

pub struct MlxDecode;

impl MlxDecode {
    pub fn execution_target() -> ExecuteOn {
        ExecuteOn::Default
    }
}

pub struct TensixDecode1;

impl TensixDecode1 {
    pub fn execution_target() -> ExecuteOn {
        ExecuteOn::Tensix
    }
}
