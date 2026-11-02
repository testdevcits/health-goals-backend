# Health App Backend

Node.js, Express.js, MongoDB REST API backend for the Health App project.

## Install

```bash
cd health-app/backend
npm install
```

## Configure MongoDB

Run MongoDB locally, then use this connection string:

```env
MONGODB_URI=mongodb://localhost:27017/health_app
```

The server uses these MongoDB collections:

- `users`
- `health_records`

## Configure `.env`

Copy `.env.example` to `.env` and set local values:

```env
PORT=5000
NODE_ENV=development
USE_MONGODB=true
MONGODB_URI=mongodb://localhost:27017/health_app
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000
```

Never commit real credentials.

For local API testing without MongoDB, set:

```env
USE_MONGODB=false
```

When `USE_MONGODB=false`, the server uses temporary in-memory storage. Data resets whenever the server restarts. For real development or production, set `USE_MONGODB=true` and configure MongoDB.

## Run

```bash
npm start
```

Development mode:

```bash
npm run dev
```

## API Endpoints

- `GET /api/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/devices`
- `POST /api/v1/devices`
- `DELETE /api/v1/devices/:id`
- `POST /api/v1/health/sync`
- `POST /api/v1/health/records`
- `GET /api/v1/health/records`
- `GET /api/v1/health/summary`
- `GET /api/v1/health/dashboard`
- `GET /api/v1/wallet`
- `GET /api/v1/rewards`
- `POST /api/v1/rewards/:id/redeem`
- `GET /api/v1/redemptions`
- `GET /api/v1/redemptions/:id`

Protected endpoints require:

```http
Authorization: Bearer <jwt_token>
```

## Examples

Test server health:

```bash
curl http://localhost:5000/api/health
```

Register:

```bash
curl -X POST http://localhost:5000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Test User","email":"test@example.com","password":"password123"}'
```

Login:

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123"}'
```

Create a Health Connect-ready record:

```bash
curl -X POST http://localhost:5000/api/v1/health/records \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{
    "metricType": "heart_rate",
    "value": 78,
    "unit": "bpm",
    "recordedAt": "2026-09-22T12:30:00Z",
    "source": "health_connect",
    "sourceRecordId": "hc-record-123",
    "deviceId": "device-id"
  }'
```

Sync Health Connect-ready records:

```bash
curl -X POST http://localhost:5000/api/v1/health/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt_token>" \
  -d '{
    "records": [
      {
        "metricType": "running",
        "value": 5,
        "unit": "km",
        "recordedAt": "2026-09-22T10:00:00Z",
        "source": "test",
        "sourceRecordId": "test-running-001",
        "deviceId": "device-id"
      }
    ]
  }'
```

The backend uses `userId + source + sourceRecordId` for duplicate protection, so repeated syncs do not award points twice.

Get records:

```bash
curl http://localhost:5000/api/v1/health/records \
  -H "Authorization: Bearer <jwt_token>"
```

Get dashboard:

```bash
curl http://localhost:5000/api/v1/health/dashboard \
  -H "Authorization: Bearer <jwt_token>"
```

## Supported Metric Types

- `steps`
- `heart_rate`
- `sleep`
- `oxygen_saturation`
- `weight`
- `blood_pressure`
- `calories`
- `distance`
- `active_minutes`

## Future Data Flow

```text
Smartwatch / Phone
↓
Health Connect
↓
Android Health App
↓
Health API
↓
This Backend
↓
MongoDB
```

This backend does not connect directly to Health Connect, Apple HealthKit, or smartwatch-specific APIs.

## Email OTP authentication (updated contract)

`POST /api/v1/auth/register` and `POST /api/v1/auth/login` now return HTTP **202**, with:

```json
{"success":true,"message":"Verification code sent to your email","data":{"requiresOtp":true,"challengeId":"challenge-uuid","expiresIn":300,"resendAfter":60}}
```

They do **not** issue tokens. Register does not create a user until verification.

Then call `POST /api/v1/auth/verify-otp`:

```json
{"challengeId":"challenge-uuid","otp":"123456"}
```

A correct code returns the user, `token` (access-token alias), `accessToken`, and `refreshToken`. All clients, including Android, must implement this second step. Old tokens without OTP verification are rejected. Repeat the initial register/login request after 60 seconds to resend; the previous code becomes invalid. Codes expire after 5 minutes and permit 5 attempts. Authentication endpoints are IP-rate-limited.

Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` in backend `.env`. Email is required: missing configuration returns 503, without exposing an OTP or issuing tokens. Use a provider-approved sender and credentials. Real email delivery must be verified after configuration.

