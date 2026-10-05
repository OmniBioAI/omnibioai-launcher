# OmniBioAI — Launcher VS Code
# Purpose: Extend code-server with Python, R, and editor extensions.
# Author: Manish Kumar <manish@omnibioai.org>

# Pin the upstream multi-platform index while retaining native amd64 and
# arm64 child manifests.
FROM codercom/code-server@sha256:0c067c3cf09ed1830ce282387826be8feefef8a5828f462791c2df3f1007ee17
USER root
# System dependencies
RUN apt-get update && apt-get install -y \
    python3-pip r-base curl git && \
    rm -rf /var/lib/apt/lists/*
# Python dependencies
RUN pip install --break-system-packages --no-cache-dir \
    scanpy anndata scvelo pydeseq2 \
    gseapy biopython pysam
RUN code-server --install-extension ms-python.python 2>/dev/null || true
RUN code-server --install-extension REditorSupport.r 2>/dev/null || true
USER coder
