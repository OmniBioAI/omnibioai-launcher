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
  && rm -rf /var/lib/apt/lists/*
RUN R -e "install.packages(c('BiocManager','devtools'))"
RUN R -e "BiocManager::install(c( \
  'DESeq2','edgeR','limma','Seurat', \
  'clusterProfiler','EnhancedVolcano', \
  'ComplexHeatmap','SingleCellExperiment', \
  'scran','scater','monocle3'))"
RUN R -e "install.packages(c( \
  'tidyverse','ggplot2','pheatmap', \
  'RColorBrewer','patchwork','cowplot'))"
