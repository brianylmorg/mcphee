# mcphee push worker

Always-on daemon that sends mcphee's web-push notifications. The Vercel app
(`/api/notify` cron) only *detects* overdue activities and inserts jobs into
the `notification_queue` table in Turso; this worker claims pending jobs,
sends the pushes, enforces rate limits, and retries failures.

## Setup on the VPS

```bash
cd worker
npm install
cp .env.example .env   # fill in Turso + VAPID values
npm run typecheck
```

VAPID keys **must be the same pair already configured in Vercel**.
Regenerating them breaks every existing push subscription.

## Verify, then go live

```bash
DRY_RUN=true npm start   # claims and logs jobs, sends nothing
npm start                # live sending
```

Run it under pm2 or systemd, e.g.:

```bash
pm2 start npm --name mcphee-push-worker -- start
pm2 save
```

## Env vars

See `.env.example`. `RATE_LIMIT_MS` (default 30 min) is the single rate-limit
enforcement point per household+kind; the Vercel route also checks before
enqueueing to avoid queue spam.

## Failure handling

- Claims use a token + 60s lease; a crashed worker's jobs return to `pending`.
- Transient send failures retry with backoff (1m, 4m, 9m, 16m), then go `dead`.
- `404`/`410` responses delete the dead subscription.
- Successful sends write to `notification_log` (which the app's rate-limit
  checks read).