Set `ADMIN_EMAILS` to a comma-separated server-controlled list of approved admin emails. Public registration never accepts a client-supplied role. The admin frontend adds `admin: true` to register/login requests to reject unapproved addresses early; admin APIs independently enforce the allowlist on every request.

Admin endpoints, requiring an OTP-verified access token and approved email:

- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/users`
- `GET /api/v1/admin/records`
- `GET /api/v1/admin/devices`

List query parameters: `page`, `q`, `from`, `to`; records also support `metricType` and `userId`. Lists return `{items,total,page,limit}` with 20 items per page by default (`limit`: 1–100). Date filters and the overview's daily count use UTC. MongoDB lists filter, project, sort, skip and limit in the database; overview uses count queries and fetches only eight recent records. Compound indexes cover list order, per-user records/devices, and status/metric filters. Text search escapes regex characters and caps query length; substring searches and very deep offset pages may still be expensive at large scale.

The React admin UI is in `../frontend`; see its README for startup instructions. Keep backend JWT secrets strong and unique. Enable MongoDB for persistent data and OTP state. Logout clears the refresh token and increments authVersion, immediately revoking issued access tokens.

Run `npm test` for OTP, admin authorization, and app-sync integration coverage. Tests use in-memory storage and mocked email delivery; they do not validate live SMTP/MongoDB connectivity.


## Admin user management

- `GET /api/v1/admin/users/:id`: public user profile, read-only wallet balance, health-record/device counts and whether status changes are permitted.
- `PATCH /api/v1/admin/users/:id/status` with `{"status":"SUSPENDED"}` or `{"status":"ACTIVE"}`: change regular-user access and record an audit entry. Self/allowlisted admin status changes are blocked.
- Status changes clear refresh tokens and increment an authentication version. Previously issued access/refresh tokens remain invalid after reactivation. Suspended users cannot sign in or call protected APIs.
- Lists support `limit=10|20|50|100` in the UI (API accepts 1–100), `page`, escaped `q`, inclusive UTC `from`/`to`, plus `status`, `userId`, and `metricType` where applicable. Responses include `totalPages`.
- MongoDB indexes are declared in model schemas. Ensure the new indexes have been built on existing deployed databases before assessing performance. Query counts and page retrieval run concurrently; totals may change during concurrent writes.
- Development memory storage retains array-based filtering; MongoDB-side pagination applies when `USE_MONGODB=true`. No production latency benchmark or live database query-plan verification has been performed.

## Development / live OTP mode

Set `APP_MODE=dev` in backend `.env` for local testing: registration, login and resend create a normal challenge with the fixed OTP **123456**, without calling SMTP. Password validation, admin approval, expiry, cooldown and attempt limits still apply. The frontend displays development instructions instead of claiming an email was sent.

Set `APP_MODE=live` to send randomly generated codes through SMTP. This is the default if the variable is omitted. Restart the backend and request a fresh challenge after changing modes; challenges from the other mode are rejected. `NODE_ENV=production` with `APP_MODE=dev` is rejected at startup. Keep `APP_MODE=live` for deployed production services.


## Midnight daily coin settlement

Health sync no longer issues instant task rewards. It stores activities and queues a durable user/day settlement. At midnight IST, a persistent worker processes at most 20 user/day jobs per pass, with concurrency 2; repeat/late syncs credit only the additional daily entitlement. Steps, workouts, meditation and habit check-ins use a saved versioned daily rule snapshot.

See [ACTIVITY_API.md](ACTIVITY_API.md) for Android payloads, current reward amounts, pending/history/ledger APIs, batch/retry behavior, source-version updates, correction policy and retention requirements. Your MongoDB must support transactions (replica set/Atlas); the worker requires persistent MongoDB. Set `SETTLEMENT_ENABLED=false` only to pause scheduling, not to remove the replica-set requirement. No historical health/coin data is automatically expired; database backup/restore operations still need to be configured separately.


## One-hour sessions and permanent User IDs

OTP verification starts a fixed one-hour session. Access tokens last at most 15 minutes; refresh tokens expire at the same one-hour session deadline and rotate on use. `/auth/refresh` returns new tokens plus `sessionExpiresAt` and `accessTokenExpiresAt` (epoch milliseconds) without extending the original deadline. Rotation is conditional on the previous stored hash so a refresh token cannot be successfully consumed twice concurrently. Refresh token hashes use SHA-256 before bcrypt to avoid bcrypt's token-length truncation. Tokens issued before this session contract require a fresh login.

Each account receives a permanent unique `publicId`, such as `USR-A1B2C3D4E5F6`. It is server-assigned and protected by a unique sparse MongoDB index. Existing accounts can be backfilled idempotently with `node scripts/backfill-user-ids.js`; IDs already assigned are preserved. Internal MongoDB IDs remain API path identifiers.

## Login with email or public User ID

`POST /api/v1/auth/login` accepts `{"identifier":"USR-A1B2C3D4E5F6","password":"..."}` or an email in `identifier`. Existing `email` clients remain supported; `userId` is also accepted as a public-ID alias. Public IDs are case-insensitive and always resolve to the account's stored registered email, never a client-supplied OTP destination. Password verification is followed by the same mandatory OTP challenge. The response includes `maskedEmail` for the verification screen. Admin login still checks the resolved account email against `ADMIN_EMAILS`; User IDs do not grant roles. Development mode uses 123456 without email, and live mode emails the linked account.

### Admin coin rules and daily coins

- `GET /api/v1/admin/coin-rules?page=1&limit=10`: today's rules, latest version, original baseline, paginated append-only history and next effective date.
- `POST /api/v1/admin/coin-rules`: `{baseVersion, note, rules}`. Send the latest version as `baseVersion` and all numeric settings: `dailyCap`, `stepsPerTier`, `stepTierCoins`, `stepMaxCoins`, `workoutMinutes`, `workoutCoins`, `meditationMinutes`, `meditationCoins`, `waterCheckinCoins`, `sleepCheckinCoins`. Stale/concurrent saves return 409; every accepted save inserts a new version with its author and reason. No edit/delete endpoint exists.
- New versions apply from the next midnight in Asia/Kolkata. For multiple saves scheduled for the same day, the latest version wins. Existing user/day snapshots never change; newly synced historical days select the version effective on their activity date. Late corrections keep the day's saved rules. A rule change never rewrites health records or wallet transactions.
- `GET /api/v1/admin/users/:id/daily?day=YYYY-MM-DD`: live entitlement, pending coins, credited coins and saved rules for that day.
- `GET /api/v1/admin/users/:id/settlements?page=1&limit=10&from=YYYY-MM-DD&to=YYYY-MM-DD`: daily breakdown, original rule snapshot and settlement status. Pending rows calculate against the saved snapshot. Activity breakdowns are before the overall daily cap.
- `GET /api/v1/admin/users/:id/transactions?page=1&limit=10`: actual wallet ledger and balance after each transaction.
- `POST /api/v1/admin/users/:id/activities`: add an audited manual activity with `{entryId, metricType, value, day, note, startTime?, endTime?, activityType?}`. Reuse the same unique `entryId` when retrying a submission. Supported types: steps, workout, meditation, water_checkin, sleep_checkin. Send interval times with explicit timezone offsets; the selected day is IST. Workouts need a supported activity type. Entries use the existing ingestion/settlement pipeline, not a direct wallet credit. Manual steps do not earn coins; workout/meditation use actual interval duration; walking/running workouts do not earn extra workout rewards. Future intervals and invalid dates are rejected.

In the admin UI, open **Coin rules** to create a version. Open **Users → user → Daily coins** for day-wise earnings, pending amounts, the transaction ledger, and **Add activity record**. `npm run db:seed:demo` idempotently adds seven historical days and today's pending check-in to the dedicated `demo.health.user@example.test` account, settling only that account's eligible historical days through the normal coin calculation and wallet transaction flow. It requires development mode and persistent MongoDB with transactions.
