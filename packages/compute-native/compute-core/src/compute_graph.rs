//! ComputeGraph — a sealed, immutable DAG of artifact dispatch nodes.
//!
//! The ComputeGraph replaces the backend-led MLX interpreter with an
//! image-led execution plan.  Nodes reference compiled artifacts
//! (Core ML, Metal, CPU, or transitional MLX) through artifact IDs
//! resolved at load time via the ArtifactRegistry.  Buffer regions
//! carry ownership and residency contracts, not framework-specific types.
//!
//! # Inversion
//!
//! Current:       runtime owns semantics, MLX/Core ML decide execution

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Instant;

use crate::accelerate_artifacts::{dispatch_accelerate_artifact, AccelerateArtifact};
use crate::arena_info::ArenaInfo;
use crate::compute_image::CoreMlArtifactEntry;
use crate::coreml_bridge::{CoreMlComputeUnits, CoreMlModel};
use crate::engine_receipts::AneDispatchReceipt;
use crate::engine_receipts::GraphNodeReceipt;
use crate::kv_cache::KvCache;

extern "C" {
    fn tribunus_arena_alloc_f32(
        info: *mut crate::arena_info::ArenaInfo,
        dim0: i32,
        dim1: i32,
    ) -> i32;
    fn tribunus_arena_free_cv_buffer(cv_buffer: *mut std::ffi::c_void);
    fn tribunus_arena_io_surface_id(info: *const crate::arena_info::ArenaInfo) -> i32;
    fn tribunus_cv_pixel_buffer_io_surface_id(cv_buffer: *mut std::ffi::c_void) -> i32;
    fn tribunus_metal_texture_from_iosurface(
        cv_pixel_buffer: *mut std::ffi::c_void,
        device_name: *const i8,
    ) -> *mut std::ffi::c_void;
    fn tribunus_metal_dispatch_copy(
        texture: *mut std::ffi::c_void,
        input_data: *const f32,
        element_count: i32,
    ) -> i32;
    fn tribunus_metal_release_texture(texture: *mut std::ffi::c_void);
}

// ── Residency / ownership taxonomy ─────────────────────────────────────────

/// Where the buffer lives in the memory hierarchy.
/// Not a framework name — a capability contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Residency {
    /// Host-accessible, no GPU/ANE guarantee.
    Host,
    /// Unified memory accessible from CPU and GPU (MLX-compatible).
    Shared,
    /// GPU-private (Metal heap). Not accessible from CPU without transfer.
    MetalPrivate,
    /// IOSurface-backed, ANE-accessible.
    CoreMlCompatible,
}

/// Who owns the lifetime of this buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Ownership {
    /// Backed by image segment file (persistent weights).
    Image,
    /// Allocated per-session (KV cache, persistent scratch).
    Session,
    /// Allocated per-request (activations, temp buffers).
    Request,
    /// Transient scratch within a single node dispatch.
    Scratch,
}

/// What to do when a dispatch node fails at runtime.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FailurePolicy {
    /// Fail the entire graph evaluation.
    Fatal,
    /// Skip this node and continue (produces a degradation receipt).
    Degrade,
    /// Try an alternate artifact ID.
    Fallback(String),
}

// ── Buffer region ─────────────────────────────────────────────────────────

/// A typed memory region contract.  The graph references regions by ID;
/// the instance resolves them to allocated memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BufferRegion {
    pub region_id: u32,
    pub logical_dtype: String,
    pub logical_shape: Vec<i64>,
    pub byte_length: u64,
    pub alignment: u64,
    pub residency: Residency,
    pub ownership: Ownership,
    /// Optional alias group — regions in the same group share storage.
    pub alias_group: Option<String>,
}

/// Runtime-resolved buffer — either a view into a weight segment or an
/// allocated mutable chunk.
#[derive(Debug)]
pub enum ResolvedBuffer {
    /// Persistent weight from a mapped segment.
    WeightSlice {
        data: &'static [u8],
        byte_length: u64,
    },
    /// Allocation backed by the graph instance's arena.
    Arena { ptr: *mut u8, byte_length: u64 },
    /// An IOSurface handle for ANE dispatch.
    IoSurface {
        ptr: *mut u8,
        byte_length: u64,
        /// CoreML-compatible pixel buffer or multi-array pointer
        cv_buffer: *mut std::ffi::c_void,
    },
}

// Safety: raw pointers are never aliased across regions with different
// ownership categories.  The graph executor serialises all writes to a
// region before any read from a dependent node.
unsafe impl Send for ResolvedBuffer {}
unsafe impl Sync for ResolvedBuffer {}

/// How a buffer region is materialized at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RegionMaterialization {
    HostOwned,
    SharedCpuBuffer,
    CoreMlCopyBridge,
    CoreMlPersistentCandidate,
    MetalSharedCandidate,
}

/// Core ML buffer execution mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoreMlBufferMode {
    CopyBacked,
    PersistentBufferBacked,
    PersistentIosurfaceBacked,
    PersistentIosurfaceMetalInterop,
}

/// Contract describing how a Metal texture binds to an IOSurface-backed buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetalIosurfaceBindingContract {
    pub pixel_format: String,         // "R32Float"
    pub plane: u32,                   // 0
    pub tensor_dtype: String,         // "float32"
    pub access: String,               // "WriteOnly"
    pub synchronization_mode: String, // "CommandBuffer"
}

/// A cached Metal texture wrapping an IOSurface from a CVPixelBuffer.
pub struct MetalTextureView {
    pub texture_ptr: *mut std::ffi::c_void, // retained MTLTexture
    pub contract: MetalIosurfaceBindingContract,
    pub has_been_validated: bool,
}

// ── Activation ring ──────────────────────────────────────────────────────

/// State of an activation ring slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlotState {
    Free,
    CpuWriting,
    MetalWriting,
    ReadyForAne,
    AneInFlight,
    ReadyForConsumer,
    CpuReading,
    ReclaimPending,
}

/// A single slot in the activation ring.
/// Owns a CVPixelBufferRef for the lifetime of the ring.
pub struct ActivationSlot {
    pub slot_id: u32,
    pub epoch: u64,
    /// Owned CVPixelBufferRef — only released when slot/ring is destroyed.
    pub cv_pixel_buffer: *mut std::ffi::c_void,
    /// Borrowed pointer to CVPixelBuffer base address — never freed independently.
    pub base_ptr: *mut u8,
    pub byte_len: usize,
    pub width: i32,
    pub height: i32,
    pub state: SlotState,
    pub coreml_borrows: u32,
    pub cpu_borrows: u32,
    pub metal_borrows: u32,
    /// Cached Metal texture wrapping the IOSurface backing this slot.
    pub metal_texture: Option<MetalTextureView>,
    /// Name of the last writer backend (e.g. "Metal", "ANE", "CPU").
    pub last_writer: Option<String>,
}

