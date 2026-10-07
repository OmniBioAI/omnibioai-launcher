# OmniBioAI Launcher

OmniBioAI Launcher provisions and controls authorized interactive scientific workspaces. Its boundary is:

```text
OmniBioAI object or workspace request
  -> validated workspace specification
  -> compatible configured environment
  -> authorized interactive workspace
```

Launcher is not Studio, an IAM service, a workflow engine, a registry, TES, ToolServer, RAG, or a dependency solver. Those systems remain authoritative for their own data and authorization decisions.

## Architecture inventory

- **Frontend:** Create React App / React 18 single-page UI. It browses Studio-owned `/api/dev/objects/*` routes, displays object details and lineage, opens JupyterLab/RStudio/VS Code or the workspace Terminal, and exposes progressive workspace profile/resource controls.
- **Backend:** a small Express server on port `3001`, reverse-proxied by the image's nginx server on port `5190`.
- **Container model:** three fixed, pre-created containers: `omnibioai-jupyter`, `omnibioai-rstudio`, and `omnibioai-vscode`. Terminal is a workspace-scoped interface backed by the existing VS Code Server container's integrated terminal; it does not create a host shell or a fourth container. Launcher does not accept container names, Docker arguments, mounts, devices, or privileged flags from clients.
- **Docker integration:** HTTP over `DOCKER_SOCKET_PATH`; Studio normally supplies a restricted socket proxy. Legacy lifecycle routes inspect/start/stop containers. The v1 workspace route also applies validated CPU and memory limits before start.
- **Authentication:** every Launcher backend route validates the caller's bearer token with IAM's `/auth/validate`. Missing/invalid credentials and IAM outages deny access.
- **Authorization:** status/profile/manifest reads require a valid identity. Lifecycle mutations require `platform.manage_infra`. Manifest reads additionally match both authoritative user and organization identifiers.
- **Studio integration:** Studio owns routing, the fixed IDE containers, their credentials/mounts, and the socket proxy. Launcher does not duplicate those responsibilities.

Terminal means CLI access within the authorized workspace container and its existing project directory. It is not host shell access, Docker host access, Docker socket access, or a privileged infrastructure shell. It inherits the same IAM identity, organization/user context, profile, object-reference policy, compute limits, and storage boundary as the other workspace environments.

### UI visual source

The Launcher UI follows the locally available OmniBioAI platform sources: `omnibioai-design-tokens/tokens.css` and Studio's shared `UI.jsx`, `OmniPage`, `Launch`, and `IdeServices` patterns. It uses the same near-black shell, elevated dark panels, translucent borders, compact mono labels, emerald primary actions, informational blue, status badges, 6–14px radii, and 767px responsive stacking convention. The relevant tokens are reproduced locally in `src/App.css`; the Launcher does not import sibling repositories at runtime.

The default page is the workspace builder. The existing object registry remains available from **Browse object registry**, and direct `?object_id=...` links retain the legacy object-launch flow.

### Existing compatibility routes

| Method | Route | Behavior |
|---|---|---|
| `GET` | `/api/launcher/status/:tool` | Read fixed container status |
| `POST` | `/api/launcher/start/:tool` | Start a fixed container |
| `POST` | `/api/launcher/stop/:tool` | Stop a fixed container |

The legacy `tool` values remain `jupyter`, `rstudio`, and `vscode`; those routes and response shapes are unchanged. Terminal uses the same lifecycle route shape with `tool=terminal` and resolves to the existing VS Code Server container.

The frontend also consumes APIs owned by the configured OmniBioAI backend, not this Express server:

- `GET /api/dev/objects/`
- `GET /api/dev/objects/:id/`
- `GET /api/dev/objects/?parent_id=:id`

The workspace builder routes `/api/launcher/*` through this Launcher service's same-origin mount (`/_svc/sdk` in Studio, or the origin root when opened directly on port `5190`). It does not send workspace lifecycle requests to the Workbench API base used by the legacy object registry.

## Implemented workspace foundation

### Canonical workspace specification

