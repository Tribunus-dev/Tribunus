use crate::engine_policy::{qualification_policy, resolve_generation_budget};
use crate::worker_protocol::StartGenerationPayload;
use crate::worker_supervisor::WorkerSupervisor;
                &self
                    .worker_supervisor
                    .as_ref()
                    .map(|_| "Some(WorkerSupervisor)"),
        let store = ModelStore::open_default()
            .map_err(|e| napi::Error::from_reason(format!("Failed to open model store: {}", e)))?;
        self.model_store
            .list()
            .map_err(|e| napi::Error::from_reason(format!("List failed: {}", e)))
        self.model_store
            .verify_seal(&image_hash)
            .map_err(|e| napi::Error::from_reason(format!("Seal verification failed: {}", e)))?;
        .map_err(|e| napi::Error::from_reason(format!("Failed to launch worker: {}", e)))?;
        let supervisor = self
            .worker_supervisor
            .take()
            .ok_or_else(|| EngineError::new(EngineErrorCode::ModelNotLoaded, "no model loaded"))?;
            let _ = supervisor.cmd_writer.send_command_with_request(
                HostCommand::CancelGeneration,
                req_id,
                payload,
            );
                format!("token ID {} exceeds vocabulary size {}", id, vocab_size),
            let reason = admission.reason.unwrap_or_else(|| "policy rejected".into());
    pub fn cancel_generation(&mut self, job_id: String) -> Result<(), EngineError> {
        let supervisor = self
            .worker_supervisor
            .as_ref()
            .ok_or_else(|| EngineError::new(EngineErrorCode::ModelNotLoaded, "no model loaded"))?;
    use crate::kv_cache::KvCache;
        let image_dir =
            std::env::var("TRIBUNUS_COMPILED_IMAGE").expect("TRIBUNUS_COMPILED_IMAGE not set");
        let profiled_model =
            crate::profiled_executor::LoadedProfiledModel::new(runtime.image_dir())
                .expect("load bindings");
            profiled_model
                .reader
                .manifest
                .execution_plan
                .layers
        assert_eq!(
            after_reuse, after_gen,
            after_reuse, after_gen
        );
        assert_eq!(
            after_close, baseline_handles,
            after_close, baseline_handles
        );
        let image_dir =
            std::env::var("TRIBUNUS_COMPILED_IMAGE").expect("TRIBUNUS_COMPILED_IMAGE not set");
        let profiled_model =
            crate::profiled_executor::LoadedProfiledModel::new(image_path).expect("load bindings");
        let kv_caches: Vec<KvCache> = profiled_model
            .reader
            .manifest
            .execution_plan
            .layers