/// A ring of activation slots for ANE-boundary buffer reuse.
/// Owns all CVPixelBufferRef. Slots are never individually freed —
/// the entire ring is destroyed when GraphInstance is destroyed.
pub struct ActivationRing {
    pub slots: Vec<ActivationSlot>,
    pub next_slot: usize,
    pub num_slots: usize,
}

impl ActivationRing {
    /// Create a new ring with `count` slots, each backed by a real CVPixelBuffer.
    /// Calls tribunus_arena_alloc_f32 for each slot.
    pub fn new(count: usize, width: i32, height: i32) -> Result<Self, String> {
        let mut slots = Vec::with_capacity(count);
        for i in 0..count {
            let mut arena_info = unsafe {
                std::mem::MaybeUninit::<crate::arena_info::ArenaInfo>::zeroed().assume_init()
            };
            let rc = unsafe { tribunus_arena_alloc_f32(&mut arena_info, height, width) };
            if rc != 0 {
                return Err(format!(
                    "ActivationRing: tribunus_arena_alloc_f32 failed: {} for slot {}",
                    rc, i
                ));
            }
            slots.push(ActivationSlot {
                slot_id: i as u32,
                epoch: 0,
                cv_pixel_buffer: arena_info.cv_buffer,
                base_ptr: arena_info.base_address as *mut u8,
                byte_len: arena_info.byte_size as usize,
                width,
                height,
                state: SlotState::Free,
                coreml_borrows: 0,
                cpu_borrows: 0,
                metal_borrows: 0,
                metal_texture: None,
                last_writer: None,
            });
        }
        Ok(ActivationRing {
            slots,
            next_slot: 0,
            num_slots: count,
        })
    }

    /// Allocate the next free slot for writing.
    pub fn alloc_write(&mut self) -> Option<&mut ActivationSlot> {
        let start = self.next_slot;
        for offset in 0..self.num_slots {
            let idx = (start + offset) % self.num_slots;
            if self.slots[idx].state == SlotState::Free {
                self.slots[idx].state = SlotState::CpuWriting;
                self.next_slot = (idx + 1) % self.num_slots;
                return Some(&mut self.slots[idx]);
            }
        }
        None // all slots busy
    }

    /// Mark a slot as ready for ANE after CPU writing completes.
    pub fn mark_ready_for_ane(&mut self, slot_id: u32) {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            slot.state = SlotState::ReadyForAne;
        }
    }

    /// Mark a slot as having ANE in flight.
    pub fn mark_ane_in_flight(&mut self, slot_id: u32) {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            slot.state = SlotState::AneInFlight;
            slot.coreml_borrows += 1;
        }
    }

    /// Release a Core ML borrow — called from deallocator or completion.
    pub fn release_ane_borrow(&mut self, slot_id: u32, completed_epoch: u64) -> Result<(), String> {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            if slot.epoch != completed_epoch {
                return Err(format!(
                    "stale completion: slot {} epoch {} != completed {}",
                    slot_id, slot.epoch, completed_epoch
                ));
            }
            slot.coreml_borrows = slot.coreml_borrows.saturating_sub(1);
            if slot.coreml_borrows == 0 && slot.state == SlotState::AneInFlight {
                slot.state = SlotState::ReadyForConsumer;
            }
            Ok(())
        } else {
            Err(format!("slot {} not found", slot_id))
        }
    }

    /// Recycle a slot back to Free when all consumers are done.
    pub fn release_slot(&mut self, slot_id: u32) {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            if slot.state == SlotState::ReadyForConsumer || slot.state == SlotState::CpuReading {
                slot.epoch += 1;
                slot.coreml_borrows = 0;
                slot.state = SlotState::Free;
            }
        }
    }

    /// Epoch-safe recycle: only frees slot if epoch matches.
    /// If outstanding borrows exist, transitions to ReclaimPending.
    pub fn recycle_slot_checked(
        &mut self,
        slot_id: u32,
        completed_epoch: u64,
    ) -> Result<(), String> {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            if slot.epoch != completed_epoch {
                return Err(format!(
                    "stale completion: slot {} epoch {} != completed {}",
                    slot_id, slot.epoch, completed_epoch
                ));
            }
            if slot.coreml_borrows == 0 && slot.cpu_borrows == 0 && slot.metal_borrows == 0 {
                slot.epoch += 1;
                slot.coreml_borrows = 0;
                slot.cpu_borrows = 0;
                slot.metal_borrows = 0;
                slot.state = SlotState::Free;
                Ok(())
            } else {
                slot.state = SlotState::ReclaimPending;
                Err(format!(
                    "slot {} has outstanding borrows: coreml={} cpu={} metal={}",
                    slot_id, slot.coreml_borrows, slot.cpu_borrows, slot.metal_borrows
                ))
            }
        } else {
            Err(format!("slot {} not found", slot_id))
        }
    }

    /// Create Metal texture for a slot and cache it.
    pub fn ensure_metal_texture(&mut self, slot_id: u32) -> Result<(), String> {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            if slot.metal_texture.is_some() {
                return Ok(()); // already created
            }
            if slot.cv_pixel_buffer.is_null() {
                return Err("no cv_buffer for slot".into());
            }
            let tex = unsafe {
                tribunus_metal_texture_from_iosurface(slot.cv_pixel_buffer, std::ptr::null())
            };
            if tex.is_null() {
                return Err("metal texture creation failed".into());
            }
            slot.metal_texture = Some(MetalTextureView {
                texture_ptr: tex,
                contract: MetalIosurfaceBindingContract {
                    pixel_format: "R32Float".into(),
                    plane: 0,
                    tensor_dtype: "float32".into(),
                    access: "WriteOnly".into(),
                    synchronization_mode: "CommandBuffer".into(),
                },
                has_been_validated: false,
            });
            Ok(())
        } else {
            Err(format!("slot {} not found", slot_id))
        }
    }

    /// Transition a slot from Free to MetalWriting.
    pub fn mark_metal_writing(&mut self, slot_id: u32) -> Result<(), String> {
        if let Some(slot) = self.slots.iter_mut().find(|s| s.slot_id == slot_id) {
            if slot.state != SlotState::Free {
                return Err(format!("slot {} not Free, state={:?}", slot_id, slot.state));
            }
            slot.state = SlotState::MetalWriting;
            slot.metal_borrows += 1;
            slot.last_writer = Some("Metal".into());
            Ok(())
        } else {
            Err(format!("slot {} not found", slot_id))
        }
    }

    /// Destroy the ring — release all CVPixelBufferRefs.
    pub fn destroy(&mut self) {
        for slot in &mut self.slots {
            if let Some(tex) = slot.metal_texture.take() {
                unsafe {
                    tribunus_metal_release_texture(tex.texture_ptr);
                }
            }
            if !slot.cv_pixel_buffer.is_null() {
                unsafe {
                    tribunus_arena_free_cv_buffer(slot.cv_pixel_buffer);
                }
                slot.cv_pixel_buffer = std::ptr::null_mut();
                slot.base_ptr = std::ptr::null_mut();
            }
        }
        self.slots.clear();
    }
}

