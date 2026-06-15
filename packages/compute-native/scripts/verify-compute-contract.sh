#!/usr/bin/env bash
# Tribunus Compute Contract Verifier
# Mission: TRIBUNUS-COMPUTE-CONTRACT-VERIFIER-0001
#
# Enforces compute dependency-linkage contracts to prevent:
# - Fake .gitmodules (no gitlink)
# - Missing nested submodules (mlx-c-fork)
# - Mismatched path/git dependencies
# - Stale authority docs
# - Broken dependency linkage
#
# Usage:
#   ./verify-compute-contract.sh --static    # Static checks only (no Rust required)
#   ./verify-compute-contract.sh --cargo     # Cargo checks only (requires Rust)
#   ./verify-compute-contract.sh             # Both static and cargo checks
#
# Exit Codes:
#   0: All contracts pass (or only warnings)
#   1: Critical contract failure

# ---- Colors ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ---- Counters ----
ERRORS=0
WARNS=0
PASSED=0

# ---- Helpers ----
pass() {
  echo -e "${GREEN}[PASS]${NC} $1"
  PASSED=$((PASSED + 1))
}

warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
  WARNS=$((WARNS + 1))
}

error() {
  echo -e "${RED}[ERROR]${NC} $1"
  ERRORS=$((ERRORS + 1))
}

info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

# ---- Argument Parsing ----
MODE="both"
for arg in "$@"; do
  case "$arg" in
    --static)
      MODE="static"
      ;;
    --cargo)
      MODE="cargo"
      ;;
    *)
      echo "Usage: $0 [--static|--cargo]"
      exit 1
      ;;
  esac
done

# ---- Contract 1: Real Submodule (gitlink + .gitmodules) ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 1: Real Submodule ==="

  # Check .gitmodules exists
  if [ -f ".gitmodules" ]; then
    pass ".gitmodules exists"
  else
    error ".gitmodules missing"
  fi

  # Check gitlink exists (160000 mode in git ls-files)
  if git ls-files --stage 2>/dev/null | grep -q "^160000.*packages/mlx-rs-fork"; then
    pass "packages/mlx-rs-fork has gitlink (real submodule)"
  else
    error "packages/mlx-rs-fork missing gitlink (fake submodule)"
  fi

  # Check submodule is initialized (gitlink is a file, not a directory)
  if [ -e "packages/mlx-rs-fork/.git" ]; then
    pass "packages/mlx-rs-fork/.git exists (initialized)"
  else
    error "packages/mlx-rs-fork/.git missing (not initialized)"
  fi
fi

# ---- Contract 2: Nested Submodule (mlx-c-fork) ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 2: Nested Submodule (mlx-c-fork) ==="

  # Check nested submodule exists
  if [ -d "packages/mlx-rs-fork/mlx-sys/src/mlx-c" ]; then
    pass "packages/mlx-rs-fork/mlx-sys/src/mlx-c exists"
  else
    error "packages/mlx-rs-fork/mlx-sys/src/mlx-c missing"
  fi

  # Check nested submodule is initialized (gitlink is a file, not a directory)
  if [ -e "packages/mlx-rs-fork/mlx-sys/src/mlx-c/.git" ]; then
    pass "packages/mlx-rs-fork/mlx-sys/src/mlx-c/.git exists (initialized)"
  else
    error "packages/mlx-rs-fork/mlx-sys/src/mlx-c/.git missing (not initialized)"
  fi

  # Check critical files exist
  if [ -f "packages/mlx-rs-fork/mlx-sys/src/mlx-c/CMakeLists.txt" ]; then
    pass "CMakeLists.txt exists in mlx-c-fork"
  else
    error "CMakeLists.txt missing in mlx-c-fork"
  fi

  if [ -f "packages/mlx-rs-fork/mlx-sys/src/mlx-c/mlx/c/mlx.h" ]; then
    pass "mlx.h exists in mlx-c-fork"
  else
    error "mlx.h missing in mlx-c-fork"
  fi
fi

# ---- Contract 3: Path Dependencies (No Git Dependencies) ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 3: Path Dependencies ==="

  # Check Cargo.toml uses path dependencies
  if grep -q 'mlx-rs = { path = "../mlx-rs-fork/mlx-rs"' packages/compute-native/Cargo.toml; then
    pass "mlx-rs uses path dependency"
  else
    error "mlx-rs does not use path dependency (check for git dependency)"
  fi

  if grep -q 'mlx-sys = { path = "../mlx-rs-fork/mlx-sys"' packages/compute-native/Cargo.toml; then
    pass "mlx-sys uses path dependency"
  else
    error "mlx-sys does not use path dependency (check for git dependency)"
  fi

  # Check no git dependencies for mlx-rs/mlx-sys
  if grep -q 'mlx-rs = { git = ' packages/compute-native/Cargo.toml; then
    error "mlx-rs still uses git dependency (should be path)"
  fi

  if grep -q 'mlx-sys = { git = ' packages/compute-native/Cargo.toml; then
    error "mlx-sys still uses git dependency (should be path)"
  fi
fi

