/// Minimal attention decode primitive for Tensix backend.
/// Implements fixed-shape, batch-one, single-chip unquantized decode step attention.

#[derive(Debug, Clone)]
pub struct KvBlockTable {
    pub max_pages: usize,
    pub page_size: usize,
    pub logical_to_physical: std::collections::HashMap<usize, usize>,
    pub generation_counter: u64,
}

impl Default for KvBlockTable {
    fn default() -> Self {
        Self::new(1024, 16)
    }
}

impl KvBlockTable {
    pub fn new(max_pages: usize, page_size: usize) -> Self {
        Self {
            max_pages,
            page_size,
            logical_to_physical: std::collections::HashMap::new(),
            generation_counter: 0,
        }
    }

    pub fn bind_generation(&mut self, counter: u64) {
        self.generation_counter = counter;
    }

    pub fn read_page(&self, logical_pos: usize) -> Option<usize> {
        let page_idx = logical_pos / self.page_size;
        self.logical_to_physical.get(&page_idx).copied()
    }
}

pub struct AttentionArtifact {
    pub d_model: usize,
}

impl AttentionArtifact {
    pub fn new(d_model: usize) -> Self {
        Self { d_model }
    }

    /// Process a batch-one decode step attention computation.
    /// q: Query vector of shape [1, 1, d_model]
    /// k_pages: Contiguous keys cache pages
    /// v_pages: Contiguous values cache pages
    /// seq_len: Current sequence length (number of cached tokens)
    /// block_table: The KV Block Table for page mappings
    pub fn process(
        &self,
        q: &[f32],
        k_pages: &[f32],
        v_pages: &[f32],
        seq_len: usize,
        block_table: &KvBlockTable,
    ) -> Result<Vec<f32>, String> {
        if q.len() != self.d_model {
            return Err("Query dimension does not match d_model".into());
        }

        let mut out = vec![0.0; self.d_model];

        if seq_len == 0 {
            return Ok(out);
        }

        let mut scores = vec![0.0; seq_len];

        // Q @ K^T and Causal Masking (implicit since we only iterate up to seq_len)
        for i in 0..seq_len {
            let physical_page = block_table.read_page(i).ok_or("Page fault")?;
            let offset_within_page = i % block_table.page_size;
            let physical_offset =
                (physical_page * block_table.page_size + offset_within_page) * self.d_model;

            let mut sum = 0.0;
            for j in 0..self.d_model {
                sum += q[j] * k_pages[physical_offset + j];
            }
            scores[i] = sum / (self.d_model as f32).sqrt(); // scale
        }

        // Numerical stability for softmax
        let mut max_val = f32::NEG_INFINITY;
        for &score in &scores {
            if score > max_val {
                max_val = score;
            }
        }

        // Softmax
        let mut exp_sum = 0.0;
        for i in 0..seq_len {
            scores[i] = (scores[i] - max_val).exp();
            exp_sum += scores[i];
        }

        for i in 0..seq_len {
            scores[i] /= exp_sum;
        }

        // Score @ V
        for i in 0..seq_len {
            let physical_page = block_table.read_page(i).ok_or("Page fault")?;
            let offset_within_page = i % block_table.page_size;
            let physical_offset =
                (physical_page * block_table.page_size + offset_within_page) * self.d_model;

            for j in 0..self.d_model {
                out[j] += scores[i] * v_pages[physical_offset + j];
            }
        }

        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_attention_artifact_process() {
        let d_model = 4;
        let seq_len = 2;
        let artifact = AttentionArtifact::new(d_model);

        let mut block_table = KvBlockTable::new(10, 2);
        block_table.bind_generation(1);
        block_table.logical_to_physical.insert(0, 0);

        let q = vec![1.0, 0.0, 1.0, 0.0];
        let k_pages = vec![
            1.0, 0.0, 0.0, 0.0, // token 0
            0.0, 1.0, 0.0, 1.0, // token 1
        ];
        let v_pages = vec![
            0.5, 0.5, 0.5, 0.5, // token 0
            1.0, 1.0, 1.0, 1.0, // token 1
        ];

        let result = artifact
            .process(&q, &k_pages, &v_pages, seq_len, &block_table)
            .unwrap();

        assert_eq!(result.len(), d_model);
        // The output should be within 1e-2 tolerance.
        // With these values, Q.K gives [1.0/2, 0.0] = [0.5, 0.0]
        // Softmax gives approximately [0.622, 0.377]
        // Weighted V gives [0.622*0.5 + 0.377*1.0, ...] -> [0.688, 0.688, 0.688, 0.688]

        assert!((result[0] - 0.688).abs() < 0.01);
    }
}
