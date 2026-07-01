use crate::storage_kernel::{ProjectionPort, ProjectionRecord};
use crate::Result;
use async_trait::async_trait;
use duckdb::Connection;
use parking_lot::Mutex;
use std::sync::Arc;

pub struct DuckDbAdapter {
    conn: Arc<Mutex<Connection>>,
}

impl DuckDbAdapter {
    pub fn open(path: Option<&str>) -> Result<Self> {
        let conn = match path {
            Some(p) => Connection::open(p),
            None => Connection::open_in_memory(),
        }
        .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }
}

#[async_trait]
impl ProjectionPort for DuckDbAdapter {
    async fn get_projection(&self, record_id: &str) -> Result<Option<ProjectionRecord>> {
        let conn = self.conn.clone();
        let record_id = record_id.to_string();

        tokio::task::spawn_blocking(move || {
            let conn = conn.lock();
            let mut stmt = conn
                .prepare(
                    "SELECT record_id, receipt_id, data_hash FROM projections WHERE record_id = ?1",
                )
                .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

            let mut rows = stmt
                .query([record_id])
                .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

            if let Some(row) = rows
                .next()
                .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?
            {
                Ok(Some(ProjectionRecord {
                    record_id: row.get::<_, String>(0).map_err(|e| {
                        crate::Error::new(crate::Status::InternalError, e.to_string())
                    })?,
                    receipt_id: row.get::<_, Option<String>>(1).map_err(|e| {
                        crate::Error::new(crate::Status::InternalError, e.to_string())
                    })?,
                    data_hash: row.get::<_, String>(2).map_err(|e| {
                        crate::Error::new(crate::Status::InternalError, e.to_string())
                    })?,
                }))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?
    }
}
