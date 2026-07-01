#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecuteOn {
    Default,
    CpuFallback,
    Tensix,
}
