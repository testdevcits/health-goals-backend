# Android activity and daily points API

This document describes the Android-facing activity APIs implemented by this backend. Examples use JSON and assume the API is mounted at `/api/v1`. Replace `https://api.example.com` with the deployed API origin.

## Android integration flow

1. Authenticate with the app's existing login/OTP flow and retain the returned access token securely. Use the token as a bearer token on every authenticated request.
2. Request Health Connect permissions in Android. The backend does not read Health Connect, request Android permissions, or infer missing data.
3. Read permitted Health Connect records and the app's own workout/meditation/check-in events. Normalize units and timestamps before upload. Use UTC ISO-8601 timestamps with `Z` or an explicit offset.
4. Assign each source record a stable `sourceRecordId`; keep it unchanged on retries. When correcting a record, increase `sourceVersion`.
5. Upload records with `POST /health/sync` in batches of at most 100. Retry network/server failures with backoff and the same IDs/versions. A batch is not atomic: some records may have been saved before an error, and replay is safe.
6. Show provisional daily entitlement from `GET /activity/today`; it is not credited balance. Daily points settle after midnight IST. Use `/activity/history`, `/activity/transactions`, and `/wallet` for settled and available points.

Base URL: `https://api.example.com/api/v1`

Authenticated requests:

```http
Authorization: Bearer <accessToken>
Content-Type: application/json
Accept: application/json
```

The auth endpoints are mounted at `/auth`. Login/OTP request formats and token expiry are defined by the app's authentication API; after obtaining an access token, activity endpoints below require it. Missing/invalid/expired credentials normally return `401`.

## Standard response envelope

Successful responses use this envelope (the HTTP status varies by endpoint):

```json
{
  "success": true,
  "message": "Daily activity and pending points",
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "error": {
    "code": "API_ERROR",
    "message": "Human-readable validation or authorization error",
    "details": null
  }
}
```

Error `details` may be `null` or contain validation information such as allowed metric types or numeric bounds. Do not depend on the human-readable message for application logic. Common statuses: `400` invalid input/query, `401` missing or invalid authentication, `403` forbidden resource/device, `404` unknown route/resource, `409` state or version conflict where applicable, `429` rate limit, `500` unexpected server error. Endpoints can also return other statuses described below.

## Activity record schema

`POST /health/records` accepts one record. `POST /health/sync` accepts `{ "records": [...] }`.

| Field | Required | Description |
|---|---|---|
| `metricType` | Yes | One of the supported values below. |
| `value` | Yes | Numeric value. JSON number recommended; numeric strings are accepted. |
| `unit` | Yes | Unit string appropriate to the metric, e.g. `count`, `min`, `bpm`, `kg`, `km`, `%`, `checkin`. |
| `recordedAt` | Yes | Valid timestamp. Must not be more than five minutes in the future. For reward attribution, it must fall on the same IST activity day as the interval. |
| `source` | Yes | Usually `health_connect` or `app`. |
| `sourceRecordId` | Yes | Stable, non-empty source ID (maximum 256 chars). Idempotency key together with authenticated user and source. |
| `sourceVersion` | No | Monotonically increase when correcting the same source record. Same/older versions are treated as duplicates. |
| `startTime`, `endTime` | No | Interval timestamps. Required for reward-eligible steps, workouts and meditation. Keep each interval within one IST day; split at midnight. |
| `dataOrigin` | No | Origin package/source identity, e.g. Health Connect package name. Required for reward-eligible step records. |
| `recordingMethod` | No | `automatic`, `active`, or other source-specific value. Rewards require `automatic` or `active` for steps. |
| `activityType` | No | Workout category: `walking`, `running`, `hiking`, `treadmill`, `cycling`, `yoga`, `strength`, `swimming`, `other` (reward eligibility excludes the first four). |
| `deviceId` | No | Registered device ID owned by the signed-in user; otherwise request fails with `403`. |
| `metadata` | No | Optional JSON object for source-specific context. |
| `deleted` | No | Set `true` in a higher-version correction to invalidate an earlier source record. Required record fields must still be supplied. This is a logical deletion. |

