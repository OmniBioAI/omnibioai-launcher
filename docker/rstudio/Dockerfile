# OmniBioAI — Launcher RStudio (Jupyter Hardening)
# Purpose: Extend RStudio with R and Bioconductor analysis packages.
# Author: Manish Kumar <manish@omnibioai.org>

FROM rocker/rstudio:4.3.2
RUN R -e "install.packages(c('BiocManager','devtools'))"
RUN R -e "BiocManager::install(c( \
  'DESeq2','edgeR','limma','Seurat', \
  'clusterProfiler','EnhancedVolcano', \
  'ComplexHeatmap','SingleCellExperiment', \
  'scran','scater','monocle3'))"
RUN R -e "install.packages(c( \
  'tidyverse','ggplot2','pheatmap', \
  'RColorBrewer','patchwork','cowplot'))"
