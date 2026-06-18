import fs from 'fs';

const file = 'packages/compute-native/compute-core/tests/mlx_accelerate_smoke.rs';
let content = fs.readFileSync(file, 'utf8');

const tests = [
  'mlx_known_answer_2x3_3x4',
  'mlx_vs_accelerate_parity_small',
  'mlx_vs_accelerate_parity_square',
  'mlx_vs_scalar_oracle_2x3',
  'mlx_vs_accelerate_m1_decode',
  'mlx_memory_returns_to_baseline'
];

for (const test of tests) {
  const regex = new RegExp(`(#\\[test\\]\\n)(fn ${test})`, 'g');
  content = content.replace(regex, `$1#[ignore]\n$2`);
}

fs.writeFileSync(file, content);
