//! napi-rs bindings for the Prism Engine.
//!
//! Exposes `ComputeEngine` (model lifecycle + synchronous generation)
//! to Node.js through napi-rs.

use std::sync::Mutex;

use napi::bindgen_prelude::*;
use napi_derive::napi;

use tribunus_compute_core::engine::ComputeEngine as CoreComputeEngine;
use tribunus_compute_core::streaming::GenerationHandle;

// ── Capabilities ────────────────────────────────────────────────────────

#[napi(object)]
#[derive(Clone)]
pub struct NapiEngineCapabilities {
    pub supports_gpu: bool,
    pub supports_coreml: bool,
    pub mlx_version: String,
}

impl From<tribunus_compute_core::engine::EngineCapabilities> for NapiEngineCapabilities {
    fn from(c: tribunus_compute_core::engine::EngineCapabilities) -> Self {
        NapiEngineCapabilities {
            supports_gpu: c.supports_gpu,
            supports_coreml: c.supports_coreml,
            mlx_version: c.mlx_version,
        }
    }
}

// ── Generation Result ───────────────────────────────────────────────────

#[napi(object)]
#[derive(Clone)]
pub struct NapiGenerationResult {
    /// Generated token IDs.
    pub token_ids: Vec<i32>,
    /// Decoded text output.
    pub output: String,
    /// Total tokens generated.
    pub token_count: u32,
    /// Job ID for cancellation.
    pub job_id: String,
}

// ── Compute Engine ──────────────────────────────────────────────────────

/// Prism model lifecycle and generation engine.
///
/// Manages model store, model loading, token generation, and cancellation.
#[napi]
pub struct ComputeEngine {
    inner: Mutex<CoreComputeEngine>,
}

#[napi]
impl ComputeEngine {
    /// Create a new engine with the default model store.
    #[napi(constructor)]
    pub fn new() -> Result<Self> {
        let engine = CoreComputeEngine::new().map_err(to_napi_err)?;
        Ok(ComputeEngine {
            inner: Mutex::new(engine),
        })
    }

    /// Load an installed model by its image hash.
    #[napi]
    pub fn load_model(&self, image_hash: String) -> Result<()> {
        let mut engine = self.inner.lock().map_err(|e| {
            Error::from_reason(format!("engine lock: {}", e))
        })?;
        engine.load_model(image_hash).map_err(to_napi_err)
    }

    /// Unload the currently loaded model and release resources.
    #[napi]
    pub fn unload_model(&self) -> Result<()> {
        let mut engine = self.inner.lock().map_err(|e| {
            Error::from_reason(format!("engine lock: {}", e))
        })?;
        engine.unload_model().map_err(to_napi_err)
    }

    /// Generate tokens synchronously from a loaded model.
    #[napi]
    pub fn generate(
        &self,
        input_ids: Vec<i32>,
        max_tokens: u32,
    ) -> Result<NapiGenerationResult> {
        let mut engine = self.inner.lock().map_err(|e| {
            Error::from_reason(format!("engine lock: {}", e))
        })?;

        let ids: Vec<u32> = input_ids.into_iter().map(|id| id as u32).collect();
        let handle = engine.generate(&ids, max_tokens).map_err(to_napi_err)?;
        let job_id = handle.job_id.clone();

        let result = collect_generation(handle)?;

        Ok(NapiGenerationResult {
            token_ids: result.token_ids,
            output: result.output,
            token_count: result.token_count,
            job_id,
        })
    }

    /// Cancel an active generation by job id.
    #[napi]
    pub fn cancel(&self, job_id: String) -> Result<()> {
        let mut engine = self.inner.lock().map_err(|e| {
            Error::from_reason(format!("engine lock: {}", e))
        })?;
        engine.cancel_generation(job_id).map_err(to_napi_err)
    }

    /// Return the capability report for this engine instance.
    #[napi]
    pub fn capabilities(&self) -> NapiEngineCapabilities {
        let engine = self.inner.lock().ok();
        match engine {
            Some(e) => e.capabilities().into(),
            None => NapiEngineCapabilities {
                supports_gpu: false,
                supports_coreml: false,
                mlx_version: "unknown".into(),
            },
        }
    }
}

// ── Generation Collection ───────────────────────────────────────────────

struct CollectedResult {
    token_ids: Vec<i32>,
    output: String,
    token_count: u32,
}

fn collect_generation(mut handle: GenerationHandle) -> Result<CollectedResult> {
    let mut token_ids: Vec<i32> = Vec::new();
    let mut output = String::new();
    let mut token_count: u32 = 0;

    loop {
        let Some(event) = handle.stream.recv() else {
            break;
        };

        match event {
            tribunus_compute_core::streaming::GenerationEvent::Token(id) => {
                token_ids.push(id as i32);
                token_count += 1;
            }
            tribunus_compute_core::streaming::GenerationEvent::Chunk(text) => {
                output.push_str(&text);
            }
            tribunus_compute_core::streaming::GenerationEvent::Done
            | tribunus_compute_core::streaming::GenerationEvent::Cancelled => {
                break;
            }
            tribunus_compute_core::streaming::GenerationEvent::Error(e) => {
                return Err(Error::from_reason(format!("generation error: {}", e)));
            }
            _ => {}
        }
    }

    Ok(CollectedResult {
        token_ids,
        output,
        token_count,
    })
}

// ── Error Conversion ───────────────────────────────────────────────────

fn to_napi_err(e: impl std::fmt::Display) -> Error {
    Error::from_reason(format!("{}", e))
}
