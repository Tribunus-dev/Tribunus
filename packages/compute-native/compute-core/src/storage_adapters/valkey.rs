use crate::storage_kernel::{CoordinationPort, CoordinationWorkRecord};
use crate::Result;
use async_trait::async_trait;
use redis::AsyncCommands;

pub struct ValkeyAdapter {
    client: redis::Client,
}

impl ValkeyAdapter {
    pub fn new(url: &str) -> Result<Self> {
        let client = redis::Client::open(url)
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;
        Ok(Self { client })
    }
}

#[async_trait]
impl CoordinationPort for ValkeyAdapter {
    async fn get_work(&self, work_id: &str) -> Result<Option<CoordinationWorkRecord>> {
        let mut conn = self
            .client
            .get_multiplexed_tokio_connection()
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        let key = format!("work:{}", work_id);
        let exists: bool = conn
            .exists(&key)
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        if !exists {
            return Ok(None);
        }

        let state: String = conn
            .hget(&key, "state")
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;
        let acked: bool = conn
            .hget(&key, "acked")
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        Ok(Some(CoordinationWorkRecord {
            work_id: work_id.to_string(),
            state,
            acked,
        }))
    }
}
