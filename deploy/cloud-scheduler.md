# Subscription delivery scheduler

`POST /api/jobs/run-due-deliveries` generates every planned subscription
delivery whose date has arrived. Nothing calls it automatically — Cloud Run has
no built-in cron — so it must be driven by Cloud Scheduler.

## Why this shape

- **Not an in-process timer.** Cloud Run scales to zero and runs many instances;
  a `setInterval` would either never fire or fire N times.
- **Not admin-session authenticated.** A scheduler has no session to present, so
  the endpoint takes a shared secret header instead.
- **Safe to run concurrently.** Each delivery is taken with a conditional
  `UPDATE ... WHERE status = 'PLANNED'`, so two instances cannot process the
  same one. The wallet debit is keyed on the delivery id, so a retry after a
  partial failure cannot charge twice.
- **Disabled unless configured.** With `SCHEDULER_SECRET` unset the endpoint
  returns 503 rather than running unauthenticated.

## Setup

```bash
SECRET="$(openssl rand -hex 32)"

# 1. store it with the other runtime secrets
printf '%s' "$SECRET" | gcloud secrets create SCHEDULER_SECRET --data-file=-
gcloud run services update spoonup \
  --region asia-south1 \
  --update-secrets SCHEDULER_SECRET=SCHEDULER_SECRET:latest

# 2. drive it. Daily at 05:30 IST, before the morning delivery window.
gcloud scheduler jobs create http spoonup-run-due-deliveries \
  --location asia-south1 \
  --schedule "30 5 * * *" \
  --time-zone "Asia/Kolkata" \
  --uri "https://spoonupfoods.com/api/jobs/run-due-deliveries" \
  --http-method POST \
  --headers "Content-Type=application/json,X-Scheduler-Secret=$SECRET" \
  --message-body '{"limit":200}' \
  --attempt-deadline 300s
```

`--limit` caps one run at 500. If a day ever exceeds that, schedule the job more
than once — re-running is safe and processes only what is still `PLANNED`.

## Verifying

```bash
curl -s -X POST https://spoonupfoods.com/api/jobs/run-due-deliveries \
  -H "X-Scheduler-Secret: $SECRET" -H 'Content-Type: application/json' \
  -d '{"limit":1}'
```

Each run emits one audit line: `{"audit":"scheduler.run_due","attempted":…,
"generated":…,"skipped":…,"failed":…}`.

## Open decision — read before relying on this

A delivery whose wallet cannot cover it fails with `INSUFFICIENT_BALANCE` and is
released back to `PLANNED`, so the next run retries it indefinitely. Whether a
plan should instead pause, notify, or close after N failures is a **business
rule that has not been decided**, so the scheduler deliberately does not
implement one.