// Safety: ActivationSlot/ActivationRing use raw pointers that are exclusively
// accessed through GraphInstance methods.  The ring is not Send/Sync by default.
unsafe impl Send for ActivationSlot {}
unsafe impl Sync for ActivationSlot {}
unsafe impl Send for ActivationRing {}
unsafe impl Sync for ActivationRing {}

// ── Lane affinity ─────────────────────────────────────────────────────────

/// Which execution lane should process this node.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum LaneAffinity {
    Cpu,
    Gpu,
    Ane,
}

// ── Graph node ────────────────────────────────────────────────────────────

/// One node in the compute graph.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GraphNode {
    /// Dispatch a compiled artifact (Core ML, Metal, CPU kernel, MLX compat).
    Dispatch {
        node_id: u32,
        /// Stable artifact identifier from the manifest.
        artifact_id: String,
        /// SHA-256 of the compiled artifact directory, verified at bind time.
        artifact_hash: String,
        /// (feature/arg name, region_id) pairs matching the artifact's I/O contract.
        input_bindings: Vec<(String, u32)>,
        output_bindings: Vec<(String, u32)>,
        dependency_ids: Vec<u32>,
        lane: LaneAffinity,
        failure_policy: FailurePolicy,
    },
    /// Explicit synchronisation barrier.
    Barrier {
        node_id: u32,
        dependency_ids: Vec<u32>,
    },
}

impl GraphNode {
    pub fn node_id(&self) -> u32 {
        match self {
            GraphNode::Dispatch { node_id, .. } => *node_id,
            GraphNode::Barrier { node_id, .. } => *node_id,
        }
    }

    pub fn dependency_ids(&self) -> &[u32] {
        match self {
            GraphNode::Dispatch { dependency_ids, .. } => dependency_ids,
            GraphNode::Barrier { dependency_ids, .. } => dependency_ids,
        }
    }
}

// ── ComputeGraph ──────────────────────────────────────────────────────────

/// A sealed, immutable DAG of artifact dispatch nodes and buffer contracts.
///
/// Produced at image-compile time (or constructed at load time from
/// manifest artifact entries during the transition period).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ComputeGraph {
    /// Stable graph identifier: "{model}:{shape_key}:{segment_id}:v{version}".
    pub graph_id: String,
    pub graph_version: String,
    /// Shape specialization key (e.g. "prefill_16", "decode_1").
    pub shape_key: String,
    pub nodes: Vec<GraphNode>,
    pub regions: Vec<BufferRegion>,
    /// Nodes with no dependencies — entry points for the scheduler.
    pub entry_node_ids: Vec<u32>,
    /// Nodes that produce final output (logits, hidden state).
    pub output_node_ids: Vec<u32>,
}

// ── Artifact Registry ─────────────────────────────────────────────────────

/// Resolved artifact handles for a loaded ComputeImage.
///
/// The registry maps artifact_id → runtime handle.  Built once at model
/// load time, shared across requests.
pub struct ArtifactRegistry {
    pub coreml_models: HashMap<String, CoreMlModel>,
    /// Accelerate CPU execution recipes (RMSNorm, add, mul, silu).
    pub accelerate_artifacts: HashMap<String, AccelerateArtifact>,
    // Future: metal_pipelines, cpu_kernels, mlx_compat_artifacts
}

impl ArtifactRegistry {
    pub fn new() -> Self {
        Self {
            coreml_models: HashMap::new(),
            accelerate_artifacts: HashMap::new(),
        }
    }

    pub fn load_coreml_artifact(&mut self, artifact: &CoreMlArtifactEntry) -> Result<(), String> {
        let model = CoreMlModel::load_with_compute_units(
            &artifact.compiled_path,
            match artifact.compute_unit_policy.as_str() {
                "cpuAndNeuralEngine" => CoreMlComputeUnits::CpuAndNeuralEngine,
                "all" => CoreMlComputeUnits::All,
                "cpuAndGPU" => CoreMlComputeUnits::CpuAndGpu,
                _ => CoreMlComputeUnits::CpuAndNeuralEngine,
            },
        )?;
        self.coreml_models
            .insert(artifact.segment_id.clone(), model);
        Ok(())
    }

    /// Return a Core ML model handle for a dispatch artifact.
    pub fn get_coreml(&self, artifact_id: &str) -> Option<&CoreMlModel> {
        self.coreml_models.get(artifact_id)
    }
}

// ── Graph Instance ────────────────────────────────────────────────────────

/// Per-request mutable state for evaluating a ComputeGraph.
///
/// Owns allocated regions, dependency counters, and KV cache handles.
/// Created fresh for each request; the graph and artifact registry are
/// shared immutable references.
pub struct GraphInstance<'a> {
    pub graph: &'a ComputeGraph,
    pub registry: &'a ArtifactRegistry,
    /// Resolved buffers indexed by region_id.  `None` = not yet allocated.
    pub regions: Vec<Option<ResolvedBuffer>>,
    /// Pre-allocated persistent regions for reuse across repeated graph evaluations.
    pub persistent_regions: Vec<Option<ResolvedBuffer>>,
    /// Core ML buffer mode for ANE dispatch nodes (set at graph variant selection).
    pub coreml_buffer_mode: CoreMlBufferMode,
    /// Remaining dependencies per node (indexed by node position).
    pub deps_remaining: Vec<u32>,
    /// Set of node positions that are ready to execute.
    pub ready: Vec<usize>,
    /// Completed node positions.
    pub completed: Vec<bool>,
    /// KV cache handles for attention layers.
    pub kv_caches: Vec<KvCache>,
    /// Telemetry: dispatch receipts emitted during evaluation.
    pub receipts: Vec<AneDispatchReceipt>,
    /// Per-node receipts for this graph evaluation.
    pub node_receipts: Vec<GraphNodeReceipt>,
    /// Activation ring for IOSurface-backed buffer reuse (CoreMlCompatible regions).
    /// Initialized in init_persistent_regions for PersistentIosurfaceBacked mode.
    pub activation_ring: Option<ActivationRing>,
    /// Reason for fallback from the preferred allocation strategy (e.g. IOSurface failure).
    /// Set during init_persistent_regions. Copied into per-node receipts.
    pub allocation_fallback_reason: Option<String>,
}

