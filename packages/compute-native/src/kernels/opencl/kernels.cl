__kernel void matmul_fp32(__global const float* A, __global const float* B, __global float* C, int M, int N, int K) {
    const int TILE_SIZE = 16;
    int row = get_global_id(0);
    int col = get_global_id(1);
    int localRow = get_local_id(0);
    int localCol = get_local_id(1);

    __local float tileA[16][16];
    __local float tileB[16][16];

    float sum = 0.0f;
    for (int t = 0; t < (K + TILE_SIZE - 1) / TILE_SIZE; ++t) {
        if (row < M && t * TILE_SIZE + localCol < K)
            tileA[localRow][localCol] = A[row * K + t * TILE_SIZE + localCol];
        else
            tileA[localRow][localCol] = 0.0f;

        if (t * TILE_SIZE + localRow < K && col < N)
            tileB[localRow][localCol] = B[(t * TILE_SIZE + localRow) * N + col];
        else
            tileB[localRow][localCol] = 0.0f;

        barrier(CLK_LOCAL_MEM_FENCE);

        for (int k = 0; k < TILE_SIZE; ++k) {
            sum += tileA[localRow][k] * tileB[k][localCol];
        }
        barrier(CLK_LOCAL_MEM_FENCE);
    }
    if (row < M && col < N) {
        C[row * N + col] = sum;
    }
}

__kernel void matmul_q4(__global const uchar* A_q4, __global const float* A_scales, __global const float* B, __global float* C, int M, int N, int K) {
    int row = get_global_id(0);
    int col = get_global_id(1);
    if (row >= M || col >= N) return;
    float sum = 0.0f;
    for (int k = 0; k < K; k += 2) {
        uchar qval = A_q4[(row * K + k) / 2];
        float val0 = ((qval & 0x0F) - 8.0f) * A_scales[(row * K + k) / 32];
        float val1 = (((qval >> 4) & 0x0F) - 8.0f) * A_scales[(row * K + k + 1) / 32];
        sum += val0 * B[k * N + col];
        if (k + 1 < K) {
            sum += val1 * B[(k + 1) * N + col];
        }
    }
    C[row * N + col] = sum;
}

__kernel void matmul_q8(__global const char* A_q8, __global const float* A_scales, __global const float* B, __global float* C, int M, int N, int K) {
    int row = get_global_id(0);
    int col = get_global_id(1);
    if (row >= M || col >= N) return;
    float sum = 0.0f;
    for (int k = 0; k < K; ++k) {
        float val = (float)A_q8[row * K + k] * A_scales[(row * K + k) / 32];
        sum += val * B[k * N + col];
    }
    C[row * N + col] = sum;
}

__kernel void elementwise(__global const float* A, __global const float* B, __global float* C, int N, int op_type) {
    int i = get_global_id(0);
    if (i >= N) return;
    float a = A[i];
    float b_val = (B != 0) ? B[i] : 0.0f;
    float res = 0.0f;
    switch(op_type) {
        case 0: res = exp(a); break;
        case 1: res = a / (1.0f + exp(-a)); break; // silu
        case 2: res = 0.5f * a * (1.0f + tanh(0.79788456f * (a + 0.044715f * a * a * a))); break; // gelu
        case 3: res = 1.0f / (1.0f + exp(-a)); break; // sigmoid
        case 4: res = tanh(a); break;
        case 5: res = a + b_val; break;
        case 6: res = a - b_val; break;
        case 7: res = a * b_val; break;
        case 8: res = a / b_val; break;
        case 9: res = fmax(a, b_val); break;
    }
    C[i] = res;
}

__kernel void rope(__global float* Q, __global float* K, __global const float* sin_cache, __global const float* cos_cache, int num_tokens, int num_heads, int head_dim, int seq_len) {
    int idx = get_global_id(0);
    int half_dim = head_dim / 2;
    int total_elements = num_tokens * num_heads * half_dim;
    if (idx >= total_elements) return;

    int d = idx % half_dim;
    int h_idx = (idx / half_dim) % num_heads;
    int t = idx / (half_dim * num_heads);

    int pos = t % seq_len;

    int idx1 = t * num_heads * head_dim + h_idx * head_dim + d;
    int idx2 = idx1 + half_dim;

    float q1 = Q[idx1], q2 = Q[idx2];
    float k1 = K[idx1], k2 = K[idx2];

    float sin_val = sin_cache[pos * half_dim + d];
    float cos_val = cos_cache[pos * half_dim + d];

    Q[idx1] = q1 * cos_val - q2 * sin_val;
    Q[idx2] = q1 * sin_val + q2 * cos_val;

    K[idx1] = k1 * cos_val - k2 * sin_val;
    K[idx2] = k1 * sin_val + k2 * cos_val;
}

