# OmniBioAI Launcher

A browser-based gateway to interactive analysis environments for the OmniBioAI platform.
The launcher operates in two independent modes: opening a specific registry object in your
preferred IDE, and starting/stopping long-running IDE services backed by Docker containers.

This repository is intentionally separate from
[omnibioai-sdk](https://github.com/man4ish/omnibioai_sdk), the pure Python API client.
The launcher is the browser entry point; the SDK is for programmatic use inside notebooks
and scripts.

---

## Overview

| Mode | What it does |
|---|---|
| **Object Launch** | Browse the registry, select an object, open it in JupyterLab, VS Code, or RStudio with context pre-loaded |
| **IDE Services** | Start / stop containerised JupyterLab, RStudio, and VS Code Server from the Launcher UI |

The two modes are independent — IDE Services can be used without an object context, and
Object Launch works with any running JupyterLab instance.

---

## Supported Environments

| Environment | Description | Default port |
|---|---|---|
| **JupyterLab** | Full bioinformatics kernel (scanpy, DESeq2, scVelo, cellxgene …) | 8888 |
| **RStudio** | R with Bioconductor — Seurat, DESeq2, scran, monocle3, tidyverse | 8787 |
| **VS Code Server** | Python + R + Nextflow + WDL extensions, all packages from above | 8080 |

---

## Running in OmniBioAI Stack (recommended)

The Launcher is managed automatically by OmniBioAI Studio.
No manual startup required — it starts with the full stack:

```bash
cd ~/Desktop/machine/omnibioai-studio
docker compose up -d launcher
```

Access at: `http://localhost/_svc/sdk` (via nginx, JWT required)
Direct access (localhost only): `http://localhost:5190`

The Launcher backend API runs on port 3001 internally.
IDE container lifecycle (start/stop/status) is handled via
the Docker socket — no additional configuration needed.

---

## Quick Start — IDE Services

The fastest way to get all three environments running locally:

```bash
# Clone and start
git clone https://github.com/man4ish/omnibioai-launcher.git
cd omnibioai-launcher
docker-compose up -d
```

| Service | URL | Default credential |
|---|---|---|
| JupyterLab     | http://localhost:8888 | token: `$JUPYTER_TOKEN` (set in .env)    |
| RStudio        | http://localhost:8787 | password: `$RSTUDIO_PASSWORD` (set in .env) |
| VS Code Server | http://localhost:8080 | password: `$VSCODE_PASSWORD` (set in .env)  |

Stop all services:

```bash
docker-compose down
```

Override credentials or data paths with environment variables:

```bash
JUPYTER_TOKEN=mysecret OMNIBIOAI_DATA_DIR=/data/myproject docker-compose up -d
```

---

## Quick Start — Object Launch

The Launcher UI is a React single-page app served on port 5190.

**With a running backend:**

```bash
cp .env.example .env    # fill in REACT_APP_OMNIBIOAI_BASE_URL and token
npm install
npm start               # dev server at http://localhost:3000
```

**Via Docker:**

```bash
docker build -t omnibioai-launcher .
docker run -p 5190:5190 omnibioai-launcher
```

**Direct link from any page:**

```html
<a href="http://127.0.0.1:5190/?object_id=56d3fc3a-709b-4ed0-bf17-8cb73c6746b0">Analyze</a>
```

If no `object_id` is given, the app opens a searchable registry list. Selecting an object
shows a detail view (metadata, lineage, job log) and a button to open it in an environment.

---

## Pre-installed Packages

### JupyterLab (`docker/jupyter/Dockerfile`)

Base image: `jupyter/datascience-notebook:latest`

**Python** — scanpy, anndata, scVelo, squidpy, pyDEA, gseapy, biopython, pysam,
cellxgene, leidenalg, harmonypy, decoupler, pydeseq2, omnipath

**R / Bioconductor (via conda)** — DESeq2, edgeR, limma, Seurat

### RStudio (`docker/rstudio/Dockerfile`)

Base image: `rocker/rstudio:4.3.2`

**Bioconductor** — DESeq2, edgeR, limma, Seurat, clusterProfiler, EnhancedVolcano,
ComplexHeatmap, SingleCellExperiment, scran, scater, monocle3

**CRAN** — tidyverse, ggplot2, pheatmap, RColorBrewer, patchwork, cowplot

### VS Code Server (`docker/vscode/Dockerfile`)

Base image: `codercom/code-server:latest`

**Extensions** — ms-python.python, REditorSupport.r, nextflow-io.nf-lang, broadinstitute.wdl

**Python packages** — scanpy, anndata, scVelo, pydeseq2, gseapy, biopython, pysam

---

## Architecture

```
OmniBioAI Studio
      |
Launcher UI  (React, port 5190)
      |
  ┌───┴──────────────────────────┐
  │  Object Launch               │  IDE Services
  │  (registry object context)   │  (container lifecycle)
  └───┬──────────────────────────┘
      |                                  |
  Open object in:               docker-compose up/down
  - JupyterLab  (URL + token)   GET  /api/launcher/status/{tool}
  - VS Code     (env var copy)  POST /api/launcher/start/{tool}
  - RStudio     (.R download)   POST /api/launcher/stop/{tool}
```

The `IdeCard` component in the Launcher UI polls `GET /api/launcher/status/{tool}` every
5 seconds. Clicking **Launch** calls `POST /api/launcher/start/{tool}`, polls until the
container reports `running`, then opens the service URL in a new tab. A **Stop** button
appears while the container is running.

### OmniBioAI nginx routing

In production the Launcher is accessed via nginx:

```
http://localhost/_svc/sdk  →  launcher:5190  (JWT required)
```

The `/api/launcher/*` endpoints are proxied to the Express backend
on port 3001 inside the container.

---

## API Endpoints

### Object registry (existing)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/dev/objects/` | Paginated object list (`search`, `type` filters) |
| `GET` | `/api/dev/objects/{id}/` | Single object detail |
| `GET` | `/api/dev/objects/?parent_id={id}` | Children / siblings for lineage view |
| `POST` | `/api/dev/launch/rstudio/` | Signal backend to open RStudio after R script download |

### IDE services (new)

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/launcher/status/{tool}` | Container status (`running` / `starting` / `stopped`) |
| `POST` | `/api/launcher/start/{tool}` | Start the IDE container |
| `POST` | `/api/launcher/stop/{tool}` | Stop the IDE container |

`{tool}` is one of `jupyter`, `rstudio`, `vscode`.

All requests carry `Authorization: Bearer <token>`.

---

## Docker Images

Pre-built images are published to the GitHub Container Registry:

```
ghcr.io/omnibioai/omnibioai-jupyter:1.0
ghcr.io/omnibioai/omnibioai-rstudio:1.0
ghcr.io/omnibioai/omnibioai-vscode:1.0
```

To rebuild and push:

```bash
export CR_PAT=$(gh auth token)
echo $CR_PAT | docker login ghcr.io -u man4ish --password-stdin

for tool in jupyter rstudio vscode; do
  docker build \
    -t ghcr.io/omnibioai/omnibioai-${tool}:1.0 \
    -f docker/${tool}/Dockerfile docker/${tool}/
  docker push ghcr.io/omnibioai/omnibioai-${tool}:1.0
done
```

---

## Environment Variables

### Launcher UI (baked in at build time, prefixed `REACT_APP_`)

| Variable | Default | Purpose |
|---|---|---|
| `REACT_APP_OMNIBIOAI_BASE_URL` | `http://127.0.0.1:8000` | OmniBioAI backend API base URL |
| `REACT_APP_OMNIBIOAI_TOKEN` | `dev` | Bearer token for all API requests |
| `REACT_APP_JUPYTER_BASE` | `http://127.0.0.1:8890` | JupyterLab host for object-launch URL |
| `REACT_APP_JUPYTER_TOKEN` | `devtoken` | JupyterLab auth token (`?token=`) |
| `REACT_APP_USE_MOCK` | `false` | Use hardcoded mock data without a backend |

### docker-compose services (runtime)

| Variable | Default | Purpose |
|---|---|---|
| `JUPYTER_TOKEN` | `omnibioai` | JupyterLab authentication token |
| `RSTUDIO_PASSWORD` | `omnibioai` | RStudio login password |
| `VSCODE_PASSWORD` | `omnibioai` | VS Code Server login password |
| `OMNIBIOAI_DATA_DIR` | `./data` | Host path mounted as `/data` in all containers |
| `OMNIBIOAI_WORK_DIR` | `./work` | Host path mounted as `/work` in all containers |

> **Security note:** `JUPYTER_TOKEN`, `RSTUDIO_PASSWORD`, and
> `VSCODE_PASSWORD` default to `omnibioai`. Change these in
> `omnibioai-studio/.env` before production use.

---

## Development

```bash
cp .env.example .env    # edit variables for your local setup
npm install
npm start               # dev server on http://localhost:3000
```

The `proxy` field in `package.json` forwards `/api/*` calls to `http://127.0.0.1:8000`,
so the OmniBioAI backend must be running locally during development.

**Production build:**

```bash
npm run build
# serve the build/ output with any static file server
npx serve -s build -l 5190
```

**Launcher Docker image** (nginx, port 5190):

```bash
docker build -t omnibioai-launcher .

# Override backend at build time
docker build \
  --build-arg REACT_APP_OMNIBIOAI_BASE_URL=https://api.omnibioai.com \
  --build-arg REACT_APP_OMNIBIOAI_TOKEN=mytoken \
  -t omnibioai-launcher .

docker run -p 5190:5190 omnibioai-launcher
```

---

## Mock Mode

Set `REACT_APP_USE_MOCK=true` (or pass `?object_id=test` in the URL) to run entirely on
hardcoded data without a backend. Useful for UI development and screenshots.

---

## Project Structure

```
omnibioai-launcher/
├── docker/
│   ├── jupyter/
│   │   └── Dockerfile          — JupyterLab + bioinformatics packages
│   ├── rstudio/
│   │   └── Dockerfile          — RStudio + Bioconductor stack
│   └── vscode/
│       └── Dockerfile          — VS Code Server + Python/R/workflow extensions
├── src/
│   ├── App.jsx                 — View logic: list, detail, launcher
│   ├── App.css                 — Dark-theme styles
│   ├── index.js                — React root mount
│   └── components/
│       ├── EnvCard.jsx         — Clickable environment tile (object launch)
│       ├── IdeCard.jsx         — IDE service card with status polling
│       ├── ObjectCard.jsx      — Object metadata display
│       ├── InstallModal.jsx    — Fallback modal when desktop app not found
│       └── Toast.jsx           — Ephemeral status notification
├── public/
│   └── index.html
├── docker-compose.yml          — IDE services orchestration
├── .env.example
├── package.json
├── nginx.conf
└── Dockerfile                  — Launcher UI (React → nginx)
```

---

## Related Services

| Service | Role |
|---------|------|
| `omnibioai-studio` | Manages Launcher container lifecycle |
| `omnibioai` | Workbench backend — object registry API |
| `omnibioai-api-gateway` | JWT enforcement on `/_svc/sdk` |
| `omnibioai-control-center` | Health monitoring (launcher:5190) |
| `omnibioai-sdk` | Python SDK client — programmatic alternative to Launcher UI |

---

## License

Apache License 2.0