`POST /api/launcher/v1/workspaces/validate` validates a request and resolves a compatible configured candidate without changing Docker state. `POST /api/launcher/v1/workspaces` validates, resolves, inspects the image architecture, applies bounded CPU/memory controls, starts the fixed container, and returns a manifest.

The client may provide only workspace name/id/profile, environment (`jupyterlab`, `rstudio`, `vscode`, or `terminal`), an optional exact image constraint, CPU, memory bytes, GPU count, architecture (`amd64` or `arm64`), and canonical object references.

User and organization identity always come from verified IAM output. Unknown fields are rejected, including client-supplied identity, Docker arguments, mounts, devices, and privilege settings.

### Workspace profiles

`GET /api/launcher/v1/profiles` returns the declarative profiles and current resource ceilings:

- Generic Python
- Generic R
- RNA-seq
- Single-cell
- Variant analysis
- Proteomics
- ML/AI development

Profiles define preferred IDE, recommended resources, required capabilities, and nonsensitive environment metadata. They do not hard-code or guess container images. Specialized profiles fail closed unless configuration declares a candidate with every required capability.

### Object references

The strict canonical forms are:

```text
omnibioai://dataset/<id>
omnibioai://workflow/<id>
omnibioai://model/<id>
omnibioai://run/<id>
omnibioai://tool/<id>
```

Parsing an object reference never grants access. Object-aware provisioning currently returns `501` because this repository has no verified object-authorization service contract. Existing frontend object opening remains available and continues to rely on the authoritative backend and IDE authentication.

### Environment resolution

Resolution is deterministic and local/config-backed. With no configuration, candidates point only at the three existing fixed containers, advertise their basic language capability, and use the host architecture. For explicit deployment metadata, set `LAUNCHER_ENVIRONMENTS_JSON` to an array such as:

```json
[
  {
    "id": "local-python",
    "ide": "jupyterlab",
    "container": "omnibioai-jupyter",
    "architectures": ["amd64"],
    "capabilities": ["python"],
    "gpu_available": 0,
    "image_reference": "operator-verified/reference:tag",
    "image_digest": "sha256:<64 lowercase hex characters>",
    "environment": { "channel": "validated" }
  }
]
```

The example intentionally uses a placeholder rather than claiming an unverified published image. Candidate container names remain allowlisted. A client image constraint must exactly match a configured candidate. At launch, Docker image metadata must confirm the requested architecture; ambiguity or mismatch denies the launch.

GPU requests never assume CUDA or inject a device request. They resolve only when an operator-configured candidate declares sufficient availability and Docker inspection confirms enough pre-provisioned `gpu` device requests; otherwise resolution fails closed.

### Reproducible manifests

Successful v1 launches return a schema `1.0` manifest containing workspace/profile/environment, resolved image and digest when available, architecture/resources, canonical object references, authoritative user and organization, timestamp, launcher version, candidate provenance, and allowlisted scalar environment metadata.

`GET /api/launcher/v1/workspaces/:workspaceId/manifest` returns an in-memory manifest only to the same user in the same organization. Serialization/deserialization is strict and rejects secret-like fields. Tokens, passwords, credentials, API keys, arbitrary headers, and private keys are never manifest fields.

Current limitation: manifest storage is process-local and is lost on restart. Durable export/recreate/audit storage is planned behind a verified service contract.

### Run to Debug Workspace

`POST /api/launcher/v1/workspaces/from-run` defines the authenticated contract with a single `run_reference`. The implemented boundary strictly parses a `run` URI and requires an authorization callback before metadata resolution. No authoritative run authorization or metadata contract exists in this repository, so the HTTP route currently returns `501` and never fabricates run metadata.

Planned flow:

```text
run reference -> service authorization -> run metadata resolver
              -> workspace specification -> environment resolver -> launcher
```

## Security model