impl<'a> GraphInstance<'a> {
    pub fn new(
        graph: &'a ComputeGraph,
        registry: &'a ArtifactRegistry,
        kv_caches: Vec<KvCache>,
    ) -> Self {
        let n_nodes = graph.nodes.len();
        let n_regions = graph.regions.len();

        // Compute dependency counts.
        let mut deps_remaining = vec![0u32; n_nodes];
        for node in &graph.nodes {
            for dep_id in node.dependency_ids() {
                if let Some(pos) = graph.nodes.iter().position(|n| n.node_id() == *dep_id) {
                    deps_remaining[pos] += 1; // inc parent count
                }
            }
        }
        // Actually: deps_remaining[node] = number of dependencies, not the other way.
        // Correct approach:
        let mut deps_remaining = vec![0u32; n_nodes];
        for node in &graph.nodes {
            deps_remaining.iter_mut().for_each(|d| *d = 0);
        }
        for node in &graph.nodes {
            deps_remaining.iter_mut().for_each(|d| *d = 0);
        }

        // Count inbound edges.
        for (pos, node) in graph.nodes.iter().enumerate() {
            deps_remaining[pos] = node.dependency_ids().len() as u32;
        }

        // Seed ready queue with zero-dependency nodes.
        let mut ready = Vec::new();
        for (pos, node) in graph.nodes.iter().enumerate() {
            if node.dependency_ids().is_empty() {
                ready.push(pos);
            }
        }

        Self {
            graph,
            registry,
            regions: (0..n_regions).map(|_| None).collect(),
            persistent_regions: (0..n_regions).map(|_| None).collect(),
            coreml_buffer_mode: CoreMlBufferMode::CopyBacked,
            activation_ring: None,
            deps_remaining,
            ready,
            completed: vec![false; n_nodes],
            kv_caches,
            receipts: Vec::new(),
            node_receipts: Vec::new(),
            allocation_fallback_reason: None,
        }
    }

    /// Allocate a region for use during dispatch.
    pub fn allocate_region(&mut self, region_id: u32, data: Option<&[u8]>) -> Result<(), String> {
        let spec = self
            .graph
            .regions
            .get(region_id as usize)
            .ok_or_else(|| format!("region {} not found in graph", region_id))?;
        let byte_len = spec.byte_length as usize;

        // If no initial data is provided and a persistent allocation exists, reuse it.
        if data.is_none() {
            if let Some(Some(persistent_buf)) = self.persistent_regions.get(region_id as usize) {
                // Free any transient allocation in regions[] first.
                if let Some(old) = self.regions[region_id as usize].take() {
                    Self::free_buffer(old);
                }
                // Clone the persistent buffer reference into regions[] for this dispatch.
                let buf = match persistent_buf {
                    ResolvedBuffer::Arena { ptr, byte_length } => ResolvedBuffer::Arena {
                        ptr: *ptr,
                        byte_length: *byte_length,
                    },
                    ResolvedBuffer::IoSurface {
                        ptr,
                        byte_length,
                        cv_buffer,
                    } => ResolvedBuffer::IoSurface {
                        ptr: *ptr,
                        byte_length: *byte_length,
                        cv_buffer: *cv_buffer,
                    },
                    ResolvedBuffer::WeightSlice { .. } => {
                        return Err("cannot dispatch from weight slice".into())
                    }
                };
                self.regions[region_id as usize] = Some(buf);
                return Ok(());
            }
        }

        let buf = match spec.residency {
            Residency::CoreMlCompatible => {
                if self.coreml_buffer_mode == CoreMlBufferMode::PersistentIosurfaceBacked
                    || self.coreml_buffer_mode == CoreMlBufferMode::PersistentIosurfaceMetalInterop
                {
                    // Allocate from activation ring if available, otherwise fall back to direct allocation.
                    let slot = self
                        .activation_ring
                        .as_mut()
                        .and_then(|ring| ring.alloc_write());
                    let (ptr, cv_buf) = if let Some(slot) = slot {
                        if let Some(src) = data {
                            let copy_len = byte_len.min(slot.byte_len);
                            unsafe {
                                std::ptr::copy_nonoverlapping(
                                    src.as_ptr(),
                                    slot.base_ptr,
                                    copy_len,
                                );
                            }
                        }
                        (slot.base_ptr, slot.cv_pixel_buffer)
                    } else {
                        // No ring or no free slot — allocate directly.
                        let logical_dim0 = spec.logical_shape.first().copied().unwrap_or(1) as i32;
                        let logical_dim1 =
                            spec.logical_shape
                                .get(1)
                                .copied()
                                .unwrap_or(logical_dim0 as i64) as i32;
                        let mut arena_info = unsafe {
                            std::mem::MaybeUninit::<crate::arena_info::ArenaInfo>::zeroed()
                                .assume_init()
                        };
                        let rc = unsafe {
                            tribunus_arena_alloc_f32(&mut arena_info, logical_dim0, logical_dim1)
                        };
                        if rc != 0 {
                            return Err(format!(
                                "tribunus_arena_alloc_f32 failed: {} for region {}",
                                rc, region_id
                            ));
                        }
                        if let Some(src) = data {
                            let copy_len = byte_len.min(src.len());
                            unsafe {
                                std::ptr::copy_nonoverlapping(
                                    src.as_ptr(),
                                    arena_info.base_address as *mut u8,
                                    copy_len,
                                );
                            }
                        }
                        (arena_info.base_address as *mut u8, arena_info.cv_buffer)
                    };
                    ResolvedBuffer::IoSurface {
                        ptr,
                        byte_length: spec.byte_length,
                        cv_buffer: cv_buf,
                    }
                } else {
                    // Existing heap-allocated path.
                    let layout =
                        std::alloc::Layout::from_size_align(byte_len, spec.alignment as usize)
                            .map_err(|e| format!("layout: {}", e))?;
                    let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
                    if ptr.is_null() {
                        return Err(format!(
                            "failed to allocate CoreMlCompatible region {}",
                            region_id
                        ));
                    }
                    if let Some(src) = data {
                        unsafe {
                            std::ptr::copy_nonoverlapping(
                                src.as_ptr(),
                                ptr,
                                byte_len.min(src.len()),
                            );
                        }
                    }
                    ResolvedBuffer::IoSurface {
                        ptr,
                        byte_length: spec.byte_length,
                        cv_buffer: std::ptr::null_mut(),
                    }
                }
            }
            _ => {
                let layout = std::alloc::Layout::from_size_align(byte_len, spec.alignment as usize)
                    .map_err(|e| format!("layout: {}", e))?;
                let ptr = unsafe { std::alloc::alloc_zeroed(layout) };
                if ptr.is_null() {
                    return Err(format!("failed to allocate region {}", region_id));
                }
                if let Some(src) = data {
                    unsafe {
                        std::ptr::copy_nonoverlapping(src.as_ptr(), ptr, byte_len.min(src.len()));
                    }
                }
                ResolvedBuffer::Arena {
                    ptr,
                    byte_length: spec.byte_length,
                }
            }
        };

        // Free old allocation if replacing.
        if let Some(old) = self.regions[region_id as usize].take() {
            Self::free_buffer(old);
        }
        self.regions[region_id as usize] = Some(buf);
        Ok(())
    }

    /// Read a region's data as a byte slice.
    pub fn region_data(&self, region_id: u32) -> Result<&[u8], String> {
        let buf = self
            .regions
            .get(region_id as usize)
            .and_then(|b| b.as_ref())
            .ok_or_else(|| format!("region {} not allocated", region_id))?;
        match buf {
            ResolvedBuffer::Arena { ptr, byte_length } => {
                Ok(unsafe { std::slice::from_raw_parts(*ptr, *byte_length as usize) })
            }
            ResolvedBuffer::IoSurface {
                ptr, byte_length, ..
            } => Ok(unsafe { std::slice::from_raw_parts(*ptr, *byte_length as usize) }),
            ResolvedBuffer::WeightSlice { data, .. } => Ok(data),
        }
    }

