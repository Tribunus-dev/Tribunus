use std::{
    collections::HashMap,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
};

use crate::inference_profile::{
    backend::BackendKind,
    evidence::{EvidenceLedger, LedgerError, PhaseEvidenceReceipt},
    ids::{MachineProfileDigest, ModelProfileDigest},
    phase::PhaseKind,
};

#[derive(Debug)]
pub struct JsonlEvidenceLedger {
    path: PathBuf,
    receipts: Vec<PhaseEvidenceReceipt>,
    index: HashMap<String, usize>,
}

impl JsonlEvidenceLedger {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, LedgerError> {
        let path = path.as_ref().to_path_buf();
        let mut receipts = Vec::new();
        let mut index = HashMap::new();

        if let Ok(file) = File::open(&path) {
            for line in BufReader::new(file).lines() {
                let line = line.map_err(|e| LedgerError::IoError(e.to_string()))?;
                if line.trim().is_empty() {
                    continue;
                }
                let receipt: PhaseEvidenceReceipt = serde_json::from_str(&line)
                    .map_err(|e| LedgerError::SerdeError(e.to_string()))?;
                index.insert(receipt.receipt_id.to_string(), receipts.len());
                receipts.push(receipt);
            }
        }

        Ok(Self {
            path,
            receipts,
            index,
        })
    }

    fn append_line(&self, receipt: &PhaseEvidenceReceipt) -> Result<(), LedgerError> {
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .map_err(|e| LedgerError::IoError(e.to_string()))?;
        let line =
            serde_json::to_string(receipt).map_err(|e| LedgerError::SerdeError(e.to_string()))?;
        writeln!(file, "{line}").map_err(|e| LedgerError::IoError(e.to_string()))
    }
}

impl EvidenceLedger for JsonlEvidenceLedger {
    fn append(&mut self, receipt: PhaseEvidenceReceipt) -> Result<(), LedgerError> {
        if self.index.contains_key(&receipt.receipt_id.to_string()) {
            return Err(LedgerError::ReceiptAlreadyExists(receipt.receipt_id));
        }
        self.append_line(&receipt)?;
        self.index
            .insert(receipt.receipt_id.to_string(), self.receipts.len());
        self.receipts.push(receipt);
        Ok(())
    }

    fn query_by_phase(&self, backend: BackendKind, kind: PhaseKind) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| r.backend == backend && r.phase_kind == kind)
            .cloned()
            .collect()
    }

    fn query_by_model_digest(
        &self,
        model_digest: &ModelProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| &r.model_profile_digest == model_digest)
            .cloned()
            .collect()
    }

    fn query_by_machine_digest(
        &self,
        machine_digest: &MachineProfileDigest,
    ) -> Vec<PhaseEvidenceReceipt> {
        self.receipts
            .iter()
            .filter(|r| &r.machine_profile_digest == machine_digest)
            .cloned()
            .collect()
    }

    fn len(&self) -> usize {
        self.receipts.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::inference_profile::{
        backend::EvidenceStatus,
        evidence::TimestampMs,
        ids::{PhaseId, ProfileId, ReceiptId},
        phase::PhaseKind,
    };

    fn digest(char_: char) -> String {
        std::iter::repeat(char_).take(64).collect()
    }

    fn receipt(i: u64) -> PhaseEvidenceReceipt {
        let now = TimestampMs::now();
        PhaseEvidenceReceipt {
            receipt_id: ReceiptId::new_random(),
            phase_id: PhaseId::new(PhaseKind::Prefill.ordinal(), i as u32),
            phase_kind: PhaseKind::Prefill,
            profile_id: ProfileId::new_random(),
            backend: BackendKind::MLX,
            machine_profile_digest: MachineProfileDigest::from_hex(digest('a')).unwrap(),
            model_profile_digest: ModelProfileDigest::from_hex(digest('b')).unwrap(),
            input_digest: "in".into(),
            output_digest: Some("out".into()),
            started_at: now,
            finished_at: now,
            status: EvidenceStatus::RuntimeSmokePassed,
            metrics: Default::default(),
            artifacts: vec![],
            gate_results: vec![],
            failure: None,
            notes: None,
        }
    }

    #[test]
    fn append_and_reload_jsonl() {
        let path = std::env::temp_dir().join(format!("taip-ledger-{}.jsonl", uuid::Uuid::new_v4()));
        let mut ledger = JsonlEvidenceLedger::open(&path).unwrap();
        ledger.append(receipt(0)).unwrap();
        ledger.append(receipt(1)).unwrap();
        let reopened = JsonlEvidenceLedger::open(&path).unwrap();
        assert_eq!(reopened.len(), 2);
        let _ = std::fs::remove_file(path);
    }
}
