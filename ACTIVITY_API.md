# Android activity sync and midnight coins

All APIs require `Authorization: Bearer <accessToken>` from OTP login. The backend never fetches Health Connect itself. Android must read permitted data and sync it, including late data after a user returns.

## Daily rules v1 (product incentives)

| Activity | Qualifier | Maximum coins per day |
|---|---|---:|
| Steps | 2 per 2,000 steps | 8 |
| Workout | 20 minutes of cycling/yoga/strength/swimming/other | 5 |
| Meditation | 5 minutes | 2 |
| Water habit check-in | One check-in; no volume target | 1 |
| Sleep routine check-in | One check-in; no sleep duration/quality target | 2 |

Global daily cap is 20; current categories sum to at most 18. Running/walking/hiking/treadmill sessions do not separately earn workout coins; steps cover those activities. Vital readings, body weight, distance and calorie values are stored but do not generate coins. Rules are fixed/versioned in `src/services/daily-rules.js`; each user/day stores a snapshot, so later code changes do not rewrite historical rules. An admin rule editor is not included.

All activity days and midnight settlement use **Asia/Kolkata**. Per-user timezones are not enabled. Split intervals at IST midnight; a single record may not span two days. Health Connect historical read availability/permissions still determine what Android can retrieve: the backend cannot recover data that was never uploaded.

## Sync

`POST /api/v1/health/sync` (max 100 records per request):

```json
{
  "records": [
    {
      "metricType": "steps",
      "value": 4000,
      "unit": "count",
      "recordedAt": "2026-10-20T04:00:00Z",
      "startTime": "2026-10-20T04:00:00Z",
      "endTime": "2026-10-20T05:00:00Z",
      "source": "health_connect",
      "sourceRecordId": "hc-steps-stable-id",
      "sourceVersion": 1,
      "dataOrigin": "com.example.tracker",
      "recordingMethod": "automatic"
    },
    {
      "metricType": "meditation",
      "value": 5,
      "unit": "min",
      "recordedAt": "2026-10-20T05:00:00Z",
      "startTime": "2026-10-20T05:00:00Z",
      "endTime": "2026-10-20T05:05:00Z",
      "source": "app",
      "sourceRecordId": "app-session-stable-id",
      "sourceVersion": 1,
      "recordingMethod": "active"
    },
    {
      "metricType": "water_checkin",
      "value": 1,
      "unit": "checkin",
      "recordedAt": "2026-10-20T05:00:00Z",
      "source": "app",
      "sourceRecordId": "water-2026-10-20"
    }
  ]
}
```

For a workout use `metricType: "workout"`, `unit: "min"`, start/end timestamps and `activityType` from walking/running/hiking/treadmill/cycling/yoga/strength/swimming/other. For sleep habits use `sleep_checkin`, value `1`, unit `checkin`.

`recordedAt` must be in the activity day. Steps must be integer counts. Reward-eligible steps require interval timestamps, source `health_connect` or `app`, a data origin, and recording method `automatic` or `active`. Older steps without interval/origin metadata remain stored but do not earn coins. Do not send cumulative daily snapshots as independent interval records; increment the same record's `sourceVersion` when its value changes.

The backend uses the largest daily total from one origin, never the sum of phone + watch totals. Overlapping records within an origin are conservatively grouped using the largest count per overlap cluster. This prevents common double-counting but can undercount partially overlapping records; it is not an exact Health Connect aggregate. Android should prefer one consistent origin and non-overlapping intervals.

Repeated `userId + source + sourceRecordId` with the same/older version is a duplicate. Higher versions update the current record and preserve the prior revision. Send a higher version with `deleted: true` to invalidate a source record (retain the original required fields); nothing is physically deleted. Metric/day changes require a new identity, with the original marked deleted. A sync response contains `rewards: []` and `settlementPending: true`; sync never credits instant coins. A batch can commit some records before another fails: retrying the whole batch safely deduplicates completed records.

## Scheduling, retry and consistency