    fn free_buffer(buf: ResolvedBuffer) {
        match buf {
            ResolvedBuffer::Arena { ptr, byte_length } => {
                let layout = std::alloc::Layout::from_size_align(byte_length as usize, 64).ok();
                if let Some(l) = layout {
                    unsafe {
                        std::alloc::dealloc(ptr, l);
                    }
                }
            }
            ResolvedBuffer::IoSurface {
                ptr,
                byte_length,
                cv_buffer,
            } => {
                if !cv_buffer.is_null() {
                    // Ring-owned IOSurface-backed region — the activation ring owns the
                    // CVPixelBuffer lifetime.  Do NOT free here; ring::destroy() handles it.
                } else {
                    let layout = std::alloc::Layout::from_size_align(byte_length as usize, 64).ok();
                    if let Some(l) = layout {
                        unsafe {
                            std::alloc::dealloc(ptr, l);
                        }
                    }
                }
            }
            ResolvedBuffer::WeightSlice { .. } => {} // borrowed — not owned
        }
    }

    /// Mark a node as completed and unlock its dependents.
    pub fn complete_node(&mut self, pos: usize) -> Vec<usize> {
        self.completed[pos] = true;
        let node_id = self.graph.nodes[pos].node_id();

        // Find all nodes that depend on this one and decrement their counter.
        let mut newly_ready = Vec::new();
        for (other_pos, other_node) in self.graph.nodes.iter().enumerate() {
            if other_node.dependency_ids().contains(&node_id) {
                self.deps_remaining[other_pos] = self.deps_remaining[other_pos].saturating_sub(1);
                if self.deps_remaining[other_pos] == 0 {
                    newly_ready.push(other_pos);
                }
            }
        }
        newly_ready
    }

