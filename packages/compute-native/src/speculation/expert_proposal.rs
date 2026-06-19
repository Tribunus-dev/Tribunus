use mlx_rs::{Array, error::Result, ops};

pub type Tensor = Array;

pub struct ExpertProposalHead {
    pub expert_id: u32,
    pub ln_weight: Tensor,   // LayerNorm weight, size = hidden_dim
    pub ln_bias: Option<Tensor>, // optional bias
    pub proj_weight: Tensor, // linear projection: hidden_dim -> vocab_size or low_rank
    pub proj_weight_up: Option<Tensor>, // if low_rank, projection from low_rank -> vocab_size
    pub hidden_dim: usize,
    pub vocab_size: usize,
    pub low_rank: Option<usize>, // if Some, project to low_rank then to vocab (2 matmuls instead of 1 big one)
}

impl ExpertProposalHead {
    pub fn new(expert: u32, hidden_dim: usize, vocab_size: usize, low_rank: Option<usize>) -> Self {
        // According to requirements: "if vocab_size > 100000, use low_rank=2048 (2 matmuls) instead of 1 huge matmul"
        // (This logic should be applied either here or in the Fabric, we'll ensure it's applied)
        let actual_low_rank = if vocab_size > 100_000 && low_rank.is_none() {
            Some(2048)
        } else {
            low_rank
        };

        let ln_weight = Array::ones::<f32>(&[hidden_dim as i32]).unwrap();
        let ln_bias = Some(Array::zeros::<f32>(&[hidden_dim as i32]).unwrap());

        let (proj_weight, proj_weight_up) = if let Some(lr) = actual_low_rank {
            let pw = Array::zeros::<f32>(&[hidden_dim as i32, lr as i32]).unwrap();
            let pwu = Array::zeros::<f32>(&[lr as i32, vocab_size as i32]).unwrap();
            (pw, Some(pwu))
        } else {
            let pw = Array::zeros::<f32>(&[hidden_dim as i32, vocab_size as i32]).unwrap();
            (pw, None)
        };

        Self {
            expert_id: expert,
            ln_weight,
            ln_bias,
            proj_weight,
            proj_weight_up,
            hidden_dim,
            vocab_size,
            low_rank: actual_low_rank,
        }
    }

    pub fn forward(&self, expert_output: &Tensor) -> Result<Tensor> {
        // 1. LayerNorm(expert_output)
        let normed = ops::rms_norm(expert_output, &self.ln_weight, 1e-5)?;
        let normed = if let Some(bias) = &self.ln_bias {
            ops::add(&normed, bias)?
        } else {
            normed
        };

        // 2. Linear projection: normed -> (low_rank) or -> vocab_size
        let mut logits = ops::matmul(&normed, &self.proj_weight)?;

        // 3. If low_rank: Linear(low_rank_result -> vocab_size)
        if self.low_rank.is_some() {
            if let Some(up) = &self.proj_weight_up {
                logits = ops::matmul(&logits, up)?;
            }
        }

        // Returns logits of shape [vocab_size]
        Ok(logits)
    }

    /// Training step for a single head — maximize acceptance rate
    pub fn train_step(&mut self, hidden: &Tensor, target_logits: &Tensor) -> Result<f32> {
        // Loss = cross_entropy + KL(target_logits || proposal_logits) + diversity_regularizer
        // For now, this is a stub. We'll simulate a dummy loss value.
        let logits = self.forward(hidden)?;
        let _ = logits; // Use logits in actual training
        let _ = target_logits;
        
        Ok(0.0) // Dummy loss
    }
}

pub struct ExpertProposalFabric {
    pub heads: Vec<ExpertProposalHead>,
    pub num_activated: usize, // typically 8
    pub hidden_dim: usize,
}

impl ExpertProposalFabric {
    pub fn new(num_experts: u32, hidden_dim: usize, vocab_size: usize, low_rank: Option<usize>) -> Self {
        // "Create one head per expert (up to 256 for DeepSeek-class)."
        let mut heads = Vec::with_capacity(num_experts as usize);
        for i in 0..num_experts {
            heads.push(ExpertProposalHead::new(i, hidden_dim, vocab_size, low_rank));
        }

        Self {
            heads,
            num_activated: 8,
            hidden_dim,
        }
    }

    /// Run all activated expert heads in parallel (intended for ANE/GPU batch)
    pub fn propose_batch(&self, expert_outputs: &[Tensor], indices: &[u32]) -> Result<Vec<Tensor>> {
        // Only runs heads for the activated experts (indices)
        // Returns logits for each activated expert
        let mut all_logits = Vec::with_capacity(indices.len());
        for (i, &idx) in indices.iter().enumerate() {
            let expert_head = &self.heads[idx as usize];
            let output = &expert_outputs[i];
            let logits = expert_head.forward(output)?;
            all_logits.push(logits);
        }
        Ok(all_logits)
    }

    /// Serialize heads to a MIL program for ANE execution
    pub fn compile_to_mil(&self) -> Result<Vec<u8>> {
        // Produces a Core ML MIL program containing:
        //   - 8 parallel LN + linear paths, fused as one graph
        //   - Input: 8 x [1, hidden_dim]
        //   - Output: 8 x [vocab_size] logits
        // Return dummy bytes for now, fall back if this fails
        Ok(vec![])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_expert_proposal_fabric() {
        // Test: create 8 random proposal heads, run propose_batch, verify outputs have correct shapes
        let hidden_dim = 64;
        let vocab_size = 1000;
        let num_experts = 8;
        let fabric = ExpertProposalFabric::new(num_experts, hidden_dim, vocab_size, None);
        
        let mut expert_outputs = Vec::new();
        let mut indices = Vec::new();
        for i in 0..num_experts {
            expert_outputs.push(Array::zeros::<f32>(&[1, hidden_dim as i32]).unwrap());
            indices.push(i);
        }
        
        let logits = fabric.propose_batch(&expert_outputs, &indices).unwrap();
        assert_eq!(logits.len(), num_experts as usize);
        for l in logits {
            assert_eq!(l.shape(), &[1, vocab_size as i32]);
        }
    }
}
