# OmniBioAI — Launcher Jupyter (RStudio Release)
# Purpose: Extend the Jupyter notebook image with Python and R bioinformatics packages.
# Author: Manish Kumar <manish@omnibioai.org>

# jupyter/datascience-notebook, tag r-4.3.1 / ubuntu-22.04 / lab-4.0.7 (same
# manifest list). Pinned by digest for reproducibility; verified multi-arch
# (linux/amd64 + linux/arm64) via Docker Hub manifest list on 2026-10-03.
FROM jupyter/datascience-notebook@sha256:476c6e673e7d5d8b5059f8680b1c6a988942a79263da651bf302dc696ab311f2

USER root

# Python dependencies
RUN pip install --no-cache-dir \
      scanpy==1.11.5 \
      anndata==0.12.19 \
      scvelo==0.3.4 \
      squidpy==1.8.2 \
      pydea==1.6 \
      gseapy==1.3.1 \
      biopython==1.88 \
      pysam==0.24.1 \
      cellxgene==1.3.0 \
      leidenalg==0.12.0 \
      harmonypy==2.0.2 \
      decoupler==2.2.0 \
      pydeseq2==0.5.4 \
      omnipath==1.0.12

# The pip install above pulls numpy 2.0.1, but the base image's conda-built
# h5py/pyarrow/numexpr/bottleneck (compiled against numpy 1.24.4) are left in
# place since pip's resolver treats any already-installed, unversioned copy
# as satisfying anndata/pandas/xarray's dependency on them. The result is a
# numpy ABI mismatch that passes the build but breaks at runtime: h5py hard
# crashes on import ("numpy.dtype size changed ... binary incompatibility"),
# and pyarrow/numexpr/bottleneck emit numpy's "compiled using NumPy 1.x ...
# may crash" warning on every import chain that touches them (all verified
# on an actual Python-kernel notebook run against a native arm64 build on
# 2026-10-03). Pinning numpy<2 instead -- to match what's already
# compiled -- was tried and rejected: pip's resolver backtracks across the
# whole scanpy/anndata/pandas tree trying to satisfy it and did not
# terminate in 10+ minutes, which is not viable for a CI build. Force-
# reinstalling current wheels (built against numpy's new ABI) for just
# these four packages is the targeted fix.
RUN pip install --no-cache-dir --force-reinstall --no-deps \
      h5py==3.16.0 pyarrow==25.0.1 numexpr==2.14.2 bottleneck==1.6.0

# jq is required by bioconda's bioconductor-genomeinfodbdata post-link script
# (invoked via yq); it isn't in the base image and the conda install below
# fails/rolls back without it (verified on a native linux/arm64 build on
# 2026-10-03). libhdf5-dev/libgsl-dev/libglpk-dev/cmake are needed to compile
# Seurat from source below.
RUN apt-get update && apt-get install -y --no-install-recommends \
      jq libhdf5-dev libgsl-dev libglpk-dev cmake \
    && rm -rf /var/lib/apt/lists/*

RUN conda install -y -c bioconda -c conda-forge \
      bioconductor-deseq2 bioconductor-edger bioconductor-limma \
    && conda clean -afy

# r-seurat has no linux-aarch64 build on bioconda (confirmed via the bioconda
# package API on 2026-10-03: only linux-64 and osx-64 files exist), so the
# conda install above would fail on a native arm64 build. Installed from CRAN
# instead so it compiles for whatever architecture the image is built on.
#
# Current SeuratObject/Seurat need Matrix >= 1.6.4, which itself needs R
# >= 4.4; this base image's conda-forge r-base is 4.3.1, and CRAN refuses to
# install any Matrix build against it (verified on a native arm64 build on
# 2026-10-03: "'Matrix' version 1.7-6 is in the repositories but depends on
# R (>= 4.4)"). Pinned to SeuratObject/Seurat 5.0.0 instead -- the last
# release line whose Matrix floor (>=1.6.1) the conda-shipped Matrix 1.6-1.1
# actually satisfies -- via remotes::install_version so dependency resolution
# can't silently pull a newer, incompatible SeuratObject. install.packages()
# also doesn't fail the shell when a dependency build fails (verified: an
# earlier version of this step exited 0 while Seurat was silently left
# uninstalled), so the explicit post-install load check is required too.
RUN R -e "install.packages('remotes', repos='https://cloud.r-project.org')" \
    && R -e "remotes::install_version('SeuratObject', version='5.0.0', repos='https://cloud.r-project.org', upgrade='never')" \
    && R -e "remotes::install_version('Seurat', version='5.0.0', repos='https://cloud.r-project.org', upgrade='never')" \
    && R -e "library(Seurat)"

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:8888/api >/dev/null || exit 1

USER ${NB_UID}