__kernel void flash_attention(__global const float* Q, __global const float* K, __global const float* V, __global float* O, int num_tokens, int num_heads, int head_dim, int seq_len) {
    int h_idx = get_global_id(0);
    int q_idx = get_global_id(1);

    if (q_idx >= num_tokens) return;

    float m_i = -INFINITY;
    float l_i = 0.0f;
    float o_i[128];
    for (int d = 0; d < head_dim; ++d) o_i[d] = 0.0f;

    for (int k_tile = 0; k_tile < seq_len; k_tile += 16) {
        float s_ij[16];
        for (int j = 0; j < 16; ++j) {
            int k_idx = k_tile + j;
            if (k_idx >= seq_len) break;
            float dot = 0.0f;
            for (int d = 0; d < head_dim; ++d) {
                dot += Q[q_idx * num_heads * head_dim + h_idx * head_dim + d] *
                       K[k_idx * num_heads * head_dim + h_idx * head_dim + d];
            }
            s_ij[j] = dot / sqrt((float)head_dim);
        }

        float m_ij = -INFINITY;
        for (int j = 0; j < 16; ++j) {
            if (k_tile + j < seq_len) m_ij = fmax(m_ij, s_ij[j]);
        }

        float m_new = fmax(m_i, m_ij);
        float exp_diff = exp(m_i - m_new);

        float l_ij = 0.0f;
        float p_ij[16];
        for (int j = 0; j < 16; ++j) {
            if (k_tile + j < seq_len) {
                p_ij[j] = exp(s_ij[j] - m_new);
                l_ij += p_ij[j];
            }
        }

        float l_new = exp_diff * l_i + l_ij;

        for (int d = 0; d < head_dim; ++d) {
            float v_sum = 0.0f;
            for (int j = 0; j < 16; ++j) {
                if (k_tile + j < seq_len) {
                    v_sum += p_ij[j] * V[(k_tile + j) * num_heads * head_dim + h_idx * head_dim + d];
                }
            }
            o_i[d] = (l_i * exp_diff * o_i[d] + v_sum) / l_new;
        }

        m_i = m_new;
        l_i = l_new;
    }

    for (int d = 0; d < head_dim; ++d) {
        O[q_idx * num_heads * head_dim + h_idx * head_dim + d] = o_i[d];
    }
}

__kernel void online_softmax(__global float* x, int rows, int cols) {
    int row = get_global_id(0);
    if (row >= rows) return;

    float max_val = -INFINITY;
    for (int i = 0; i < cols; ++i) {
        max_val = fmax(max_val, x[row * cols + i]);
    }

    float sum = 0.0f;
    for (int i = 0; i < cols; ++i) {
        sum += exp(x[row * cols + i] - max_val);
    }

    for (int i = 0; i < cols; ++i) {
        x[row * cols + i] = exp(x[row * cols + i] - max_val) / sum;
    }
}

__kernel void reduce_sum(__global const float* input, __global float* output, int N) {
    int tid = get_local_id(0);
    float sum = 0.0f;
    for (int i = tid; i < N; i += get_local_size(0)) {
        sum += input[i];
    }
    __local float local_sums[256];
    local_sums[tid] = sum;
    barrier(CLK_LOCAL_MEM_FENCE);

    for (int s = get_local_size(0) / 2; s > 0; s >>= 1) {
        if (tid < s) {
            local_sums[tid] += local_sums[tid + s];
        }
        barrier(CLK_LOCAL_MEM_FENCE);
    }
    if (tid == 0) output[0] = local_sums[0];
}

__kernel void reduce_max(__global const float* input, __global float* output, int N) {
    int tid = get_local_id(0);
    float m = -INFINITY;
    for (int i = tid; i < N; i += get_local_size(0)) {
        m = fmax(m, input[i]);
    }
    __local float local_maxes[256];
    local_maxes[tid] = m;
    barrier(CLK_LOCAL_MEM_FENCE);

    for (int s = get_local_size(0) / 2; s > 0; s >>= 1) {
        if (tid < s) {
            local_maxes[tid] = fmax(local_maxes[tid], local_maxes[tid + s]);
        }
        barrier(CLK_LOCAL_MEM_FENCE);
    }
    if (tid == 0) output[0] = local_maxes[0];
}

__kernel void reduce_softmax_tree(__global const float* input, __global float* output, int N) {
    int tid = get_local_id(0);

    // Find Max
    float m = -INFINITY;
    for (int i = tid; i < N; i += get_local_size(0)) {
        m = fmax(m, input[i]);
    }
    __local float local_maxes[256];
    local_maxes[tid] = m;
    barrier(CLK_LOCAL_MEM_FENCE);

    for (int s = get_local_size(0) / 2; s > 0; s >>= 1) {
        if (tid < s) {
            local_maxes[tid] = fmax(local_maxes[tid], local_maxes[tid + s]);
        }
        barrier(CLK_LOCAL_MEM_FENCE);
    }
    float global_max = local_maxes[0];
    barrier(CLK_LOCAL_MEM_FENCE);

    // Find Sum
    float sum = 0.0f;
    for (int i = tid; i < N; i += get_local_size(0)) {
        sum += exp(input[i] - global_max);
    }
    __local float local_sums[256];
    local_sums[tid] = sum;
    barrier(CLK_LOCAL_MEM_FENCE);

    for (int s = get_local_size(0) / 2; s > 0; s >>= 1) {
        if (tid < s) {
            local_sums[tid] += local_sums[tid + s];
        }
        barrier(CLK_LOCAL_MEM_FENCE);
    }
    float global_sum = local_sums[0];
    barrier(CLK_LOCAL_MEM_FENCE);

    // Compute Softmax
    for (int i = tid; i < N; i += get_local_size(0)) {
        output[i] = exp(input[i] - global_max) / global_sum;
    }
}
