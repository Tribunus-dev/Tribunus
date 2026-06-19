#include <sycl/sycl.hpp>
#include <cmath>

using namespace sycl;

extern "C" {

void launch_matmul_fp32(queue& q, const float* A, const float* B, float* C, int M, int N, int K) {
    constexpr int TILE_SIZE = 16;
    q.submit([&](handler& h) {
        local_accessor<float, 1> tileA(TILE_SIZE * TILE_SIZE, h);
        local_accessor<float, 1> tileB(TILE_SIZE * TILE_SIZE, h);
        h.parallel_for(nd_range<2>(range<2>((M + TILE_SIZE - 1) / TILE_SIZE * TILE_SIZE, (N + TILE_SIZE - 1) / TILE_SIZE * TILE_SIZE), range<2>(TILE_SIZE, TILE_SIZE)), [=](nd_item<2> item) {
            int row = item.get_global_id(0);
            int col = item.get_global_id(1);
            int localRow = item.get_local_id(0);
            int localCol = item.get_local_id(1);

            float sum = 0.0f;
            for (int t = 0; t < (K + TILE_SIZE - 1) / TILE_SIZE; ++t) {
                if (row < M && t * TILE_SIZE + localCol < K)
                    tileA[localRow * TILE_SIZE + localCol] = A[row * K + t * TILE_SIZE + localCol];
                else
                    tileA[localRow * TILE_SIZE + localCol] = 0.0f;

                if (t * TILE_SIZE + localRow < K && col < N)
                    tileB[localRow * TILE_SIZE + localCol] = B[(t * TILE_SIZE + localRow) * N + col];
                else
                    tileB[localRow * TILE_SIZE + localCol] = 0.0f;

                item.barrier(access::fence_space::local_space);

                for (int k = 0; k < TILE_SIZE; ++k) {
                    sum += tileA[localRow * TILE_SIZE + k] * tileB[k * TILE_SIZE + localCol];
                }
                item.barrier(access::fence_space::local_space);
            }
            if (row < M && col < N) {
                C[row * N + col] = sum;
            }
        });
    });
}

void launch_matmul_q4(queue& q, const uint8_t* A_q4, const float* A_scales, const float* B, float* C, int M, int N, int K) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<2>(range<2>(M, N), range<2>(1, 16)), [=](nd_item<2> item) {
            int row = item.get_global_id(0);
            int col = item.get_global_id(1);
            if (row >= M || col >= N) return;
            float sum = 0.0f;
            for (int k = 0; k < K; k += 2) {
                uint8_t qval = A_q4[(row * K + k) / 2];
                float val0 = ((qval & 0x0F) - 8.0f) * A_scales[(row * K + k) / 32];
                float val1 = (((qval >> 4) & 0x0F) - 8.0f) * A_scales[(row * K + k + 1) / 32];
                sum += val0 * B[k * N + col];
                if (k + 1 < K) {
                    sum += val1 * B[(k + 1) * N + col];
                }
            }
            C[row * N + col] = sum;
        });
    });
}

void launch_matmul_q8(queue& q, const int8_t* A_q8, const float* A_scales, const float* B, float* C, int M, int N, int K) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<2>(range<2>(M, N), range<2>(1, 16)), [=](nd_item<2> item) {
            int row = item.get_global_id(0);
            int col = item.get_global_id(1);
            if (row >= M || col >= N) return;
            float sum = 0.0f;
            for (int k = 0; k < K; ++k) {
                float val = (float)A_q8[row * K + k] * A_scales[(row * K + k) / 32];
                sum += val * B[k * N + col];
            }
            C[row * N + col] = sum;
        });
    });
}

void launch_elementwise(queue& q, const float* A, const float* B, float* C, int N, int op_type) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>((N + 255) / 256 * 256), range<1>(256)), [=](nd_item<1> item) {
            int i = item.get_global_id(0);
            if (i >= N) return;
            float a = A[i];
            float b_val = (B != nullptr) ? B[i] : 0.0f;
            float res = 0.0f;
            switch(op_type) {
                case 0: res = sycl::exp(a); break;
                case 1: res = a / (1.0f + sycl::exp(-a)); break; // silu
                case 2: res = 0.5f * a * (1.0f + sycl::tanh(0.79788456f * (a + 0.044715f * a * a * a))); break; // gelu
                case 3: res = 1.0f / (1.0f + sycl::exp(-a)); break; // sigmoid
                case 4: res = sycl::tanh(a); break;
                case 5: res = a + b_val; break;
                case 6: res = a - b_val; break;
                case 7: res = a * b_val; break;
                case 8: res = a / b_val; break;
                case 9: res = sycl::fmax(a, b_val); break;
            }
            C[i] = res;
        });
    });
}

void launch_rope(queue& q, float* Q, float* K, const float* sin_cache, const float* cos_cache, int num_tokens, int num_heads, int head_dim, int seq_len) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>((num_tokens * num_heads * (head_dim / 2) + 63) / 64 * 64), range<1>(64)), [=](nd_item<1> item) {
            int idx = item.get_global_id(0);
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
        });
    });
}

