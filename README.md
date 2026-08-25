# OmniBioAI Launcher

> README last reviewed: **2026-08-24**

A browser-based gateway to interactive analysis environments for the OmniBioAI platform.
The launcher operates in two independent modes: opening a specific registry object in your
preferred IDE, and starting/stopping long-running IDE services backed by Docker containers.

This repository is intentionally separate from
[omnibioai-sdk](https://github.com/OmniBioAI/omnibioai-sdk), the pure Python API client.
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
| **VS Code Server** | Python + R + Nextflow + WDL extensions, all packages from above | 8083 |

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

## Studio-managed IDE services

The supported full-stack deployment is managed by OmniBioAI Studio. Studio
owns the IDE containers and supplies the Docker socket access required by the
Launcher lifecycle API.

```bash
cd ~/Desktop/machine/omnibioai-studio
docker compose up -d launcher
```

| Service | URL | Default credential |
|---|---|---|
| JupyterLab     | http://localhost:8888 | token: `$JUPYTER_TOKEN` (set in .env)    |
| RStudio        | http://localhost:8787 | password: `$RSTUDIO_PASSWORD` (set in .env) |
| VS Code Server | http://localhost:8083 | password: `$VSCODE_PASSWORD` (set in .env)  |

The Launcher container exposes its browser UI on port `5190` and its internal
Express lifecycle API on port `3001`. The API is reached through nginx at
`/api/launcher/*`; port `3001` is not the public UI port.

Change `JUPYTER_TOKEN`, `RSTUDIO_PASSWORD`, `VSCODE_PASSWORD`, and data/work
directory variables in the Studio environment before deployment. Do not use
the development defaults in a shared or production environment.

---

## Quick Start — Object Launch

The Launcher UI is a React single-page app served on port 5190.

**With a running backend:**

```bash
npm install
REACT_APP_OMNIBIOAI_BASE_URL=http://127.0.0.1:8000 \
REACT_APP_OMNIBIOAI_TOKEN=dev \
npm start               # dev server at http://localhost:3000
```

Create a local `.env.local` instead if you do not want to put credentials in
the shell command. This repository does not currently include a committed
`.env.example` file.

**Via Docker:**

```bash
docker build -t omnibioai-launcher .
docker run \
  -p 5190:5190 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  omnibioai-launcher
```

The Docker socket mount is required only for IDE Services start/stop/status
operations. It grants the container substantial control over the host Docker
daemon; omit the lifecycle API or use the Studio-managed deployment when that
trust boundary is not acceptable.

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
  Open object in:               browser / desktop host
  - JupyterLab  (URL + token)   GET  /api/launcher/status/{tool}
  - VS Code     (env var copy)  POST /api/launcher/start/{tool}
  - RStudio     (.R download)   POST /api/launcher/stop/{tool}
```

The `IdeCard` component in the Launcher UI polls `GET /api/launcher/status/{tool}` every
5 seconds. Clicking **Launch** calls `POST /api/launcher/start/{tool}`, polls until the
container reports `running`, then opens the service URL in a new tab. A **Stop** button
appears while the container is running. The Express server talks directly to the
Docker socket; it does not proxy object-registry requests.

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

Object details can also generate and download an R starter script in the
browser. The current frontend does not call a separate RStudio launch API.

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

The Studio deployment may use pre-built images published to the GitHub
Container Registry:

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

### Launcher UI (baked into the bundle at build time, prefixed `REACT_APP_`)

| Variable | Default | Purpose |
|---|---|---|
| `REACT_APP_OMNIBIOAI_BASE_URL` | `http://127.0.0.1:8000` | OmniBioAI backend API base URL |
| `REACT_APP_OMNIBIOAI_TOKEN` | `dev` | Bearer token compiled into API requests |
| `REACT_APP_JUPYTER_BASE` | `http://127.0.0.1:8888` | JupyterLab host for object-launch URL |
| `REACT_APP_JUPYTER_TOKEN` | `devtoken` | JupyterLab auth token (`?token=`) |
| `REACT_APP_USE_MOCK` | `false` | Use hardcoded mock data without a backend |

These values are embedded by Create React App during `npm run build`; setting
them in a runtime container environment after the build does not change the
already-generated JavaScript. In particular, any
`REACT_APP_OMNIBIOAI_TOKEN` is recoverable by anyone who can download the
bundle. Never compile a privileged or production secret into the frontend.

### Studio Compose services (runtime)

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
npm install
npm start               # dev server on http://localhost:3000
```

The `proxy` field in `package.json` forwards `/api/*` calls to
`http://127.0.0.1:8000`, but the application normally uses the absolute
`REACT_APP_OMNIBIOAI_BASE_URL` value. Configure that value for the API Gateway
or backend you actually intend to use.

Run the test command with:

```bash
npm test
```

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
├── server.js                    — Express backend (port 3001): /api/launcher/*
│                                  (Docker socket container lifecycle)
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
