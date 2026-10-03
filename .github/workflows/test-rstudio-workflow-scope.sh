#!/usr/bin/env bash
# Regression test proving publish-rstudio.yml cannot publish or reference
# the VS Code production image. This is a release-structure safety test,
# not an application test: the bug it guards against is docker-publish-
# specialized.yml's shared vscode+rstudio matrix, which would rebuild and
# push ghcr.io/omnibioai/omnibioai-vscode as an unauthorized side effect
# of any rstudio-only release dispatch.
set -euo pipefail

WORKFLOW="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/publish-rstudio.yml"
fail() { echo "FAIL: $1" >&2; exit 1; }
pass() { echo "PASS: $1"; }

[ -f "$WORKFLOW" ] || fail "publish-rstudio.yml not found"

if grep -qi "vscode" "$WORKFLOW"; then
  fail "publish-rstudio.yml references vscode -- it must publish only omnibioai-rstudio"
fi
pass "no vscode reference anywhere in publish-rstudio.yml"

image_lines="$(grep -c '^\s*IMAGE:\s*ghcr\.io/omnibioai/omnibioai-rstudio\s*$' "$WORKFLOW" || true)"
[ "$image_lines" -eq 1 ] || fail "expected exactly one IMAGE: env declaration pinned to omnibioai-rstudio, found $image_lines"
pass "exactly one IMAGE declared, pinned to ghcr.io/omnibioai/omnibioai-rstudio"

if grep -Eq "matrix:|strategy:" "$WORKFLOW"; then
  fail "publish-rstudio.yml must not use a build matrix -- a matrix is exactly the mechanism that let vscode piggyback on an rstudio-only dispatch in docker-publish-specialized.yml"
fi
pass "no matrix/strategy block present (single fixed image target)"

if grep -Eq "ghcr\.io/omnibioai/omnibioai-(jupyter|vscode|web|auth|control-center|model-registry|tes|lims|toolserver|rag|workflow-bundles|app|hpc-policy-engine|policy-engine|security-audit|videos|tool-images|dev-hub|license-server)\b" "$WORKFLOW"; then
  fail "publish-rstudio.yml references a second production image target"
fi
pass "no second production image target referenced"

echo "RSTUDIO_WORKFLOW_IMAGE_SCOPE=ghcr.io/omnibioai/omnibioai-rstudio"
echo "VSCODE_REFERENCE_IN_RSTUDIO_RELEASE_WORKFLOW=NO"
echo "ALL RSTUDIO WORKFLOW SCOPE-ISOLATION CHECKS PASSED"
