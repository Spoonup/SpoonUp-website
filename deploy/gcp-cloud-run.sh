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
  echo "Missing $ENV_FILE. Copy .env.example and fill ADMIN_PIN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET."
  exit 1
fi

gcloud config set project "$PROJECT_ID"

ensure_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Refusing to create empty secret: $name"
    exit 1
  fi
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- --project="$PROJECT_ID" >/dev/null
  else
    printf '%s' "$value" | gcloud secrets create "$name" --data-file=- --replication-policy=automatic --project="$PROJECT_ID" >/dev/null
  fi
}

# Parse KEY=VALUE from .env without printing values
eval "$(python3 - <<'PY'
from pathlib import Path
needed = ("ADMIN_PIN", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET")
vals = {}
for line in Path(".env").read_text().splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    vals[k.strip()] = v.strip().strip('"').strip("'")
missing = [k for k in needed if not vals.get(k)]
if missing:
    raise SystemExit("Missing in .env: " + ", ".join(missing))
for k in needed:
    print(f'{k}={vals[k]!r}')
PY
)"

ensure_secret ADMIN_PIN "$ADMIN_PIN"
ensure_secret SUPABASE_URL "$SUPABASE_URL"
ensure_secret SUPABASE_SERVICE_ROLE_KEY "$SUPABASE_SERVICE_ROLE_KEY"
ensure_secret RAZORPAY_KEY_ID "$RAZORPAY_KEY_ID"
ensure_secret RAZORPAY_KEY_SECRET "$RAZORPAY_KEY_SECRET"

PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for secret in ADMIN_PIN SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET; do
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
  --set-secrets="ADMIN_PIN=ADMIN_PIN:latest,SUPABASE_URL=SUPABASE_URL:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest,RAZORPAY_KEY_ID=RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=RAZORPAY_KEY_SECRET:latest"

echo
echo "Service URL:"
gcloud run services describe "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --format='value(status.url)'
