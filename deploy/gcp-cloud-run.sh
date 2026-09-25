#!/usr/bin/env bash
# Deploy SpoonUp Event Order System to Cloud Run in project spoonup-508319.
# Secrets are read from local .env once, then stored in Secret Manager.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-spoonup-508319}"
REGION="${REGION:-asia-south1}"
SERVICE="${SERVICE:-event-order-system}"
ENV_FILE="${ENV_FILE:-.env}"

cd "$(dirname "$0")/.."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy .env.example and fill ADMIN_USERNAME, ADMIN_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, ADMIN_SESSION_SECRET, ORIGIN_AUTH_SECRET."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

# Secrets go from .env straight into Secret Manager via stdin. Values never touch
# the shell (no eval, no word splitting, no $-expansion), so any character is safe.
python3 - "$ENV_FILE" "$PROJECT_ID" <<'PY'
import subprocess, sys
from pathlib import Path

env_file, project = sys.argv[1], sys.argv[2]
needed = (
    "ADMIN_USERNAME", "ADMIN_PASSWORD", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY",
    "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET",
    "ADMIN_SESSION_SECRET", "ORIGIN_AUTH_SECRET",
)
vals = {}
for line in Path(env_file).read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        v = v[1:-1]
    vals[k.strip()] = v

missing = [k for k in needed if not vals.get(k)]
if missing:
    raise SystemExit("Missing in %s: %s" % (env_file, ", ".join(missing)))
for k in ("ADMIN_SESSION_SECRET", "ORIGIN_AUTH_SECRET"):
    if len(vals[k]) < 32:
        raise SystemExit("%s must be at least 32 characters (openssl rand -hex 32)" % k)
if len(vals["ADMIN_PASSWORD"]) < 8:
    raise SystemExit("ADMIN_PASSWORD must be at least 8 characters")
if len(vals["ADMIN_USERNAME"]) < 3:
    raise SystemExit("ADMIN_USERNAME must be at least 3 characters")

def run(args, data=None):
    return subprocess.run(args, input=data, text=True, capture_output=True)

for name in needed:
    value = vals[name]
    exists = run(["gcloud", "secrets", "describe", name, "--project", project]).returncode == 0
    if exists:
        r = run(["gcloud", "secrets", "versions", "add", name, "--data-file=-", "--project", project], value)
    else:
        r = run(["gcloud", "secrets", "create", name, "--data-file=-", "--replication-policy=automatic", "--project", project], value)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        raise SystemExit("Failed to store secret %s" % name)
    print("  secret %s: %s" % (name, "updated" if exists else "created"))
PY

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in ADMIN_USERNAME ADMIN_PASSWORD SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET ADMIN_SESSION_SECRET ORIGIN_AUTH_SECRET; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor" \
    --project="$PROJECT_ID" \
    --quiet >/dev/null
done

gcloud run deploy "$SERVICE" \
  --source . \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --quiet \
  --port=8080 \
  --memory=512Mi \
  --cpu=1 \
  --concurrency=80 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=30 \
  --cpu-throttling \
  --execution-environment=gen2 \
  --env-vars-file=deploy/cloud-run-env.yaml \
  --set-secrets="ADMIN_USERNAME=ADMIN_USERNAME:latest,ADMIN_PASSWORD=ADMIN_PASSWORD:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,RAZORPAY_KEY_ID=RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=RAZORPAY_WEBHOOK_SECRET:latest,ADMIN_SESSION_SECRET=ADMIN_SESSION_SECRET:latest,ORIGIN_AUTH_SECRET=ORIGIN_AUTH_SECRET:latest"

echo
echo "Reminder: run supabase/migrate-security-hardening.sql and supabase/migrate-admin-credentials.sql once, and set ORIGIN_AUTH_SECRET on the Cloudflare Worker (wrangler secret put ORIGIN_AUTH_SECRET)."
echo
echo "Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
