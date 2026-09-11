# Deployment runbook — Cloud Run Job + Cloud Scheduler

**Status: prepared, not executed.** Creating these resources spends money and
touches infrastructure outside the repository, so per the plan's questionnaire
(question Q5) the commands are written down and reviewed before they are run. No
command in this document has been executed.

Everything here is designed to sit inside GCP's always-free tier, and the one
expensive option — a managed Postgres — is deliberately absent because the Tiger
Cloud TimescaleDB instance we already run is the temporal store.

---

## 1. What gets created, and why

| Resource | Purpose | Cost shape |
|---|---|---|
| Artifact Registry repository | Holds the worker image | Free tier: 0.5 GB |
| GCS bucket | Snapshots (current state) | Free tier: 5 GiB + 55k ops + 100 GiB egress |
| Cloud Run **Job** | Runs one collection sweep, then exits | Per-second, scale-to-zero |
| Cloud Scheduler job | Fires the Job every 6 hours | Free tier: 3 jobs |
| Budget alert | Catches drift before it bills | Free |

**Deliberately not created:** Cloud SQL or AlloyDB (the single most expensive
addition available, and unnecessary — the existing TimescaleDB instance already
holds the history), Memorystore, any GKE cluster or always-on VM. A 6-hourly
batch has no latency requirement that could justify a warm instance.

**Why a Job and not a Service.** A Service must answer HTTP requests and therefore
listen on `0.0.0.0:$PORT`, and it bills while idle unless scaled to zero. This
work is a bounded batch with a natural exit, so a Job matches it exactly: it runs,
reports an exit code, and stops. `--task-timeout` and `--max-retries` then bound a
run at the platform level, on top of the per-source timeout inside the worker.

---

## 2. Prerequisites

```bash
export PROJECT_ID="<your-gcp-project>"
export REGION="us-central1"            # keep in the same region as the bucket
export REPO="risk-pipeline"
export JOB="risk-pipeline-sweep"
export BUCKET="<your-bucket-name>"
export SERVICE_ACCOUNT="risk-pipeline@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  cloudscheduler.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  --quiet
```

**Required roles.** You need `roles/run.admin`, `roles/artifactregistry.writer`,
`roles/storage.admin` and `roles/iam.serviceAccountUser` on the project, plus
`roles/logging.viewer` to read run logs.

---

## 3. Artifact Registry

```bash
gcloud artifacts repositories create "$REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Risk-analysis data pipeline worker images" \
  --quiet

gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet
```

## 4. Build and push the image

Run from the **package root** — the build context must include `scraper/` and
`roster.json`, which is why the Dockerfile is referenced by path rather than
living at the context root.

```bash
cd packages/risk-analysis-data-pipeline

IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/worker:0.1.0"

# --platform matters when building on Apple Silicon for Cloud Run's amd64.
docker build \
  --platform linux/amd64 \
  -f container/Dockerfile \
  -t "$IMAGE" \
  .

docker push "$IMAGE"
```

## 5. GCS bucket for snapshots

```bash
gcloud storage buckets create "gs://${BUCKET}" \
  --location="$REGION" \
  --uniform-bucket-level-access

# The job writes; the indexer reads. Versioning keeps a bad sweep recoverable.
gcloud storage buckets update "gs://${BUCKET}" --versioning
```

## 6. Service account

A dedicated identity rather than the default compute account, so the job's
permissions are exactly the ones it needs.

```bash
gcloud iam service-accounts create risk-pipeline \
  --display-name="Risk-analysis data pipeline worker" \
  --quiet

# Write snapshots.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin" \
  --quiet
```

The job also needs to reach the TimescaleDB instance, which is **not** in GCP, so
no VPC connector is required — it connects over the public internet using the
connection string, exactly as the local verification does.

## 7. Cloud Run Job

