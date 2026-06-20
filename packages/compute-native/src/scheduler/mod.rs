// Single-chip serving scheduler architecture and interface definitions

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

// --- Interfaces for Dependencies ---

/// Capability probe for the device.
pub trait CapabilityProbe {
    fn device_id(&self) -> String;
    fn total_dram_bytes(&self) -> usize;
    fn total_l1_bytes(&self) -> usize;
    fn max_kv_pages(&self) -> usize;
    fn health_state(&self) -> DeviceHealthState;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DeviceHealthState {
    Healthy,
    Degraded,
    Offline,
}

/// Memory planner for allocating space.
pub trait MemoryPlanner {
    fn allocate_kv_pages(
        &self,
        request_id: &str,
        num_pages: usize,
    ) -> Result<(), MemoryAllocationError>;
    fn free_kv_pages(&self, request_id: &str);
    fn available_dram(&self) -> usize;
    fn available_l1(&self) -> usize;
    fn available_kv_pages(&self) -> usize;
}

#[derive(Debug)]
pub enum MemoryAllocationError {
    InsufficientMemory,
}

/// Execution lifecycle management.
pub trait ExecutionLifecycle {
    fn dispatch_prefill(&self, batch: &Batch) -> Result<ExecutionReceipt, ExecutionError>;
    fn dispatch_decode(&self, batch: &Batch) -> Result<ExecutionReceipt, ExecutionError>;
    fn cancel_request(&self, request_id: &str);
}

#[derive(Debug)]
pub enum ExecutionError {
    DeviceBusy,
    CompilationRequired,
}

#[derive(Debug)]
pub struct ExecutionReceipt {
    pub latency_us: u64,
    pub tokens_generated: usize,
}

/// Evidence store for tracking metrics and receipts.
pub trait EvidenceStore {
    fn record_admission(&self, request: &AdmittedRequest);
    fn record_execution(&self, receipt: &ExecutionReceipt);
    fn record_cancellation(&self, request_id: &str);
}

// --- Scheduler Types ---

/// Model residency tracker for artifacts loaded on the chip.
#[derive(Debug, Clone)]
pub struct ModelResidency {
    pub artifact_id: String,
    pub active_requests: usize,
    pub dram_footprint_bytes: usize,
}

/// Latency policy/class for a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LatencyClass {
    Interactive,
    Batch,
}

/// A request admitted to the scheduler.
#[derive(Debug, Clone)]
pub struct AdmittedRequest {
    pub id: String,
    pub artifact_id: String,
    pub latency_class: LatencyClass,
    pub sequence_length: usize,
    pub prefill_complete: bool,
}

/// Represents a batch of requests for execution.
#[derive(Debug, Clone)]
pub struct Batch {
    pub requests: Vec<AdmittedRequest>,
    pub is_prefill: bool,
}

/// The Single-Chip Scheduler contract.
pub struct SingleChipScheduler<C, M, E, S>
where
    C: CapabilityProbe,
    M: MemoryPlanner,
    E: ExecutionLifecycle,
    S: EvidenceStore,
{
    capability: Arc<C>,
    memory: Arc<M>,
    executor: Arc<E>,
    evidence: Arc<S>,

    admitted_portfolio: HashMap<String, ModelResidency>,
    prefill_queue: VecDeque<AdmittedRequest>,
    decode_queue: VecDeque<AdmittedRequest>,
}

impl<C, M, E, S> SingleChipScheduler<C, M, E, S>
where
    C: CapabilityProbe,
    M: MemoryPlanner,
    E: ExecutionLifecycle,
    S: EvidenceStore,
{
    pub fn new(capability: Arc<C>, memory: Arc<M>, executor: Arc<E>, evidence: Arc<S>) -> Self {
        Self {
            capability,
            memory,
            executor,
            evidence,
            admitted_portfolio: HashMap::new(),
            prefill_queue: VecDeque::new(),
            decode_queue: VecDeque::new(),
        }
    }

    /// Admits a new request if there is sufficient capacity and backpressure permits.
    pub fn admit_request(&mut self, request: AdmittedRequest) -> Result<(), AdmissionError> {
        if self.capability.health_state() != DeviceHealthState::Healthy {
            return Err(AdmissionError::DeviceUnhealthy);
        }

        if !self.admitted_portfolio.contains_key(&request.artifact_id) {
            return Err(AdmissionError::ArtifactNotResident);
        }

        // Check basic memory budget (simplified for interface)
        if self.memory.available_kv_pages() < request.sequence_length {
            return Err(AdmissionError::Backpressure(
                BackpressureReason::InsufficientKVPages,
            ));
        }

        self.evidence.record_admission(&request);

        if request.prefill_complete {
            self.decode_queue.push_back(request);
        } else {
            self.prefill_queue.push_back(request);
        }

        Ok(())
    }

    /// Cancels a request, freeing associated resources.
    pub fn cancel_request(&mut self, request_id: &str) {
        self.memory.free_kv_pages(request_id);
        self.executor.cancel_request(request_id);
        self.evidence.record_cancellation(request_id);

        // Remove from queues
        self.prefill_queue.retain(|r| r.id != request_id);
        self.decode_queue.retain(|r| r.id != request_id);
    }

    /// Forms a batch from the current queues based on latency policy and available resources.
    pub fn form_batch(&mut self) -> Option<Batch> {
        // Simple heuristic: prioritize decode over prefill to finish existing requests
        // Interactive requests could be prioritized over Batch latency class here.

        if !self.decode_queue.is_empty() {
            let mut requests = Vec::new();
            // Consume up to a certain batch size, checking memory limits for each
            while let Some(req) = self.decode_queue.pop_front() {
                requests.push(req);
                // Break if batch limits reached
            }
            if !requests.is_empty() {
                return Some(Batch {
                    requests,
                    is_prefill: false,
                });
            }
        }

        if !self.prefill_queue.is_empty() {
            let mut requests = Vec::new();
            while let Some(req) = self.prefill_queue.pop_front() {
                requests.push(req);
            }
            if !requests.is_empty() {
                return Some(Batch {
                    requests,
                    is_prefill: true,
                });
            }
        }

        None
    }
}

#[derive(Debug)]
pub enum AdmissionError {
    DeviceUnhealthy,
    ArtifactNotResident,
    Backpressure(BackpressureReason),
}

#[derive(Debug)]
pub enum BackpressureReason {
    InsufficientKVPages,
    QueueFull,
}