`SETTLEMENT_ENABLED=true` starts the worker with the Express process. It checks persisted jobs every 15 seconds; today's rows become due at **00:00 IST of the following day**. Thus a daily cron is implemented as a durable due-time queue, with catch-up polling to handle downtime and late syncs. Each pass handles at most **20 user/day jobs (at most 20 users)**, with at most **2** in parallel. Multiple server instances use atomic leases, and an in-process guard prevents overlapping passes.

Expired leases are reclaimed after 120 seconds. Failures retry with exponential backoff capped at one hour; they are not silently discarded. Suspended users remain pending/retry until access is restored. Server shutdown stops polling and drains the current pass.

Ingestion saves the health record and queues its day in the same MongoDB transaction. Settlement computes the daily entitlement and credits only `max(0, entitlement - previouslyCredited)`. Wallet, ledger and daily settlement commit atomically. Each ledger credit also has a unique idempotency key. A late sync queues the original day again and credits only the additional entitlement, never all coins again.

Downward corrections/deletions retain the original credited ledger and show the lower corrected entitlement; they do not automatically take back spent coins. Consequently credited coins can exceed corrected entitlement. This is an explicit upward-only adjustment policy, not an exact reversible balance reconciliation system. It needs a separately reviewed reversal flow if clawbacks are required.

## Read APIs

- `GET /api/v1/activity/today` — current day's entitlement, credited/pending coins, totals, rules and due time.
- `GET /api/v1/activity/today?day=2024-10-20` — any retained activity day.
- `GET /api/v1/activity/history?page=1&limit=20` — paginated daily settlements.
- `GET /api/v1/activity/records?page=1&limit=20&from=2024-01-01&to=2024-12-31` — paginated raw records; supports the same metric/search filters as admin records, scoped to the authenticated user.
- `GET /api/v1/activity/transactions?page=1&limit=20` — full paginated wallet ledger, including old transactions.
- `GET /api/v1/wallet` — existing wallet response plus `dailyActivity` for pending vs credited display. Its legacy embedded transactions list is still limited to 100; use the paginated ledger for older entries.
- Admin: `GET /api/v1/admin/users/:id/settlements?page=1&limit=20` and `GET /api/v1/admin/settlements/status`.

History/ledger pagination defaults to 20 and permits up to 100 items. No health record, revision, settlement or wallet transaction has an automatic TTL. Pre-existing records are preserved but are not automatically paid retrospectively; re-sync them with valid metadata/higher versions if appropriate. Existing legacy wallet credits are retained. Their old rule system should be reconciled before importing already-paid activity into a new rewarded day.

## Durable operation

MongoDB **replica set or Atlas** is mandatory for transactional ingestion and settlement. Startup checks topology and builds required unique/compound indexes before listening. `USE_MONGODB=false` remains a temporary testing mode; the production worker is disabled in that mode and data disappears on restart. Keep the server running (or restart via a process manager) for scheduled execution; persisted due work resumes on startup.

Two-year retention depends on persistent database storage, backups, access controls and tested restores, not just code. This change adds no automatic expiry and historical APIs, but does not provision backups. Configure regular MongoDB/Atlas backups with retention appropriate to your policy and verify restoring them.

App-supplied source/method metadata is not proof of genuine sensor data. Current app timers/check-ins are self-reported; this implementation does not include Play Integrity or fraud attestation and should not be treated as sufficient verification for cash-equivalent rewards.

## Tests

`npm test` runs the default suite. The separate transaction test uses an isolated replica set only:

```bash
SETTLEMENT_TEST_MONGO_URI='mongodb://127.0.0.1:27029/settlement_verification?replicaSet=health-test' node --test test/settlement-mongo.test.js
```

Use a new, dedicated empty test database per run. Tests create data and do not delete or overwrite your application database. Coverage includes duplicate sync, concurrent workers, versioned corrections, historical data, rollback after wallet writes, retries, lease recovery, reconnection, 20-job limits, and midnight gating.