Supported `metricType` values: `steps`, `workout`, `meditation`, `water_checkin`, `sleep_checkin`, `running`, `walking`, `heart_rate`, `sleep`, `oxygen_saturation`, `weight`, `blood_pressure`, `calories`, `distance`, `active_minutes`.

Validation ranges (inclusive): steps `0–200000`; workout and meditation `0–1440`; water/sleep check-in exactly `1`; distance/running/walking `0–500`; heart rate `20–250`; sleep/active minutes `0–1440`; oxygen saturation `50–100`; weight `1–700`; blood pressure `1–400`; calories `0–50000`. These are numeric bounds, not unit conversion. Send values in a consistent canonical unit.

## Upload APIs

### `POST /health/sync`

Rate-limited. Body must contain 1–100 records. Each item uses the record schema above.

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
      "sourceRecordId": "hc:steps:stable-record-id",
      "sourceVersion": 1,
      "dataOrigin": "com.example.tracker",
      "recordingMethod": "automatic"
    },
    {
      "metricType": "workout",
      "value": 30,
      "unit": "min",
      "recordedAt": "2026-10-20T06:00:00Z",
      "startTime": "2026-10-20T05:30:00Z",
      "endTime": "2026-10-20T06:00:00Z",
      "activityType": "cycling",
      "source": "health_connect",
      "sourceRecordId": "hc:workout:stable-record-id",
      "sourceVersion": 1,
      "dataOrigin": "com.example.tracker",
      "recordingMethod": "automatic"
    },
    {
      "metricType": "water_checkin",
      "value": 1,
      "unit": "checkin",
      "recordedAt": "2026-10-20T12:00:00+05:30",
      "source": "app",
      "sourceRecordId": "water:2026-10-20",
      "sourceVersion": 1,
      "recordingMethod": "active"
    }
  ]
}
```

`200 OK` response:

```json
{
  "success": true,
  "message": "Health sync processed successfully",
  "data": {
    "total": 3,
    "created": 3,
    "duplicates": 0,
    "rewards": [],
    "records": [
      { "id": "<record-id>", "userId": "<user-id>", "metricType": "steps", "value": 4000, "unit": "count", "source": "health_connect", "sourceRecordId": "hc:steps:stable-record-id", "sourceVersion": 1, "recordedAt": "2026-10-20T04:00:00.000Z", "activityDate": "2026-10-20" }
    ]
  }
}
```

`records` contains one result per input record; the abbreviated item above illustrates fields and is not a complete fixed projection. Duplicate inputs count in `duplicates` and are still represented in `records`. The legacy `rewards` field is currently empty: sync queues settlement and does not credit coins immediately. `settlementPending` is not currently returned by the implemented sync endpoint.

Statuses: `200` processed (including duplicate-only batches); `400` missing/empty records, more than 100 items, invalid field/value/metric/timestamp, or other validation error; `401` unauthenticated; `403` supplied device does not belong to the user; `429` sync rate limit; `500` unexpected error. Each record is ingested sequentially, so an error can occur after earlier items have committed. Retry the same batch with the same source IDs and versions.

### `POST /health/records`

Accepts one activity record, using the schema above (without the `records` wrapper). Returns the same success envelope and ingestion result.

- `201 Created`: new record.
- `200 OK`: duplicate or accepted idempotent retry.
- `400`, `401`, `403`, `500`: see common errors and record validation above.

## Android daily points rules

All activity dates and settlement boundaries use `Asia/Kolkata`; user time zones are not supported. Split activity intervals at IST midnight. The current default rule snapshot is:

| Activity | Qualifier | Maximum daily points |
|---|---|---:|
| Steps | 2 points per 2,000 eligible steps | 8 |
| Workout | At least 20 eligible minutes | 5 |
| Meditation | At least 5 minutes | 2 |
| Water check-in | One check-in | 1 |
| Sleep routine check-in | One check-in | 2 |
| Daily cap | Combined eligible activities | 20 |

The current categories total at most 18. Walking, running, hiking and treadmill workouts do not also earn workout points because steps cover them. Vitals, sleep measurements, weight, distance and calories are stored but do not earn these daily points. Rules are versioned and snapshotted per user/day; historic snapshots do not change when a later rule version is configured.

Step rewards require interval timestamps, source `health_connect` or `app`, a `dataOrigin`, and `recordingMethod` equal to `automatic` or `active`. The backend selects the largest daily total from one origin instead of adding phone and watch totals. Within an origin, overlapping intervals are conservatively grouped using the largest count in each overlap cluster; partial overlaps can therefore undercount. Android should send one consistent origin and non-overlapping intervals. Do not upload cumulative daily snapshots as separate intervals; update the same record with a higher `sourceVersion`.

Workout/meditation points use interval duration (the backend calculates from start/end timestamps), not the submitted value. Supply the expected `value` and `unit` (`min`) as well. For workout, supply `activityType`. Check-ins use `value: 1`, `unit: "checkin"`. App timers and check-ins are self-reported; source metadata is not device attestation.

## Activity read APIs

All endpoints below require the bearer token. Query values should be URL-encoded. Pagination defaults to `page=1&limit=20`; the shared pagination validator caps `limit` at 100.

### `GET /activity/today`

Returns today's IST progress by default. Optional `day=YYYY-MM-DD` requests a retained historical day.

```http
GET /api/v1/activity/today?day=2026-10-20
```

`200 OK` data shape:

```json
{
  "day": "2026-10-20",
  "timezone": "Asia/Kolkata",
  "ruleVersion": "daily-v1",
  "rules": {
    "version": "daily-v1", "timezone": "Asia/Kolkata", "dailyCap": 20,
    "stepsPerTier": 2000, "stepTierCoins": 2, "stepMaxCoins": 8,
    "workoutMinutes": 20, "workoutCoins": 5,
    "meditationMinutes": 5, "meditationCoins": 2,
    "waterCheckinCoins": 1, "sleepCheckinCoins": 2
  },
  "state": "PENDING",
  "dueAt": "2026-10-20T18:30:00.000Z",
  "creditedCoins": 0,
  "entitledCoins": 6,
  "pendingCoins": 6,
  "totals": {
    "steps": 4000, "workoutMinutes": 0, "meditationMinutes": 0,
    "breakdown": { "steps": 4, "workout": 0, "meditation": 0, "waterCheckin": 0, "sleepCheckin": 0 },
    "entitledCoins": 4
  },
  "lastSettledAt": null,
  "needsSettlement": true
}
```

For a day with no activity settlement row, returns `200` with `state: "NO_DATA"`, zero coin counts, the effective rules, and no `dueAt`, `totals`, or `needsSettlement`. `400` for invalid day; `401` unauthenticated.

### `GET /activity/history`

Paginated daily settlement rows. Optional `from` and `to` use `YYYY-MM-DD` and filter by activity day.

```http
GET /api/v1/activity/history?page=1&limit=20&from=2026-10-01&to=2026-10-31
```

`200 OK` data: `{ "items": [<same daily row shape as today>], "total": 1, "page": 1, "limit": 20, "totalPages": 1 }`. `400` invalid pagination/date filters; `401` unauthenticated.

### `GET /activity/records`

Paginated raw records owned by the authenticated user. Supported filters include `page`, `limit`, `q`, `from`, `to`, and `metricType`.

```http
GET /api/v1/activity/records?page=1&limit=20&metricType=steps&from=2026-10-01&to=2026-10-20
```

`200 OK` data: `{ "items": [<activity record>], "total": 1, "page": 1, "limit": 20, "totalPages": 1 }`. `400` invalid filter/date/page/limit; `401` unauthenticated. Records are scoped to the bearer-token user; clients cannot select another `userId`.

### `GET /activity/transactions`

Paginated wallet ledger including historical transactions:

```http
GET /api/v1/activity/transactions?page=1&limit=20
```

`200 OK` data: `{ "items": [<wallet transaction>], "total": 1, "page": 1, "limit": 20 }`. MongoDB-backed results are newest first. `400` invalid pagination; `401` unauthenticated.

### `GET /wallet`

Returns the wallet response, including `dailyActivity` for pending versus credited display. Its legacy embedded `transactions` array is limited to 100; use `/activity/transactions` for full pagination. `200 OK`; `401` unauthenticated.

## Record corrections and deletes

The unique identity is authenticated user + `source` + `sourceRecordId`:

- Same or lower `sourceVersion` is a duplicate; no second record/credit is created.
- A higher version updates that record and preserves its prior revision for audit.
- To invalidate it, submit the required record fields with a higher version and `deleted: true`. It remains in history but is excluded from charts and point calculations.
- If the metric or activity day changes, create a new source identity and invalidate the previous one with a higher version.
- Corrections/deletions can lower the displayed entitlement but do not claw back points already credited or spent. The settlement policy only credits positive differences.

## Settlement timing and operational behavior

Ingestion persists the health record and queues its user/day for settlement. The day becomes due at midnight IST (00:00 the following day); settlement runs through the durable worker when enabled. Sync itself never awards instant points. Late data can re-queue an earlier day and only any additional entitlement is credited. A pending day's progress is computed from current valid records and shows `entitledCoins`, `creditedCoins`, and `pendingCoins` separately.

The worker polls persisted jobs every 15 seconds, processes at most 20 user/day jobs per pass with concurrency 2, uses expiring leases, and retries failures with backoff capped at one hour. Production transactional ingestion/settlement requires MongoDB replica set or Atlas. With MongoDB disabled, data is in-memory and the production worker is disabled.

## Related Android APIs

The following endpoints are also part of the Android user app. The server does **not** currently expose one global `/leaderboard` endpoint. Leaderboard data is returned by group leaderboards and configured reward competitions (see below).

| Method and path | Purpose | Success |
|---|---|---|
| `GET /auth/me` | Current authenticated profile | `200` |
| `GET /health/records?metricType=steps` | Legacy unpaginated record list; prefer `/activity/records` for history | `200` |
| `GET /health/history?metricType=steps&from=YYYY-MM-DD&to=YYYY-MM-DD` | Daily metric history; all filters required by handler | `200` |
| `GET /health/summary` | Health summary | `200` |
| `GET /health/dashboard` | Health dashboard | `200` |
| `GET /wallet` | Wallet balance and recent transactions | `200` |

These endpoints require authentication. Invalid query/body data returns `400`; expired/missing tokens return `401`.

Health read response shapes: `GET /health/records` returns `{ "records": [<health record>] }` and currently returns at most 100 records (optional `metricType` filter). `GET /health/history` requires `metricType`, `from`, and `to`, and returns `{ "history": [{"date":"2026-10-20","value":4000,"count":1,"unit":"count"}] }`. `GET /health/summary` returns metric totals keyed by metric name, for example `{ "steps": 4000, "heart_rate": 70 }`. `GET /health/dashboard` returns `{ "latestRecords": [<health record per metric>], "summary": [{"metricType":"steps","totalRecords":12,"latestRecordedAt":"<ISO timestamp>"}] }`. These legacy health reads do not provide pagination; use `/activity/records` for paginated history.

## Android user, points, leaderboard, rewards, and community APIs

All paths below are relative to `/api/v1`. Authenticated calls use the bearer token. Success and error envelopes are the standard envelopes documented above. Response examples show the stable top-level shape; nested user/reward/group fields can grow as the app evolves.

### Current user profile and profile updates

| Method and path | Purpose | Success status |
|---|---|---:|
| `GET /auth/me` | Fetch the signed-in user's own profile | `200` |
| `PATCH /auth/me` | Update profile fields | `200` |
| `PATCH /auth/me/goals` | Save a daily health goal | `200` |
| `POST /auth/me/device` | Save phone metadata on the profile | `200` |
| `POST /auth/me/profile-image` | Upload a profile image | `200` |

`GET /auth/me` response data is `{ "user": { ... } }`. Profile patch accepts any supported subset:

```json
{"name":"Asha Kumar","goal":"Be more active","heightCm":165,"weightKg":62,"birthDate":"15/06/1998"}
```

Email is read-only. Health-goal request:

```json
{"metricType":"steps","targetValue":8000}
```

Supported goal metrics: `steps`, `sleep`, `heart_rate`, `stress`. Phone profile request:

```json
{"deviceIdentifier":"android-install-uuid","manufacturer":"Samsung","brand":"Samsung","model":"Galaxy S24","platform":"android","osVersion":"14","appVersion":"1.2.0"}
```

Profile image request accepts a base64 data URI for JPEG, PNG, or WebP (under 4.5 MB):

```json
{"image":"data:image/jpeg;base64,<base64-data>"}
```

Success data is `{ "user": { ... } }`. Errors include `400` invalid image, `401` unauthenticated, `413` image too large, `503` Cloudinary not configured, and `502` upload/provider failure.

### Wallet and point data

| Method and path | Purpose | Success status |
|---|---|---:|
| `GET /wallet` | Wallet balance, recent transactions, current daily activity progress | `200` |
| `GET /activity/today?day=YYYY-MM-DD` | Entitlement, credited/pending points, daily totals/rules | `200` |
| `GET /activity/history?page=1&limit=20&from=YYYY-MM-DD&to=YYYY-MM-DD` | Paginated day settlements | `200` |
| `GET /activity/transactions?page=1&limit=20` | Complete paginated wallet ledger | `200` |

`GET /wallet` response data shape:

```json
{
  "wallet": {"userId":"<user-id>","availablePoints":120,"totalEarned":150,"totalRedeemed":30},
  "transactions": [{"id":"<transaction-id>","type":"EARN","amount":4,"description":"Daily activities"}],
  "dailyActivity": {"day":"2026-10-20","creditedCoins":0,"entitledCoins":4,"pendingCoins":4,"state":"PENDING"}
}
```

Use the transaction and daily-progress response definitions in **Activity read APIs** above. Wallet `transactions` is a legacy recent list (at most 100); the activity ledger is the paginated source for all transactions. Treat `pendingCoins` as provisional and `creditedCoins` as already awarded; do not add the entitlement directly to the wallet balance.

### Leaderboards and competition progress

There is no public, all-users global leaderboard route in the current backend. Android can display:

| Method and path | Data |
|---|---|
| `GET /community/groups/:id/leaderboard` | Step totals for members of a group over the last 7 days |
| `GET /rewards/competitions` | User's configured badge/challenge/leaderboard competitions, each with leaderboard and `myProgress` |

Group leaderboard requires the signed-in user to be a member. Success data: `{ "leaderboard": [{"id":"<user-id>","rank":1,"name":"Asha","steps":42000,"initials":"AK","streak":"6 active days","color":"#..."}] }`. Statuses: `200`; `401` unauthenticated; `403` not a group member; `404` group not found.

`GET /rewards/competitions` has no request body. It evaluates current reward rules and returns data with this shape:

```json
{
  "competitions": [{
    "id":"<competition-run-id>","title":"Monthly Steps","ruleType":"LEADERBOARD",
    "audience":"INDIVIDUAL","metric":"STEPS","targetValue":100000,
    "start":"2026-10-01","end":"2026-10-31","status":"LIVE",
    "leaderboard":[{"id":"<user-or-group-id>","name":"Asha","value":52000,"rank":1,"progress":52,"achieved":false}],
    "myProgress":[{"id":"<user-or-group-id>","name":"Asha","value":52000,"rank":1,"progress":52,"achieved":false}]
  }],
  "achievements": []
}
```

Leaderboard rows are limited to 20. Competition status can be `LIVE`, `PAUSED`, or `FINAL`. Empty arrays mean there are no applicable configured competitions/achievements. Statuses: `200`; `401` unauthenticated.

### Rewards and redemptions

| Method and path | Purpose | Success status |
|---|---|---:|
| `GET /rewards` | Reward catalogue | `200` |
| `POST /rewards/:id/redeem` | Redeem one reward using wallet points | `201` |
| `GET /redemptions` | Signed-in user's redemption history | `200` |
| `GET /redemptions/:id` | One of the signed-in user's redemptions | `200` |

Reward listing response data: `{ "rewards": [<reward>] }`. Redemption requires no body:

```http
POST /api/v1/rewards/<reward-id>/redeem
Authorization: Bearer <accessToken>
```

Success data: `{ "redemption": { ... } }`; points are deducted and a voucher is issued by the backend. Common failure statuses include `400` insufficient points/invalid redemption, `401` unauthenticated, `404` reward/redemption not found, and `409` when no redeemable voucher or reward state conflict. Redemption list data is `{ "redemptions": [<redemption>] }`; detail data is `{ "redemption": <redemption> }`.

### Registered Android devices

| Method and path | Purpose | Success status |
|---|---|---:|
| `GET /devices` | List the signed-in user's registered devices | `200` |
| `POST /devices` | Register a device | `201` |
| `DELETE /devices/:id` | Remove one of the user's devices | `200` |

Create payload:

```json
{"deviceType":"phone","deviceIdentifier":"android-install-uuid","manufacturer":"Samsung","model":"Galaxy S24","platform":"android"}
```

`deviceType` and `deviceIdentifier` are required. GET/POST/DELETE data shapes are `{ "devices": [...] }`, `{ "device": { ... } }`, and `{ "device": { ... } }`. Statuses include `400` missing required values, `401` unauthenticated, and `404` when the device does not belong to this user or no longer exists. Do not send IMEI or hardware serial numbers.

### Groups, group activity, and leaderboards

| Method and path | Purpose |
|---|---|
| `GET /community/groups` | List joined groups |
| `GET /community/groups/discover` | List public groups available to discover |
| `GET /community/users/search?q=...` | Find active users by name or public ID to add to a group (up to 10 results) |
| `POST /community/groups` | Create a group |
| `GET /community/groups/:id` | Read group details |
| `POST /community/groups/:id/join` | Join a group |
| `POST /community/groups/:id/members` | GL adds an active user by public ID |
| `POST /community/groups/:id/leave` | Leave a group; GL role transfers to the longest-standing member |
| `GET /community/groups/:id/activity?day=YYYY-MM-DD` | Group and per-member daily activity totals |
| `GET /community/groups/:id/leaderboard` | Read its 7-day step leaderboard |
| `GET /community/groups/leaderboard?day=YYYY-MM-DD` | Public group daily rankings by steps |

Group creation accepts; the group limit is fixed at 10 including the creator/GL. The client cannot choose another limit. Creator is automatically the first member and GL. Public groups allow self-join; private groups can only be joined when their GL adds the user. GL adds a user with their public ID:

```json
{"name":"Morning Walkers","description":"Daily walking group","emoji":"🏃","private":false}
```

```json
{"publicId":"USR-0123456789AB"}
```

User search response data is `{ "users": [{"id":"<id>","name":"Asha","publicId":"USR-0123456789AB","profileImageUrl":null}] }`. Group creation returns `201` and `data.group`, for example `{ "id":"<group-id>","name":"Morning Walkers","private":false,"members":1,"maxMembers":10,"leaderId":"<user-id>","isLeader":true,"joined":true }`.

Members leave with an empty request body. If the GL leaves, the earliest-joined remaining member becomes GL; if the GL is the only member, the group is deleted. Daily group activity uses Asia/Kolkata dates and includes an individual member total and group combined total. A member's activity counts individually and in every group they belong to. Admin sees all groups at `GET /admin/groups?day=YYYY-MM-DD`; this powers the admin **Groups** page. User-facing rankings include public groups; admin rankings also include private groups. The user group ranking is by daily steps. Existing Admin reward rules support group-audience leaderboard and badge outcomes.

`GET /community/groups/:id/activity?day=2026-11-04` returns `data` as one group object with `members`. `GET /community/groups/leaderboard?day=2026-11-04` returns `{ "day":"2026-11-04", "timezone":"Asia/Kolkata", "groups":[{"id":"<group-id>","name":"Morning Walkers","rank":1,"leaderName":"Asha","memberCount":2,"maxMembers":10,"activeMembers":1,"steps":4200,"workoutMinutes":20,"meditationMinutes":0,"entitledPoints":9}] }`. Admin `GET /admin/groups?day=2026-11-04` returns the same ranked groups with a `members` array containing the member-level daily counts.

New groups are capped at 10. Existing groups that already have more than 10 members keep their current members; the API will not add more until the group drops below 10. No existing member is automatically removed.

Per-group activity response is one group object inside `data`, with `members`; it does not include a rank. Global ranking returns `data: {day, timezone, groups}` and adds `rank` to each group. Admin reports also include ranks and member rows; the public group ranking omits individual data. Member rows include `id`, `name`, `publicId`, `role` (`GL` or `MEMBER`), `active`, `steps`, `workoutMinutes`, `meditationMinutes`, `entitledPoints`, `activityCount`, and `recordCount`. Full status codes: `200` reads/joins/member add/leave, `201` create, `400` invalid payload/day, `401` unauthenticated, `403` GL-only or membership/privacy restriction, `404` missing group/user, and `409` group full or not currently a member.

### Challenges and badges

| Method and path | Purpose |
|---|---|
| `GET /community/challenges` | List the user's applicable challenges |
| `POST /community/challenges` | Create a challenge |
| `POST /community/challenges/:id/join` | Join a challenge |
| `GET /community/groups/:id/challenges` | List challenges for a joined group |
| `POST /community/groups/:id/challenges` | Create a challenge for a joined group |
| `GET /community/badges` | List badges and progress |

Challenge payload:

```json
{"title":"October steps","description":"Walk together","metricType":"steps","targetValue":50000,"startsAt":"2026-10-01T00:00:00+05:30","endsAt":"2026-10-31T23:59:59+05:30","rewardPoints":100}
```

`title` is 3–100 chars, `description` up to 500, metric is `steps`, `workout`, or `active_minutes`, `targetValue` is an integer 1–10,000,000, `endsAt` must be after `startsAt`, and `rewardPoints` is an integer 0–100,000 (default 0). `startsAt` defaults to now. Create response data is `{ "challenge": { ... } }` (`201`); list response data is `{ "challenges": [...] }` (`200`); badges response is `{ "badges": [...] }` (`200`). Invalid values return `400`; group challenge access before joining returns `403`.

### Android authentication endpoints

For completeness, Android obtains and refreshes tokens using these routes (all are under `/auth`):

| Method and path | Request body | Success |
|---|---|---:|
| `POST /auth/register` | `{name,email,password,companyCode?,goal?}` | `202` OTP challenge |
| `POST /auth/login` | `{identifier,password}` (`email` or `userId` aliases accepted) | `202` OTP challenge |
| `POST /auth/verify-otp` | `{challengeId,otp}` | `200` user and tokens |
| `POST /auth/refresh` | `{refreshToken}` | `200` rotated access and refresh tokens |
| `POST /auth/logout` | No body; bearer token | `200` |
| `POST /auth/google` | `{idToken}` | `200` user and tokens |
| `POST /auth/password/forgot` | `{email}` | `202` generic reset response |
| `POST /auth/password/reset` | `{challengeId,otp,password}` | `200` |

Register/login `202` response includes a `challengeId` and does not yet include an access token. Verify response supplies `accessToken` and `refreshToken`; persist them securely. Refresh rotates both tokens, so replace both stored values after each success. OTP/reset validation errors return `400`; credentials/token errors commonly return `401`; rate limits return `429`. Exact auth flow and token expiry details are also documented in `API_LIST.md`.

## Audit: Android APIs not available

- A standalone global users leaderboard endpoint is not implemented. Do not call or invent `/leaderboard`; use `/community/groups/:id/leaderboard` or `/rewards/competitions` for those leaderboard views.
- Admin and partner routes are excluded from this Android user API guide because they require separate authorization.
- The Android user routes discovered in `server.js` are covered in this guide: auth, health, activity, devices, wallet, rewards, redemptions, and community. Route handlers remain the source of truth if response objects gain additional fields.

## Retention and migration notes

No automatic TTL is configured for health records, revisions, daily settlements, or wallet transactions. Existing records are not automatically paid retroactively. Re-sync only records that can be assigned trustworthy stable identities/versions; reconcile prior wallet credits before importing activity into rewarded days.

## References in this repository

- Route definitions: `src/routes/health.routes.js`, `src/routes/activity.routes.js`, `src/routes/auth.routes.js`, `src/routes/wallet.routes.js`
- Record validation and ingestion: `src/services/health.service.js`, `src/services/activity-ingestion.service.js`
- Rule calculation and settlement: `src/services/daily-rules.js`, `src/services/daily-settlement.service.js`
- General route catalog: `API_LIST.md`