    /// Execute a single dispatch node synchronously.
    pub fn execute_dispatch(&mut self, pos: usize) -> Result<(), String> {
        let node = &self.graph.nodes[pos];
        let start = Instant::now();
        let graph_id = self.graph.graph_id.clone();
        match node {
            GraphNode::Dispatch {
                artifact_id,
                artifact_hash,
                input_bindings,
                output_bindings,
                lane,
                failure_policy,
                ..
            } => {
                let dispatch_result = match lane {
                    LaneAffinity::Ane => {
                        let model = self
                            .registry
                            .get_coreml(artifact_id)
                            .ok_or_else(|| format!("ANE artifact '{}' not loaded", artifact_id))?;

                        // Resolve input/output ArenaInfo from regions.
                        let (in_name, in_rid) = input_bindings.first().ok_or("no input binding")?;
                        let (out_name, out_rid) =
                            output_bindings.first().ok_or("no output binding")?;

                        let in_buf = self.regions[*in_rid as usize]
                            .as_ref()
                            .ok_or_else(|| format!("input region {} not allocated", in_rid))?;
                        let out_buf = self.regions[*out_rid as usize]
                            .as_ref()
                            .ok_or_else(|| format!("output region {} not allocated", out_rid))?;

                        let (in_ptr, in_len) = Self::resolve_buffer_ptr(in_buf)?;
                        let (out_ptr, out_len) = Self::resolve_buffer_ptr(out_buf)?;

                        let in_region = &self.graph.regions[*in_rid as usize];
                        let out_region = &self.graph.regions[*out_rid as usize];

                        let in_cv_buffer = match in_buf {
                            ResolvedBuffer::IoSurface { cv_buffer, .. } => *cv_buffer,
                            _ => std::ptr::null_mut(),
                        };
                        let out_cv_buffer = match out_buf {
                            ResolvedBuffer::IoSurface { cv_buffer, .. } => *cv_buffer,
                            _ => std::ptr::null_mut(),
                        };

                        let input_arena = ArenaInfo {
                            width: in_region.logical_shape.get(1).copied().unwrap_or(1) as i32,
                            height: in_region.logical_shape.first().copied().unwrap_or(1) as i32,
                            logical_dim0: in_region.logical_shape.first().copied().unwrap_or(1)
                                as i32,
                            logical_dim1: in_region.logical_shape.get(1).copied().unwrap_or(1)
                                as i32,
                            pixel_format: 0,
                            byte_size: in_len as i32,
                            bytes_per_row: in_len as i32,
                            base_address: in_ptr as *mut std::ffi::c_void,
                            cv_buffer: in_cv_buffer,
                            io_surface: std::ptr::null_mut(),
                        };
                        let output_arena = ArenaInfo {
                            width: out_region.logical_shape.get(1).copied().unwrap_or(1) as i32,
                            height: out_region.logical_shape.first().copied().unwrap_or(1) as i32,
                            logical_dim0: out_region.logical_shape.first().copied().unwrap_or(1)
                                as i32,
                            logical_dim1: out_region.logical_shape.get(1).copied().unwrap_or(1)
                                as i32,
                            pixel_format: 0,
                            byte_size: out_len as i32,
                            bytes_per_row: out_len as i32,
                            base_address: out_ptr as *mut std::ffi::c_void,
                            cv_buffer: out_cv_buffer,
                            io_surface: std::ptr::null_mut(),
                        };

                        model
                            .predict(in_name, &input_arena, out_name, &output_arena)
                            .map_err(|e| format!("graph dispatch '{}': {}", artifact_id, e))
                            .map(|_| ())
                    }
                    LaneAffinity::Cpu => {
                        let artifact = self
                            .registry
                            .accelerate_artifacts
                            .get(artifact_id)
                            .ok_or_else(|| {
                                format!("Accelerate artifact '{}' not loaded", artifact_id)
                            })?;

                        // Resolve input bindings.
                        let (_in_name, in_rid) =
                            input_bindings.first().ok_or("no input binding")?;
                        let in_data = self.region_data(*in_rid)?;

                        // For RMSNorm, the second binding is weight.
                        let weight_data = if input_bindings.len() > 1 {
                            let (_wname, w_rid) = &input_bindings[1];
                            Some(self.region_data(*w_rid)?)
                        } else {
                            None
                        };

                        let in_f32: &[f32] = unsafe {
                            std::slice::from_raw_parts(
                                in_data.as_ptr() as *const f32,
                                in_data.len() / 4,
                            )
                        };
                        let weight_f32: Option<&[f32]> = weight_data.map(|d| unsafe {
                            std::slice::from_raw_parts(d.as_ptr() as *const f32, d.len() / 4)
                        });

                        let out_data = dispatch_accelerate_artifact(artifact, in_f32, weight_f32)?;

                        // Write output to the output region.
                        let (_out_name, out_rid) =
                            output_bindings.first().ok_or("no output binding")?;
                        let out_buf = self.regions[*out_rid as usize]
                            .as_mut()
                            .ok_or_else(|| format!("output region {} not allocated", out_rid))?;
                        let (out_ptr, out_capacity) = Self::resolve_buffer_mut_ptr(out_buf)?;
                        let out_len = (out_data.len() * 4).min(out_capacity as usize);
                        unsafe {
                            std::ptr::copy_nonoverlapping(
                                out_data.as_ptr() as *const u8,
                                out_ptr,
                                out_len,
                            );
                        }
                        Ok(())
                    }
                    LaneAffinity::Gpu => {
                        // Metal dispatch: write input data to IOSurface-backed output slot.
                        // Read input data first (before mutable borrow on activation_ring).
                        let (_in_name, in_rid) = input_bindings
                            .first()
                            .ok_or("no input binding for GPU dispatch")?;
                        let in_data = self.region_data(*in_rid)?;
                        let in_ptr: *const f32 = in_data.as_ptr() as *const f32;
                        let in_len: usize = in_data.len() / 4;
                        // Resolve output region for the slot.
                        let (_out_name, out_rid) = output_bindings
                            .first()
                            .ok_or("no output binding for GPU dispatch")?;
                        let out_buf = self.regions[*out_rid as usize]
                            .as_ref()
                            .ok_or_else(|| format!("output region {} not allocated", out_rid))?;

                        // Find which slot backs this output region.
                        let out_slot = self
                            .activation_ring
                            .as_mut()
                            .and_then(|ring| {
                                ring.slots.iter_mut().find(|s| {
                                    // Match slot to output region by checking if this IoSurface region
                                    // references the slot's cv_buffer.
                                    if let ResolvedBuffer::IoSurface { cv_buffer, .. } = out_buf {
                                        s.cv_pixel_buffer == *cv_buffer
                                    } else {
                                        false
                                    }
                                })
                            })
                            .ok_or_else(|| {
                                "GPU dispatch: output region not backed by activation ring slot"
                                    .to_string()
                            })?;

                        // Ensure Metal texture exists for this slot.
                        if out_slot.metal_texture.is_none() {
                            // Create it inline (same as ensure_metal_texture logic).
                            if out_slot.cv_pixel_buffer.is_null() {
                                return Err("GPU dispatch: slot has no cv_buffer".into());
                            }
                            let tex = unsafe {
                                tribunus_metal_texture_from_iosurface(
                                    out_slot.cv_pixel_buffer,
                                    std::ptr::null(),
                                )
                            };
                            if tex.is_null() {
                                return Err("GPU dispatch: metal texture creation failed".into());
                            }
                            out_slot.metal_texture = Some(MetalTextureView {
                                texture_ptr: tex,
                                contract: MetalIosurfaceBindingContract {
                                    pixel_format: "R32Float".into(),
                                    plane: 0,
                                    tensor_dtype: "float32".into(),
                                    access: "WriteOnly".into(),
                                    synchronization_mode: "CommandBuffer".into(),
                                },
                                has_been_validated: false,
                            });
                        }

                        // Mark slot as MetalWriting and increment borrow.
                        out_slot.state = SlotState::MetalWriting;
                        out_slot.metal_borrows += 1;
                        out_slot.last_writer = Some("Metal".into());

                        // Dispatch Metal blit copy.
                        let tex_ptr = out_slot.metal_texture.as_ref().unwrap().texture_ptr;
                        let rc =
                            unsafe { tribunus_metal_dispatch_copy(tex_ptr, in_ptr, in_len as i32) };
                        if rc != 0 {
                            return Err(format!("Metal blit copy failed: {}", rc));
                        }

                        // Transition slot: MetalWriting → ReadyForAne (blit is synchronous, completes immediately).
                        out_slot.metal_borrows = out_slot.metal_borrows.saturating_sub(1);
                        out_slot.state = SlotState::ReadyForAne;

                        Ok(())
                    }
                };
                let latency_us = start.elapsed().as_micros() as u64;

                let lane_str = format!("{:?}", lane).to_lowercase();
                let implementation = match lane {
                    LaneAffinity::Cpu => self
                        .registry
                        .accelerate_artifacts
                        .get(artifact_id)
                        .map(|a| format!("{:?}", a.implementation))
                        .unwrap_or_else(|| "Unknown".to_string()),
                    LaneAffinity::Ane => "CoreML".to_string(),
                    LaneAffinity::Gpu => "Metal".to_string(),
                };
                let buffer_mode = match lane {
                    LaneAffinity::Ane => Some(format!("{:?}", self.coreml_buffer_mode)),
                    _ => None,
                };
                let input_region_ids: Vec<u32> =
                    input_bindings.iter().map(|(_, rid)| *rid).collect();
                let output_region_ids: Vec<u32> =
                    output_bindings.iter().map(|(_, rid)| *rid).collect();
                // Extract activation ring metadata for ANE lane dispatches.
                let (slot_id, slot_epoch, iosurface_id, allocation_reused) =
                    if *lane == LaneAffinity::Ane {
                        // Find which activation ring slot backs the first input region.
                        let rid = output_region_ids.first().copied().unwrap_or(u32::MAX);
                        let slot_info = self.activation_ring.as_ref().and_then(
                            |ring| ring.slots.iter().find(|s| s.slot_id == rid % 3), // approximate match
                        );
                        match slot_info {
                            Some(slot) => {
                                let sid = Some(slot.slot_id);
                                let ep = Some(slot.epoch);
                                let iosid = if !slot.cv_pixel_buffer.is_null() {
                                    unsafe {
                                        Some(tribunus_cv_pixel_buffer_io_surface_id(
                                            slot.cv_pixel_buffer,
                                        ))
                                    }
                                } else {
                                    None
                                };
                                (sid, ep, iosid, None) // allocation_reused filled later
                            }
                            None => (None, None, None, None),
                        }
                    } else {
                        (None, None, None, None)
                    };
                let route_outcome = if dispatch_result.is_ok() {
                    "completed".to_string()
                } else {
                    match failure_policy {
                        FailurePolicy::Degrade => "degraded".to_string(),
                        _ => "failed".to_string(),
                    }
                };

                self.node_receipts.push(GraphNodeReceipt {
                    graph_id: graph_id.clone(),
                    graph_variant_id: graph_id.clone(),
                    node_id: pos as u32,
                    artifact_id: artifact_id.clone(),
                    artifact_hash: artifact_hash.clone(),
                    lane: lane_str,
                    implementation,
                    buffer_mode,
                    slot_id,
                    slot_epoch,
                    iosurface_id,
                    allocation_reused,
                    input_region_ids,
                    output_region_ids,
                    latency_us,
                    hash_verified: true,
                    route_outcome,
                    parity_sampled: false,
                    max_abs_error: None,
                    allocation_fallback_reason: self.allocation_fallback_reason.clone(),
                });
                dispatch_result
            }
            GraphNode::Barrier { .. } => Ok(()), // no-op
        }
    }

    /// Set the Core ML buffer mode for ANE dispatch nodes.
    pub fn set_coreml_buffer_mode(&mut self, mode: CoreMlBufferMode) {
        self.coreml_buffer_mode = mode;
    }