void launch_flash_attention(queue& q, const float* Q, const float* K, const float* V, float* O, int num_tokens, int num_heads, int head_dim, int seq_len) {
    constexpr int TILE_Q = 16;
    constexpr int TILE_K = 16;
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<2>(range<2>(num_heads, (num_tokens + TILE_Q - 1) / TILE_Q * TILE_Q), range<2>(1, TILE_Q)), [=](nd_item<2> item) {
            int h_idx = item.get_global_id(0);
            int q_idx = item.get_global_id(1);

            if (q_idx >= num_tokens) return;

            float m_i = -INFINITY;
            float l_i = 0.0f;
            float o_i[128];
            for (int d = 0; d < head_dim; ++d) o_i[d] = 0.0f;

            for (int k_tile = 0; k_tile < seq_len; k_tile += TILE_K) {
                float s_ij[TILE_K];
                for (int j = 0; j < TILE_K; ++j) {
                    int k_idx = k_tile + j;
                    if (k_idx >= seq_len) break;
                    float dot = 0.0f;
                    for (int d = 0; d < head_dim; ++d) {
                        dot += Q[q_idx * num_heads * head_dim + h_idx * head_dim + d] *
                               K[k_idx * num_heads * head_dim + h_idx * head_dim + d];
                    }
                    s_ij[j] = dot / sycl::sqrt((float)head_dim);
                }

                float m_ij = -INFINITY;
                for (int j = 0; j < TILE_K; ++j) {
                    if (k_tile + j < seq_len) m_ij = sycl::fmax(m_ij, s_ij[j]);
                }

                float m_new = sycl::fmax(m_i, m_ij);
                float exp_diff = sycl::exp(m_i - m_new);

                float l_ij = 0.0f;
                float p_ij[TILE_K];
                for (int j = 0; j < TILE_K; ++j) {
                    if (k_tile + j < seq_len) {
                        p_ij[j] = sycl::exp(s_ij[j] - m_new);
                        l_ij += p_ij[j];
                    }
                }

                float l_new = exp_diff * l_i + l_ij;

                for (int d = 0; d < head_dim; ++d) {
                    float v_sum = 0.0f;
                    for (int j = 0; j < TILE_K; ++j) {
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
        });
    });
}

void launch_online_softmax(queue& q, float* x, int rows, int cols) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>(rows * 32), range<1>(32)), [=](nd_item<1> item) {
            int row = item.get_group(0);
            int tid = item.get_local_id(0);
            auto sg = item.get_sub_group();

            float max_val = -INFINITY;
            for (int i = tid; i < cols; i += 32) {
                max_val = sycl::fmax(max_val, x[row * cols + i]);
            }
            max_val = sycl::reduce_over_group(sg, max_val, sycl::maximum<float>());

            float sum = 0.0f;
            for (int i = tid; i < cols; i += 32) {
                sum += sycl::exp(x[row * cols + i] - max_val);
            }
            sum = sycl::reduce_over_group(sg, sum, sycl::plus<float>());

            for (int i = tid; i < cols; i += 32) {
                x[row * cols + i] = sycl::exp(x[row * cols + i] - max_val) / sum;
            }
        });
    });
}

void launch_reduce_sum(queue& q, const float* input, float* output, int N) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>(256), range<1>(256)), [=](nd_item<1> item) {
            int tid = item.get_local_id(0);
            auto sg = item.get_sub_group();
            float sum = 0.0f;
            for (int i = tid; i < N; i += 256) {
                sum += input[i];
            }
            sum = sycl::reduce_over_group(sg, sum, sycl::plus<float>());
            if (tid == 0) output[0] = sum;
        });
    });
}

void launch_reduce_max(queue& q, const float* input, float* output, int N) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>(256), range<1>(256)), [=](nd_item<1> item) {
            int tid = item.get_local_id(0);
            auto sg = item.get_sub_group();
            float m = -INFINITY;
            for (int i = tid; i < N; i += 256) {
                m = sycl::fmax(m, input[i]);
            }
            m = sycl::reduce_over_group(sg, m, sycl::maximum<float>());
            if (tid == 0) output[0] = m;
        });
    });
}

void launch_reduce_softmax_tree(queue& q, const float* input, float* output, int N) {
    q.submit([&](handler& h) {
        h.parallel_for(nd_range<1>(range<1>(256), range<1>(256)), [=](nd_item<1> item) {
            int tid = item.get_local_id(0);
            auto sg = item.get_sub_group();

            float m = -INFINITY;
            for (int i = tid; i < N; i += 256) {
                m = sycl::fmax(m, input[i]);
            }
            m = sycl::reduce_over_group(sg, m, sycl::maximum<float>());

            float sum = 0.0f;
            for (int i = tid; i < N; i += 256) {
                sum += sycl::exp(input[i] - m);
            }
            sum = sycl::reduce_over_group(sg, sum, sycl::plus<float>());

            for (int i = tid; i < N; i += 256) {
                output[i] = sycl::exp(input[i] - m) / sum;
            }
        });
    });
}

} // extern "C"
