import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function warn(message: string) {
  console.warn(`WARN: ${message}`);
}

const computeNativeDir = join(process.cwd(), 'packages/compute-native');
const authorityPath = join(computeNativeDir, 'AUTHORITY.md');
const linkagePath = join(computeNativeDir, 'DEPENDENCY_LINKAGE.md');

// Contract 1: Authority docs exist
if (!existsSync(authorityPath)) fail('AUTHORITY.md is missing');
if (!existsSync(linkagePath)) fail('DEPENDENCY_LINKAGE.md is missing');

const authorityContent = readFileSync(authorityPath, 'utf8');
const linkageContent = readFileSync(linkagePath, 'utf8');

// Contract 2: Authority declaration is present
if (!authorityContent.includes('packages/compute-native') || !authorityContent.includes('canonical')) {
  fail('AUTHORITY.md must state that packages/compute-native is canonical');
}
if (!authorityContent.includes('Tribunus-Compute is reference/staging or non-canonical')) {
  fail('AUTHORITY.md must state that Tribunus-Compute is reference/staging or non-canonical');
}

// Contract 3: Dependency-linkage note is well-formed
if (linkageContent.includes('\n+') || linkageContent.includes('\n+```') || linkageContent.startsWith('+')) {
  fail('DEPENDENCY_LINKAGE.md contains obvious pasted diff artifacts');
}

const cargoTomlPath = join(computeNativeDir, 'Cargo.toml');
const cargoLockPath = join(computeNativeDir, 'Cargo.lock');
const gitmodulesPath = join(process.cwd(), '.gitmodules');

const cargoToml = existsSync(cargoTomlPath) ? readFileSync(cargoTomlPath, 'utf8') : '';
const cargoLock = existsSync(cargoLockPath) ? readFileSync(cargoLockPath, 'utf8') : '';
const gitmodules = existsSync(gitmodulesPath) ? readFileSync(gitmodulesPath, 'utf8') : '';

// Analyze Cargo.toml dependencies
const mlxRsGit = cargoToml.match(/mlx-rs\s*=\s*\{\s*git\s*=/);
const mlxSysGit = cargoToml.match(/mlx-sys\s*=\s*\{\s*git\s*=/);
const mlxRsPath = cargoToml.match(/mlx-rs\s*=\s*\{\s*path\s*=/);
const mlxSysPath = cargoToml.match(/mlx-sys\s*=\s*\{\s*path\s*=/);

// Contract 4: Cargo linkage is coherent
if (mlxRsGit && mlxSysGit) {
  if (!cargoLock.includes('name = "mlx-rs"')) {
    fail('Cargo.toml uses git dependencies, but Cargo.lock does not contain resolved mlx-rs');
  }
} else if (mlxRsPath && mlxSysPath) {
  // Extract path
  const rsMatch = cargoToml.match(/mlx-rs\s*=\s*\{\s*path\s*=\s*"([^"]+)"/);
  const sysMatch = cargoToml.match(/mlx-sys\s*=\s*\{\s*path\s*=\s*"([^"]+)"/);
  if (rsMatch && !existsSync(join(computeNativeDir, rsMatch[1]))) {
    fail(`Path dependency for mlx-rs not found: ${rsMatch[1]}`);
  }
  if (sysMatch && !existsSync(join(computeNativeDir, sysMatch[1]))) {
    fail(`Path dependency for mlx-sys not found: ${sysMatch[1]}`);
  }
} else if ((mlxRsGit && mlxSysPath) || (mlxRsPath && mlxSysGit)) {
  fail('Cargo.toml mixes git dependency and path dependency for mlx-rs/mlx-sys');
}

// Contract 5: No fake submodule half-state
const mlxRsForkDir = join(process.cwd(), 'packages/mlx-rs-fork');
if (gitmodules.includes('packages/mlx-rs-fork')) {
  // Not checking git link robustly in a script without network, but checking existence
  if (!existsSync(mlxRsForkDir)) {
    fail('.gitmodules declares mlx-rs-fork but directory does not exist (submodule not initialized?)');
  }
}

if (existsSync(mlxRsForkDir) && !existsSync(join(mlxRsForkDir, '.git'))) {
  fail('packages/mlx-rs-fork exists but is not a real submodule');
}

// Contract 6: Nested mlx-c expectation
if (existsSync(mlxRsForkDir)) {
  const mlxcPath = join(mlxRsForkDir, 'mlx-sys/src/mlx-c');
  if (!existsSync(mlxcPath)) {
    fail('packages/mlx-rs-fork/mlx-sys/src/mlx-c does not exist. Initialize submodules recursively.');
  }
}

// Contract 7: compute-core inheritance
const computeCoreTomlPath = join(computeNativeDir, 'compute-core/Cargo.toml');
if (existsSync(computeCoreTomlPath)) {
  const coreToml = readFileSync(computeCoreTomlPath, 'utf8');
  if (coreToml.match(/mlx-rs\s*=\s*\{\s*(git|path)/) || coreToml.match(/mlx-sys\s*=\s*\{\s*(git|path)/)) {
    fail('compute-core Cargo.toml should inherit mlx-rs and mlx-sys from workspace dependencies');
  }
}

console.log('Compute contracts verified successfully.');