    /// Initialize persistent regions for the specified region IDs.
    /// These are allocated once and reused across repeated `run()` calls.
    pub fn init_persistent_regions(
        &mut self,
        region_ids: &[u32],
        buffer_mode: Option<CoreMlBufferMode>,
    ) -> Result<(), String> {
        self.coreml_buffer_mode = buffer_mode.unwrap_or(CoreMlBufferMode::PersistentBufferBacked);

        // Initialize activation ring if PersistentIosurfaceBacked mode is requested
        // and no ring exists yet.  Falls back to PersistentBufferBacked on failure.
        if (self.coreml_buffer_mode == CoreMlBufferMode::PersistentIosurfaceBacked
            || self.coreml_buffer_mode == CoreMlBufferMode::PersistentIosurfaceMetalInterop)
            && self.activation_ring.is_none()
        {
            if let Some(&rid) = region_ids.iter().find(|&&rid| {
                self.graph
                    .regions
                    .get(rid as usize)
                    .map(|r| r.residency == Residency::CoreMlCompatible)
                    .unwrap_or(false)
            }) {
                let spec = &self.graph.regions[rid as usize];
                let width = spec.logical_shape.get(1).copied().unwrap_or(1) as i32;
                let height = spec.logical_shape.first().copied().unwrap_or(1) as i32;
                match ActivationRing::new(3, width, height) {
                    Ok(ring) => {
                        self.activation_ring = Some(ring);
                    }
                    Err(e) => {
                        eprintln!("[fallback] ActivationRing::new failed: {} -- falling back to PersistentBufferBacked", e);
                        self.coreml_buffer_mode = CoreMlBufferMode::PersistentBufferBacked;
                        self.allocation_fallback_reason =
                            Some(format!("ActivationRing::new failed: {}", e));
                    }
                }
            }
        }

        for &rid in region_ids {
            // Skip regions already allocated persistently.
            if self
                .persistent_regions
                .get(rid as usize)
                .and_then(|r| r.as_ref())
                .is_some()
            {
                continue;
            }
            // Allocate fresh memory and move into persistent_regions.
            self.allocate_region(rid, None)?;
            if let Some(buf) = self.regions[rid as usize].take() {
                self.persistent_regions[rid as usize] = Some(buf);
            }
        }
        Ok(())
    }

    /// Reset request-scoped regions without freeing persistent ones.
    /// Keeps persistent_regions allocations intact, resets `regions` for Request-owned regions.
    pub fn reset_request_regions(&mut self) -> Result<(), String> {
        for (i, buf) in self.regions.iter_mut().enumerate() {
            if let Some(b) = buf.take() {
                let is_persistent = self
                    .persistent_regions
                    .get(i)
                    .and_then(|r| r.as_ref())
                    .is_some();
                if !is_persistent {
                    Self::free_buffer(b);
                }
            }
        }
        Ok(())
    }

    /// Run the graph with persistent regions enabled.
    /// Falls back to transient allocations for any region not in persistent_regions.
    pub fn run_persistent(&mut self) -> Result<(), String> {
        self.reset_graph_state();
        self.run()
    }

    /// Reinitialize dependency counters and ready queue so the graph can be
    /// re-evaluated (e.g. for a new decode step with persistent region reuse).
    pub fn reset_graph_state(&mut self) {
        let n_nodes = self.graph.nodes.len();
        // Reset dependency counters.
        self.deps_remaining = self
            .graph
            .nodes
            .iter()
            .map(|n| n.dependency_ids().len() as u32)
            .collect();
        // Re-seed the ready queue with zero-dependency nodes.
        self.ready = self
            .graph
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, n)| n.dependency_ids().is_empty())
            .map(|(pos, _)| pos)
            .collect();
        // Reset completion flags.
        self.completed = vec![false; n_nodes];
        // Reset per-run receipts (keep session receipts in a separate store).
        self.node_receipts.clear();
        self.receipts.clear();
    }

    fn resolve_buffer_ptr(buf: &ResolvedBuffer) -> Result<(*mut u8, u32), String> {
        match buf {
            ResolvedBuffer::Arena { ptr, byte_length } => Ok((*ptr, *byte_length as u32)),
            ResolvedBuffer::IoSurface {
                ptr, byte_length, ..
            } => Ok((*ptr, *byte_length as u32)),
            ResolvedBuffer::WeightSlice { .. } => Err("cannot dispatch from weight slice".into()),
        }
    }

    fn resolve_buffer_mut_ptr(buf: &mut ResolvedBuffer) -> Result<(*mut u8, u32), String> {
        match buf {
            ResolvedBuffer::Arena { ptr, byte_length } => Ok((*ptr, *byte_length as u32)),
            ResolvedBuffer::IoSurface {
                ptr, byte_length, ..
            } => Ok((*ptr, *byte_length as u32)),
            ResolvedBuffer::WeightSlice { .. } => Err("cannot write to weight slice".into()),
        }
    }

    /// Execute all ready nodes until the graph is consumed or blocked.
    pub fn step(&mut self) -> Result<(), String> {
        let mut batch = std::mem::take(&mut self.ready);
        batch.sort();
        batch.dedup();

        let mut newly_ready: Vec<usize> = Vec::new();
        for pos in &batch {
            let result = self.execute_dispatch(*pos);
            match result {
                Ok(()) => {
                    let nr = self.complete_node(*pos);
                    newly_ready.extend(nr);
                }
                Err(e) => {
                    // Check failure policy.
                    let policy = match &self.graph.nodes[*pos] {
                        GraphNode::Dispatch { failure_policy, .. } => failure_policy.clone(),
                        _ => FailurePolicy::Fatal,
                    };
                    match policy {
                        FailurePolicy::Fatal => return Err(e),
                        FailurePolicy::Degrade => {
                            eprintln!("[graph] node {} degraded: {}", pos, e);
                            let nr = self.complete_node(*pos);
                            newly_ready.extend(nr);
                        }
                        FailurePolicy::Fallback(_alt_id) => {
                            // TODO: retry with alternate artifact
                            eprintln!("[graph] node {} fallback requested: {}", pos, e);
                            let nr = self.complete_node(*pos);
                            newly_ready.extend(nr);
                        }
                    }
                }
            }
        }

        // Drain newly ready nodes into the ready queue.
        for pos in newly_ready {
            if !self.ready.contains(&pos) {
                self.ready.push(pos);
            }
        }

        // Re-sort for determinism.
        self.ready.sort();
        self.ready.dedup();

        Ok(())
    }

    /// Run the graph to completion.
    pub fn run(&mut self) -> Result<(), String> {
        while !self.ready.is_empty() {
            self.step()?;
        }
        // Verify all nodes completed.
        let incomplete: Vec<usize> = self
            .completed
            .iter()
            .enumerate()
            .filter(|(_, &c)| !c)
            .map(|(i, _)| i)
            .collect();
        if !incomplete.is_empty() {
            return Err(format!(
                "graph incomplete: {} nodes never executed: {:?}",
                incomplete.len(),
                incomplete
            ));
        }
        Ok(())
    }
}

