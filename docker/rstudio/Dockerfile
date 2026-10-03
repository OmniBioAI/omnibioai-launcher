# Pin the upstream multi-platform index; both native amd64 and arm64 children
# are present in this digest.
FROM rocker/rstudio@sha256:2f48314dfffab8ac2e1bc1797b0564b1f96927f702c064ab2cc69ce1b1c62016
# Required by the R/Bioconductor packages installed below (zlib/png/fontconfig/
# freetype/cairo for graphics packages, libxml2 for xml2, libgit2 for gert);
# without these headers the source builds below fail silently under
# install.packages() and the image ships without the requested packages.
RUN apt-get update && apt-get install -y --no-install-recommends \
    zlib1g-dev \
    libpng-dev \
    libfontconfig1-dev \
    libfreetype6-dev \
    libharfbuzz-dev \
    libfribidi-dev \
    libxml2-dev \
    libgit2-dev \
    libcairo2-dev \
    libglpk-dev \
    libtiff5-dev \
    libjpeg-dev \
    libhdf5-dev \
    libudunits2-dev \
    cmake \
    libgdal-dev \
    libgeos-dev \
    libproj-dev \
  && rm -rf /var/lib/apt/lists/*
RUN R -e "install.packages(c('BiocManager','devtools'))"
RUN R -e "BiocManager::install(c( \
  'DESeq2','edgeR','limma','Seurat', \
  'clusterProfiler','EnhancedVolcano', \
  'ComplexHeatmap','SingleCellExperiment', \
  'scran','scater'))"
RUN R -e "install.packages(c( \
  'tidyverse','ggplot2','pheatmap', \
  'RColorBrewer','patchwork','cowplot'))"
# monocle3 is not a CRAN/Bioconductor package (upstream distributes it only
# via GitHub), so it cannot be obtained through BiocManager::install() above.
# Each of the three calls below is pinned to an exact immutable commit SHA
# (never a branch/HEAD ref) resolved from upstream's own release evidence:
#   - monocle3 v1.4.27 release tag -> cole-trapnell-lab/monocle3
#   - BPCells v0.3.1 release tag (required, unpinned Remotes: entry in
#     monocle3's own DESCRIPTION) -> bnprks/BPCells, r/ subdirectory
#   - cole-trapnell-lab's speedglm fork (also an unpinned Remotes: entry in
#     monocle3's DESCRIPTION; upstream has no tags/releases at all, so the
#     exact current master-branch commit is pinned instead)
# Installing these two Remotes: dependencies first, at fixed commits, means
# monocle3's own install step finds them already satisfied and does not
# fall back to fetching their mutable default branches.
RUN R -e "remotes::install_github('bnprks/BPCells', subdir = 'r', ref = '841559adcdc7df764d825f4fde364f65911779b9', upgrade = 'never'); \
  remotes::install_github('cole-trapnell-lab/speedglm', ref = 'ca34b4e53319424b60c442bb550adf3574b4bfec', upgrade = 'never'); \
  remotes::install_github('cole-trapnell-lab/monocle3', ref = '536f1033d6de7c957f26a1f403f81efbd825e0db', upgrade = 'never')"