```bash
gcloud run jobs create "$JOB" \
  --image="$IMAGE" \
  --region="$REGION" \
  --service-account="$SERVICE_ACCOUNT" \
  --tasks=1 \
  --parallelism=1 \
  --max-retries=1 \
  --task-timeout=15m \
  --memory=2Gi \
  --cpu=1 \
  --set-env-vars="RISK_GCS_BUCKET=${BUCKET},RISK_GCS_PREFIX=risk,RISK_LOG_FORMAT=json,RISK_HEADLESS=true" \
  --set-secrets="TIMESERIES_DATABASE_URL=timeseries-database-url:latest" \
  --quiet
```

Option rationale:

- `--max-retries=1` — a second attempt covers a transient network failure; more
  would multiply scraper load against upstreams that did not cause the problem.
- `--task-timeout=15m` — the observed sweep is ~2 minutes; 15 gives headroom for
  a slow upstream while still bounding a hung run well below the platform default.
- `--memory=2Gi` — Firefox plus the Python runtime; 1 GiB is tight once the
  browser has navigated a few pages.
- `--parallelism=1` — one browser, one sweep. Parallel source collection would
  multiply load on the forums for no latency benefit at this scale.

**Secrets.** The connection string is a secret, not an env var literal. Create it
once:

```bash
printf '%s' '<timeseries-connection-string>' | \
  gcloud secrets create timeseries-database-url --data-file=- --quiet
```

## 8. Cloud Scheduler

```bash
gcloud scheduler jobs create http "${JOB}-6h" \
  --location="$REGION" \
  --schedule="0 */6 * * *" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT_ID}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="$SERVICE_ACCOUNT" \
  --quiet
```

**Why not Vercel Cron.** Vercel's Hobby plan rejects any schedule more frequent
than daily at deploy time, so `0 */6 * * *` cannot live there. Cloud Scheduler's
free tier covers three jobs.

## 9. Budget alert

```bash
gcloud billing budgets create \
  --billing-account="<billing-account-id>" \
  --display-name="risk-pipeline guard" \
  --budget-amount=5USD \
  --threshold-rule=percent=50 \
  --threshold-rule=percent=90
```

A $5 ceiling on a workload that should cost near zero: the alert exists to catch a
mistake — a misconfigured schedule, an accidental always-on service — rather than
to cap normal spend.

---

## 10. Verifying a deployment

```bash
# Run once, and wait for the verdict.
gcloud run jobs execute "$JOB" --region="$REGION" --wait --quiet

# Read the structured log for the sweep summary.
gcloud logging read \
  "resource.type=cloud_run_job AND resource.labels.job_name=${JOB}" \
  --limit=50 --format='value(textPayload)'

# Confirm the manifest landed and reports every source.
gcloud storage cat "gs://${BUCKET}/risk/manifest.json" | head -40
```

A healthy run reports `"state":"fresh"` for each source it could reach. A source
that failed must appear with `"state":"failed"` and an `error` string — if a
source is missing from the manifest entirely, that is a bug worth investigating,
because absence is not the same as failure.

## 11. Operations

```bash
# Recent executions and their outcomes.
gcloud run jobs executions list --job="$JOB" --region="$REGION" --limit=10

# Pause the schedule without deleting it.
gcloud scheduler jobs pause "${JOB}-6h" --location="$REGION" --quiet

# Roll back: redeploy a previous tag.
gcloud run jobs update "$JOB" \
  --image="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/worker:<previous-tag>" \
  --region="$REGION" --quiet
```

## 12. What is deliberately absent

| Not deployed | Why |
|---|---|
| A managed Postgres | The Tiger Cloud TimescaleDB instance already holds the history; adding Cloud SQL would be the largest line item on the bill for zero benefit |
| A VPC connector | The database is reached over the public internet by connection string, as the local verification does |
| Redis / Memorystore | Nothing here caches; the sweep is once per six hours |
| An always-on instance | The whole point of a Job is that nothing runs between sweeps |
| A separate service for the read path | `apps/indexer` on Vercel already serves it, reading the same snapshots |