impl Drop for GraphInstance<'_> {
    fn drop(&mut self) {
        // Destroy activation ring first — releases all CVPixelBufferRefs
        // that ring-owned IoSurface buffers reference.  Individual free_buffer
        // calls on those IoSurface buffers are no-ops.
        if let Some(mut ring) = self.activation_ring.take() {
            ring.destroy();
        }

        // Free region buffers.  persistent_regions entries share the same pointers
        // (cloned by allocate_region's reuse path).  Do NOT free them again below.
        for buf in self.regions.drain(..) {
            if let Some(b) = buf {
                Self::free_buffer(b);
            }
        }
        // persistent_regions pointers are already freed (shared with regions).
        // Just drop the vec without calling free_buffer.
        self.persistent_regions.clear();
    }
}

// ── Graph factory ─────────────────────────────────────────────────────────

/// Build a minimal compute graph for a single Core ML MLP artifact.
///
/// Produces two nodes:
/// 0: Dispatch { artifact_id, lane: Ane }
///    input: region 0 (activation_in, from the layer's hidden state)
///    output: region 1 (activation_out, MLP result)
/// No dependencies — single-node graph for now.
///
/// During the transition, the caller (executor::run_layer or a wrapper)
/// evaluates this graph in place of the MLX MLP + `if ane_runtime` check.
pub fn build_mlp_graph(artifact_entry: &CoreMlArtifactEntry, shape_key: &str) -> ComputeGraph {
    let hidden_size = artifact_entry
        .input_shapes
        .first()
        .and_then(|s| s.get(1))
        .copied()
        .unwrap_or(4096);
    let n_tokens = 1; // decode shape

    let dtype = artifact_entry
        .input_dtypes
        .first()
        .map(|s| s.as_str())
        .unwrap_or("f16");
    let element_bytes: u64 = match dtype {
        "f32" => 4,
        _ => 2,
    };

    let in_bytes = (n_tokens as u64) * (hidden_size as u64) * element_bytes;
    let out_bytes = in_bytes; // MLP preserves hidden dim

    ComputeGraph {
        graph_id: format!("mlp:{}:{}", artifact_entry.segment_id, shape_key),
        graph_version: "0.1.0".to_string(),
        shape_key: shape_key.to_string(),
        nodes: vec![GraphNode::Dispatch {
            node_id: 0,
            artifact_id: artifact_entry.segment_id.clone(),
            artifact_hash: artifact_entry.artifact_hash.clone(),
            input_bindings: vec![(
                artifact_entry
                    .input_feature_names
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "x".into()),
                0,
            )],
            output_bindings: vec![(
                artifact_entry
                    .output_feature_names
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "out".into()),
                1,
            )],
            dependency_ids: vec![],
            lane: LaneAffinity::Ane,
            failure_policy: FailurePolicy::Degrade,
        }],
        regions: vec![
            BufferRegion {
                region_id: 0,
                logical_dtype: dtype.to_string(),
                logical_shape: vec![n_tokens as i64, hidden_size],
                byte_length: in_bytes,
                alignment: 64,
                residency: Residency::CoreMlCompatible,
                ownership: Ownership::Request,
                alias_group: None,
            },
            BufferRegion {
                region_id: 1,
                logical_dtype: dtype.to_string(),
                logical_shape: vec![n_tokens as i64, hidden_size],
                byte_length: out_bytes,
                alignment: 64,
                residency: Residency::CoreMlCompatible,
                ownership: Ownership::Request,
                alias_group: None,
            },
        ],
        entry_node_ids: vec![0],
        output_node_ids: vec![1],
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compute_image::{CoreMlArtifactEntry, CoreMlArtifactReceipt, CoreMlProvenance};

    fn test_artifact_entry() -> CoreMlArtifactEntry {
        CoreMlArtifactEntry {
            segment_id: "layer_0_mlp".into(),
            artifact_hash: "test-hash".into(),
            graph: None,
            package_path: "/tmp/pkg".into(),
            compiled_path: "/tmp/pkg.mlmodelc".into(),
            compiler_version: "test".into(),
            compute_unit_policy: "cpuAndNeuralEngine".into(),
            input_feature_names: vec!["x".into()],
            output_feature_names: vec!["out".into()],
            input_shapes: vec![vec![1, 128]],
            output_shapes: vec![vec![1, 128]],
            input_dtypes: vec!["f32".into()],
            output_dtypes: vec!["f32".into()],
            weight_references: vec![],
            canonical_provenance: CoreMlProvenance {
                source_tensor_ids: vec![],
                image_hash: "test".into(),
            },
            validation_receipt: CoreMlArtifactReceipt {
                compiled: true,
                loaded: false,
                warmup_passed: false,
                numerical_parity: None,
            },
        }
    }

    #[test]
    fn build_mlp_graph_produces_two_regions_one_dispatch() {
        let entry = test_artifact_entry();
        let g = build_mlp_graph(&entry, "decode_1");
        assert_eq!(g.nodes.len(), 1);
        assert_eq!(g.regions.len(), 2);
        assert_eq!(g.entry_node_ids, vec![0]);
        assert_eq!(g.output_node_ids, vec![1]);
        match &g.nodes[0] {
            GraphNode::Dispatch {
                artifact_id, lane, ..
            } => {
                assert_eq!(artifact_id, "layer_0_mlp");
                assert_eq!(*lane, LaneAffinity::Ane);
            }
            _ => panic!("expected Dispatch node"),
        }
    }

    #[test]
    fn graph_instance_tracks_dependencies() {
        use crate::session::SamplerConfig;
        let graph = ComputeGraph {
            graph_id: "test:mlp:decode_1".into(),
            graph_version: "0.1.0".to_string(),
            shape_key: "test".into(),
            nodes: vec![
                GraphNode::Dispatch {
                    node_id: 0,
                    artifact_id: "a".into(),
                    artifact_hash: "hash-a".into(),
                    input_bindings: vec![],
                    output_bindings: vec![],
                    dependency_ids: vec![],
                    lane: LaneAffinity::Ane,
                    failure_policy: FailurePolicy::Degrade,
                },
                GraphNode::Dispatch {
                    node_id: 1,
                    artifact_id: "b".into(),
                    artifact_hash: "hash-b".into(),
                    input_bindings: vec![],
                    output_bindings: vec![],
                    dependency_ids: vec![0],
                    lane: LaneAffinity::Ane,
                    failure_policy: FailurePolicy::Degrade,
                },
            ],
            regions: vec![],
            entry_node_ids: vec![0],
            output_node_ids: vec![1],
        };
        let registry = ArtifactRegistry::new();
        let inst = GraphInstance::new(&graph, &registry, vec![]);
        assert_eq!(inst.deps_remaining, vec![0, 1]);
        assert_eq!(inst.ready, vec![0]); // only node 0 is ready
    }
}