# ---- Contract 4: No Duplicate Dependencies in compute-core ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 4: No Duplicate Dependencies ==="

  # Check compute-core does not declare mlx-rs or mlx-sys as non-workspace dependencies
  if grep -q '^mlx-rs = { path = ' packages/compute-native/compute-core/Cargo.toml; then
    error "compute-core/Cargo.toml declares mlx-rs with path dependency (should inherit from workspace)"
  elif grep -q '^mlx-rs = { git = ' packages/compute-native/compute-core/Cargo.toml; then
    error "compute-core/Cargo.toml declares mlx-rs with git dependency (should inherit from workspace)"
  else
    pass "compute-core does not declare mlx-rs directly"
  fi

  if grep -q '^mlx-sys = { path = ' packages/compute-native/compute-core/Cargo.toml; then
    error "compute-core/Cargo.toml declares mlx-sys with path dependency (should inherit from workspace)"
  elif grep -q '^mlx-sys = { git = ' packages/compute-native/compute-core/Cargo.toml; then
    error "compute-core/Cargo.toml declares mlx-sys with git dependency (should inherit from workspace)"
  else
    pass "compute-core does not declare mlx-sys directly"
  fi

  # Check compute-core uses workspace dependencies
  if grep -q 'mlx-rs = { workspace = true }' packages/compute-native/compute-core/Cargo.toml; then
    pass "compute-core inherits mlx-rs from workspace"
  else
    warn "compute-core does not inherit mlx-rs from workspace (check for explicit dependency)"
  fi

  if grep -q 'mlx-sys = { workspace = true }' packages/compute-native/compute-core/Cargo.toml; then
    pass "compute-core inherits mlx-sys from workspace"
  else
    warn "compute-core does not inherit mlx-sys from workspace (check for explicit dependency)"
  fi
fi

# ---- Contract 5: Authority Docs Exist ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 5: Authority Docs ==="

  if [ -f "packages/compute-native/AUTHORITY.md" ]; then
    pass "AUTHORITY.md exists"
  else
    warn "AUTHORITY.md missing"
  fi

  if [ -f "packages/compute-native/DEPENDENCY_LINKAGE.md" ]; then
    pass "DEPENDENCY_LINKAGE.md exists"
  else
    warn "DEPENDENCY_LINKAGE.md missing"
  fi
fi

# ---- Contract 6: Authority Docs Consistent ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 6: Authority Docs Consistency ==="

  # Check AUTHORITY.md declares packages/compute-native as canonical
  if grep -q "packages/compute-native" packages/compute-native/AUTHORITY.md; then
    pass "AUTHORITY.md references packages/compute-native"
  else
    error "AUTHORITY.md does not reference packages/compute-native as canonical"
  fi

  # Check AUTHORITY.md does not declare Tribunus-Compute as canonical
  if grep -q "Canonical: Tribunus-Compute" packages/compute-native/AUTHORITY.md; then
    error "AUTHORITY.md incorrectly declares Tribunus-Compute as canonical"
  else
    pass "AUTHORITY.md does not declare Tribunus-Compute as canonical"
  fi
fi

# ---- Contract 7: CI Submodule Checkout ----
if [ "$MODE" = "static" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 7: CI Submodule Checkout ==="

  # Check compute-authority-validation.yml uses submodules: recursive
  if grep -q "submodules: recursive" .github/workflows/compute-authority-validation.yml; then
    pass "CI workflow uses submodules: recursive"
  else
    error "CI workflow missing submodules: recursive"
  fi

  # Check CI workflow has submodule verification step
  if grep -q "git submodule status --recursive" .github/workflows/compute-authority-validation.yml; then
    pass "CI workflow has submodule verification step"
  else
    warn "CI workflow missing explicit submodule verification step"
  fi
fi

# ---- Contract 8: Dependency Resolution (cargo metadata) ----
if [ "$MODE" = "cargo" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 8: Dependency Resolution ==="

  # Try cargo metadata --locked (may fail in sandbox, but we attempt it)
  if command -v cargo &> /dev/null; then
    if (cd packages/compute-native && cargo metadata --locked --format-version 1 &> /dev/null); then
      pass "cargo metadata --locked succeeds"
    else
      # Try without --locked (may work if lockfile is stale but dependencies resolve)
      if (cd packages/compute-native && cargo metadata --format-version 1 &> /dev/null); then
        warn "cargo metadata succeeds but --locked fails (lockfile may need update)"
      else
        error "cargo metadata fails (dependency resolution broken)"
      fi
    fi
  else
    warn "cargo not found in PATH (cannot verify dependency resolution)"
  fi
fi

# ---- Contract 9: Build Verification (cargo check) ----
if [ "$MODE" = "cargo" ] || [ "$MODE" = "both" ]; then
  info "=== Contract 9: Build Verification ==="

  if command -v cargo &> /dev/null; then
    if (cd packages/compute-native && cargo check --locked &> /dev/null); then
      pass "cargo check --locked succeeds"
    else
      # Try without --locked
      if (cd packages/compute-native && cargo check &> /dev/null); then
        warn "cargo check succeeds but --locked fails (lockfile may need update)"
      else
        error "cargo check fails (build broken)"
      fi
    fi
  else
    warn "cargo not found in PATH (cannot verify build)"
  fi
fi

# ---- Summary ----
echo ""
info "=== Summary ==="
echo "Passed: $PASSED"
echo "Warnings: $WARNS"
echo "Errors: $ERRORS"

if [ $ERRORS -gt 0 ]; then
  echo -e "${RED}Contract verification FAILED${NC}"
  exit 1
elif [ $WARNS -gt 0 ]; then
  echo -e "${YELLOW}Contract verification PASSED with warnings${NC}"
  exit 0
else
  echo -e "${GREEN}Contract verification PASSED${NC}"
  exit 0
fi
