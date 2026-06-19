use std::sync::Arc;
use tokio::sync::Mutex;
use crate::xdna::xdna_bridge::{XdnaSession, init_xdna_subsystem};

pub struct XdnaState {
    session: Arc<Mutex<Option<XdnaSession>>>,
    model_path: String,
    device_name: String,
}

impl XdnaState {
    pub fn new(model_path: String) -> Result<Self, String> {
        init_xdna_subsystem()?;
        
        // Setup state. We will load async or lazy
        let device_name = Self::query_device_name();

        Ok(Self {
            session: Arc::new(Mutex::new(None)),
            model_path,
            device_name,
        })
    }
    
    fn query_device_name() -> String {
        // Mock query. In reality we could check sysfs or ask ONNX runtime what devices it found.
        "NPU0".to_string()
    }
    
    pub async fn load(&self) -> Result<(), String> {
        let mut guard = self.session.lock().await;
        if guard.is_some() {
            return Ok(()); // Already loaded
        }
        
        let path = self.model_path.clone();
        let device = self.device_name.clone();
        
        let session = tokio::task::spawn_blocking(move || {
            XdnaSession::new(&path, &device)
        }).await.map_err(|e| e.to_string())??;
        
        *guard = Some(session);
        Ok(())
    }
    
    pub async fn infer(
        &self,
        input_names: Vec<String>,
        input_data: Vec<*mut std::ffi::c_void>,
        input_shapes: Vec<Vec<i64>>,
        output_names: Vec<String>,
        mut output_data: Vec<*mut std::ffi::c_void>,
        output_shapes: Vec<Vec<i64>>,
    ) -> Result<Vec<*mut std::ffi::c_void>, String> {
        let session_clone = {
            let guard = self.session.lock().await;
            if guard.is_none() {
                return Err("Session not loaded".to_string());
            }
            // For safe transfer to blocking thread
            // In a real implementation we'd need an Arc around the session or similar to pass it
            // safely to the blocking thread without holding the async lock.
            self.session.clone()
        };

        // Move execution to blocking thread to avoid blocking the async executor
        let result = tokio::task::spawn_blocking(move || {
            // Re-acquire lock on blocking thread - this is ok since we know we're not blocking the async executor here
            let guard = session_clone.blocking_lock();
            let session = guard.as_ref().unwrap();

            // Convert owned Vecs to slices for the C API
            let in_names_refs: Vec<&str> = input_names.iter().map(|s| s.as_str()).collect();
            let in_shapes_refs: Vec<&[i64]> = input_shapes.iter().map(|s| s.as_slice()).collect();
            let out_names_refs: Vec<&str> = output_names.iter().map(|s| s.as_str()).collect();
            let out_shapes_refs: Vec<&[i64]> = output_shapes.iter().map(|s| s.as_slice()).collect();

            let status = session.run(
                &in_names_refs,
                &input_data,
                &in_shapes_refs,
                &out_names_refs,
                &mut output_data,
                &out_shapes_refs,
            );

            match status {
                Ok(_) => Ok(output_data),
                Err(e) => Err(e),
            }
        }).await.map_err(|e| e.to_string())??;

        Ok(result)
    }
    
    pub async fn unload(&self) {
        let mut guard = self.session.lock().await;
        *guard = None; // Drops the session, triggering cleanup
    }
}
