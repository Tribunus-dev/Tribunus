#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecuteOn {
    Default,
    CpuFallback,
    Tensix,
}
