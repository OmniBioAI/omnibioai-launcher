#!/usr/bin/env bash
# Regression test for the monocle3 installation path in docker/rstudio/Dockerfile.
#
# monocle3 is not a CRAN/Bioconductor package, so it can never be obtained
# through BiocManager::install(). This test does not rebuild the image (that
# is covered separately by the native arm64 build + runtime smoke); it only
# proves the *mechanism* in source is still correct:
#   1. monocle3 is not requested via the Bioconductor-only install path.
#   2. monocle3, and its two required GitHub Remotes (BPCells, speedglm), are
#      each pinned to a full 40-character immutable commit SHA.
#   3. No floating ref (@main/@master/@HEAD, or an unpinned bare repo) is used
#      for any of the three.
#   4. monocle3 remains present in the Dockerfile's intended package
#      inventory (this is a reproducibility fix, not a removal).
#   5. The install mechanism is architecture-neutral: a single RUN line with
#      no per-arch branching, so it applies identically to amd64 and arm64.
set -euo pipefail

DOCKERFILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/Dockerfile"
fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "PASS: $1"; }

[ -f "$DOCKERFILE" ] || fail "docker/rstudio/Dockerfile not found"

# 1. monocle3 must not appear inside a BiocManager::install(...) call.
bioc_block="$(sed -n '/^RUN R -e "BiocManager::install(/,/))"/p' "$DOCKERFILE")"
[ -n "$bioc_block" ] || fail "no BiocManager::install() call found to inspect"
if echo "$bioc_block" | grep -q "monocle3"; then
  fail "monocle3 is still requested via BiocManager::install() (invalid path -- monocle3 is not a Bioconductor package)"
fi
pass "monocle3 is not requested through BiocManager::install()"

# 2/3. Each of the three GitHub installs must use install_github() with an
# explicit ref pinned to a full 40-character hex commit SHA, and none may
# reference a floating branch/HEAD ref.
for repo in "bnprks/BPCells" "cole-trapnell-lab/speedglm" "cole-trapnell-lab/monocle3"; do
  line="$(grep -n "install_github('$repo'" "$DOCKERFILE" || true)"
  [ -n "$line" ] || fail "no pinned install_github() call found for $repo"

  if ! echo "$line" | grep -Eq "ref = '[0-9a-f]{40}'"; then
    fail "$repo is not pinned to a full 40-character immutable commit SHA: $line"
  fi
  pass "$repo is pinned to a 40-character commit SHA"
done

if grep -Eiq "install_github\([^)]*(@main|@master|@HEAD)" "$DOCKERFILE"; then
  fail "a floating GitHub ref (@main/@master/@HEAD) was found in the Dockerfile"
fi
pass "no floating GitHub ref (@main/@master/@HEAD) present"

# 4. monocle3 must still be present in the file as an intended package --
# this is a reproducibility fix, not a removal of the dependency.
grep -q "monocle3" "$DOCKERFILE" || fail "monocle3 is no longer referenced anywhere in the Dockerfile"
pass "monocle3 remains in the intended package inventory"

# 5. Architecture-neutral install mechanism: the install_github block must
# not branch on TARGETARCH/BUILDARCH or any other per-arch condition.
if grep -Eiq "TARGETARCH|BUILDARCH" "$DOCKERFILE"; then
  fail "install mechanism branches on build architecture; it must be identical for amd64 and arm64"
fi
pass "install mechanism contains no architecture-specific branching"

echo "ALL MONOCLE3 PIN REGRESSION CHECKS PASSED"
