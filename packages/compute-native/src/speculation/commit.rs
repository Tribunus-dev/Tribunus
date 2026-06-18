use crate::kv_cache::KvCache;
use crate::speculation::verifier::VerificationResult;

pub struct CommitManager;

impl CommitManager {
    /// Commit accepted KV pages (transfer from speculative to authoritative)
    pub fn commit_accepted(kv_cache: &mut KvCache, _result: &VerificationResult) -> Result<(), String> {
        // 1. For each accepted token in {accepted_branch}: migrate spec_kv_pages to kv_pages
        // 2. Advance sequence counters
        // (Mock implementation relying on our basic KvCache API)
        kv_cache.commit_step();
        Ok(())
    }

    /// Roll back rejected branches (invalidate speculative KV pages)
    pub fn rollback_rejected(kv_cache: &mut KvCache, _result: &VerificationResult) -> Result<(), String> {
        // 1. For each rejected branch: invalidate spec_kv_pages (increment generation)
        // 2. Free speculative pages for reuse
        kv_cache.rollback();
        Ok(())
    }

    /// Count accepted tokens vs total tokens in tree
    pub fn acceptance_rate(result: &VerificationResult, total_tokens: usize) -> f32 {
        if total_tokens == 0 {
            return 0.0;
        }
        result.acceptance_count as f32 / total_tokens as f32
    }
}