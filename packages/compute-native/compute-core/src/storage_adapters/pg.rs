use crate::storage_kernel::{DurableAuthorityPort, DurableReceiptRecord};
use crate::Result;
use async_trait::async_trait;
use tokio_postgres::{Client, NoTls};

pub struct PgAdapter {
    client: Client,
}

impl PgAdapter {
    pub async fn connect(config: &str) -> Result<Self> {
        let (client, connection) = tokio_postgres::connect(config, NoTls)
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        tokio::spawn(async move {
            if let Err(e) = connection.await {
                eprintln!("connection error: {}", e);
            }
        });

        Ok(Self { client })
    }
}

#[async_trait]
impl DurableAuthorityPort for PgAdapter {
    async fn get_receipt(&self, work_id: &str) -> Result<Option<DurableReceiptRecord>> {
        let row = self
            .client
            .query_opt(
                "SELECT receipt_id, work_id, timestamp FROM durable_receipts WHERE work_id = $1",
                &[&work_id],
            )
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;

        Ok(row.map(|r| DurableReceiptRecord {
            receipt_id: r.get(0),
            work_id: r.get(1),
            timestamp: r.get::<_, i64>(2) as u64,
        }))
    }

    async fn commit_receipt(&self, record: DurableReceiptRecord) -> Result<()> {
        let ts = record.timestamp as i64;
        let params: &[&(dyn tokio_postgres::types::ToSql + Sync)] =
            &[&record.receipt_id, &record.work_id, &ts];
        self.client
            .execute(
                "INSERT INTO durable_receipts (receipt_id, work_id, timestamp) VALUES ($1, $2, $3)",
                params,
            )
            .await
            .map_err(|e| crate::Error::new(crate::Status::InternalError, e.to_string()))?;
        Ok(())
    }
}
