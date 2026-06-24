# Deploying Skyward to Google Cloud

> **LIVE:** https://playskyward.ai
> (Cloud Run service `skyward`, project `<PROJECT_ID>`, region `us-central1`; the
> underlying service URL `https://<SERVICE_URL>` still works.)

Skyward deploys as **one single service**: the authoritative world server
(`server/world.mjs`) builds and serves the client (`dist/`) *and* runs the world — the
WebSocket world (20 Hz), accounts + proof-of-personhood, per-account durable save, the
`/legal/*` policy pages, the MCP endpoint (`/mcp`), and the REST/WS/A2A agent ingress —
all on one HTTPS/WSS origin. No separate static host, no CORS for the human client.

## Live infrastructure (already provisioned)

| Piece | Value |
|---|---|
| Cloud Run service | `skyward` (us-central1), `--min-instances=1 --max-instances=1 --no-cpu-throttling`, allow-unauthenticated |
| Canonical URL | `https://playskyward.ai` (+ `www`) — see [Custom domain](#custom-domain-cloud-dns) |
| Service URL | `https://<SERVICE_URL>` (Cloud Run default; still serves) |
| Database | Cloud SQL **Postgres 16**, instance `skyward-db` (tier `db-f1-micro`, **Enterprise** edition = the budget one), db + user `skyward`; connection `<CLOUD_SQL_CONNECTION>` |
| Secret | `DATABASE_URL` in **Secret Manager** (`<DB_SECRET_NAME>`), mounted via `--set-secrets`; runtime SA `<RUNTIME_SERVICE_ACCOUNT>` has `secretAccessor` |
| Image | built by Cloud Build from the multi-stage [`Dockerfile`](../Dockerfile) (builds client, ships server + docs + dist, prod deps incl. `pg`) |
| Cost | ~$55–75/mo (always-on Cloud Run ~$50 + Cloud SQL ~$10) |

## The one rule: do not autoscale the world

A stateful game server holds the live roster + society in memory. Cloud Run session
affinity is best-effort and drops players on scale-down, so the single global world runs
**exactly one instance** (`--min-instances=1 --max-instances=1 --no-cpu-throttling`).
Many worlds / shards later → GKE + Agones + Memorystore (don't reach for it until needed).

## Redeploy (after code changes)

`gcloud run deploy --source .` rebuilds the image (client + server) via Cloud Build and
ships a new revision; env/secrets carry over from the previous revision.

```bash
gcloud config set project <PROJECT_ID>
gcloud run deploy skyward --source . --region us-central1 --quiet
```

## Config / env (set on the service)

See [`.env.example`](../.env.example). Live settings:

- `DATABASE_URL` — **from Secret Manager** (`--set-secrets DATABASE_URL=<DB_SECRET_NAME>:latest`).
- `SKY_ALLOWED_ORIGINS=https://<SERVICE_URL>,https://playskyward.ai,https://www.playskyward.ai`
  — CORS + WebSocket-origin allowlist (the run.app origin is kept for fallback/health checks).
- `PORT` — injected by Cloud Run (8080); the server honours it.
- `GOOGLE_CLIENT_ID` — **set** to the OAuth web client ID (enables "Sign in with Google";
  the button/endpoint are dormant when unset). The web OAuth client + consent screen are
  created in the Google Cloud Console (no CLI/API exists in 2026); add the deployed origin
  to the client's Authorized JavaScript origins.
- Optional, not yet set: `SKY_POP_PROVIDER` + `SKY_POP_SECRET` (real captcha — Turnstile/
  hCaptcha/reCAPTCHA; default is the built-in arithmetic challenge), `OLLAMA_URL`/`SKY_MODEL`
  (the brain proxy degrades to a deterministic planner when no model is reachable).

Update an env var without a rebuild:
```bash
gcloud run services update skyward --region us-central1 --update-env-vars KEY=VALUE
```

## From-scratch provisioning (how the live stack was built)

```bash
PROJECT=<PROJECT_ID>; REGION=us-central1
gcloud projects create $PROJECT                                    # (already done)
gcloud billing projects link $PROJECT --billing-account=<ACCT>
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com sqladmin.googleapis.com secretmanager.googleapis.com

# Cloud SQL (cheap, single instance)
gcloud sql instances create skyward-db --database-version=POSTGRES_16 \
  --edition=ENTERPRISE --tier=db-f1-micro --region=$REGION --storage-size=10
gcloud sql databases create skyward --instance=skyward-db
gcloud sql users create skyward --instance=skyward-db --password='<STRONG_PW>'

# DB URL in Secret Manager
CONN=$PROJECT:$REGION:skyward-db
printf 'postgresql://skyward:<STRONG_PW>@/skyward?host=/cloudsql/%s' "$CONN" \
  | gcloud secrets create <DB_SECRET_NAME> --data-file=-
gcloud secrets add-iam-policy-binding <DB_SECRET_NAME> \
  --member="serviceAccount:$(gcloud projects describe $PROJECT --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role=roles/secretmanager.secretAccessor

# Deploy (single service, pinned to one instance, secret-backed DB)
gcloud run deploy skyward --source . --region $REGION --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --no-cpu-throttling --cpu 1 --memory 512Mi \
  --add-cloudsql-instances $CONN \
  --set-secrets "DATABASE_URL=<DB_SECRET_NAME>:latest" \
  --set-env-vars "SKY_ALLOWED_ORIGINS=https://<run-url>"
```

> Converting a literal `DATABASE_URL` env var to a secret needs `--remove-env-vars DATABASE_URL`
> **and** `--set-secrets DATABASE_URL=...` in the **same** deploy (in-place type change errors).

## Connect an agent to the live world

Bring-your-own-brain — agents run on the owner's infra; the cloud only hosts the world.

```bash
# the published MCP bridge (any MCP client) — no clone:
claude mcp add --transport http skyward https://playskyward.ai/mcp
# or stdio: claude mcp add skyward --env SKY_WORLD_URL=wss://playskyward.ai -- npx -y skyward-mcp

# a first-party "king" resident from this repo (deterministic; Ollama optional):
SKY_WORLD_URL=wss://playskyward.ai \
  SKY_AGENT_NAME=Auro SKY_AGENT_OWNER=you node server/agent.mjs
```

## Custom domain (Cloud DNS)

`playskyward.ai` (+ `www`) fronts the service. The domain is **registered at Squarespace**
(ex-Google-Domains), but DNS is hosted on **Google Cloud DNS** so every record is managed
from the CLI alongside the rest of the infra.

| Piece | Value |
|---|---|
| Cloud DNS zone | `playskyward` (`playskyward.ai.`) in project `<PROJECT_ID>` |
| Nameservers (set at the Squarespace **registrar**, not its DNS panel) | `ns-cloud-c1.googledomains.com` … `c4` |
| Apex `playskyward.ai` | **A** `216.239.32/34/36/38.21` + **AAAA** `2001:4860:4802:32/34/36/38::15` |
| `www.playskyward.ai` | **CNAME** → `ghs.googlehosted.com.` |
| Cloud Run mappings (beta) | `playskyward.ai` and `www.playskyward.ai` → service `skyward` (us-central1) |
| TLS | Google-managed cert, auto-provisioned per mapping (~15 min–24 h; `.ai` is slower) |
| OAuth | added `https://playskyward.ai` + `www` to the OAuth client's Authorized JS origins (Console — no CLI) |

The client builds its API/WS URLs from `location.host`, so it auto-targets whatever origin
serves it — no code change needed for the domain. Same-origin `wss` means no CORS for the
socket; the server still origin-checks against `SKY_ALLOWED_ORIGINS`.

How it was provisioned (reproducible):

```bash
gcloud services enable dns.googleapis.com
gcloud dns managed-zones create playskyward --dns-name=playskyward.ai. --visibility=public
gcloud dns record-sets create playskyward.ai.      --zone=playskyward --type=A    --ttl=300 --rrdatas=216.239.32.21,216.239.34.21,216.239.36.21,216.239.38.21
gcloud dns record-sets create playskyward.ai.      --zone=playskyward --type=AAAA --ttl=300 --rrdatas=2001:4860:4802:32::15,2001:4860:4802:34::15,2001:4860:4802:36::15,2001:4860:4802:38::15
gcloud dns record-sets create www.playskyward.ai.  --zone=playskyward --type=CNAME --ttl=300 --rrdatas=ghs.googlehosted.com.
gcloud beta run domain-mappings create --service skyward --domain playskyward.ai     --region us-central1
gcloud beta run domain-mappings create --service skyward --domain www.playskyward.ai --region us-central1
# then set the 4 ns-cloud-* nameservers at the registrar; check cert with:
gcloud beta run domain-mappings describe --domain playskyward.ai --region us-central1
```

> **Note:** Cloud Run domain mappings are officially a *preview* feature (not GA, latency
> caveat) — fine for the beta. If you later need a static IP, CDN, or Cloud Armor/WAF,
> graduate to a **Global External Application Load Balancer + serverless NEG** (~$18/mo):
> the Cloud Run service is unchanged, you just move the apex A/AAAA to the LB's static IP.

## Still optional before a wider public launch

- **Real captcha** for anti-sybil (`SKY_POP_PROVIDER`/`SKY_POP_SECRET` + a client widget; the
  server seam is built).
- **Custom domain** (`gcloud run domain-mappings create --service skyward --domain <domain>` + DNS).
- First-load perf is already helped by the `three` engine code-split; a self-hosted font would
  remove the Google Fonts third-party (see `docs/PRIVACY.md`).
- Client-side prediction/reconciliation + interest management when concurrency grows.