- IAM validation and lifecycle permission checks fail closed.
- Authoritative identity overrides are impossible because unknown request fields are rejected.
- Both user and organization ownership are checked for manifests; cross-tenant misses return `404`.
- Resource values have server-configured bounds and are converted only to fixed Docker `NanoCpus` and `Memory` fields.
- Container names, mounts, paths, devices, privileged mode, and arbitrary Docker options are not client-controlled.
- Object/run identifiers are context, not authorization.
- Images use a strict reference grammar; client constraints cannot introduce a new candidate.
- Browser build configuration is public-only. The security build test rejects secret-looking `REACT_APP_*` variables and scans emitted bundles/source maps.
- CORS is permissive for bearer-header clients. Deployments must not expose IDE services without their own authentication and trusted routing.

## Configuration

### Browser build-time (public values only)

| Variable | Default | Purpose |
|---|---|---|
| `REACT_APP_OMNIBIOAI_BASE_URL` | `http://127.0.0.1:8000` | Backend/API gateway base URL |
| `REACT_APP_JUPYTER_BASE` | `http://127.0.0.1:8890` | Hostname source for object launch |
| `REACT_APP_USE_MOCK` | `false` | Local mock object data |

Create React App embeds these in public JavaScript. Never put credentials in a `REACT_APP_*` variable.

### Backend runtime

| Variable | Default | Purpose |
|---|---|---|
| `IAM_URL` | `http://auth-service:8001` | IAM validation service |
| `DOCKER_SOCKET_PATH` | `/var/run/proxy-socket/docker.sock` | Restricted Docker API socket |
| `LAUNCHER_VERSION` | `0.1.0` | Manifest provenance version |
| `LAUNCHER_ENVIRONMENTS_JSON` | fixed local candidates | Validated environment catalog |
| `WORKSPACE_MAX_CPU` | `16` | Maximum requested CPU |
| `WORKSPACE_MAX_MEMORY_BYTES` | `68719476736` | Maximum requested memory |
| `WORKSPACE_MAX_GPU` | `8` | Maximum request; availability is separately candidate-bound |

Studio owns IDE credentials, host directories, container creation, and mounts. They are not Launcher request fields and are never stored in manifests.

## Development and tests

```bash
npm ci
CI=true npm test -- --runInBand
npm run test:security
npm run build
```

`npm run test:security` performs production builds with synthetic sentinels. It never uses real secrets.

The main image is built by the repository workflow as `ghcr.io/omnibioai/omnibioai-launcher`. The repository also contains an explicit workflow for the VS Code and RStudio runtimes. This README does not claim JupyterLab GHCR artifacts are published because no authoritative publishing workflow for that image is currently present. RStudio's workflow exists but has not yet completed a controlled multiarch publication; do not treat its presence as proof of a published artifact.

## Current limitations and deferred work

Implemented today: validation/domain models, profiles, manifests, object URI parsing, local/config resolution, CPU/memory enforcement for stopped fixed containers, architecture verification, pre-provisioned GPU validation, IAM-derived identity, tenant-scoped reads, the Run-to-Debug interface boundary, and progressive UI controls.

Deferred until authoritative contracts and provisioning backends exist:

- object-service and run-service authorization/metadata integration;
- durable manifest storage and export/recreate/audit workflows;
- per-user container creation and true concurrent workspace isolation;
- Kubernetes, Slurm, AWS, and Azure provisioning;
- arbitrary package installation or dependency solving;
- AI-generated shell execution or workspace construction;
- workflow, registry, IAM, Studio, RAG, TES, or ToolServer functionality.

The fixed-container model is inherently shared infrastructure. `platform.manage_infra` remains required for mutation, and v1 refuses to alter resource limits while a shared container is running.

## Known technical debt

- The object-launch URL derives only the hostname from `REACT_APP_JUPYTER_BASE` and uses port `8888`.
- The IDE service component's VS Code URL uses port `8080`, while the backend/container convention is `8083`.
- Some legacy React async tests emit `act(...)` warnings despite passing.
- Create React App and its dependency tree report upstream audit findings; upgrading the frontend toolchain is separate from this bounded enhancement.
- Manifest persistence and per-user runtime isolation require a verified owning service/deployment contract.
- License metadata is inconsistent: no `LICENSE` file is tracked while workflow metadata says MIT.
