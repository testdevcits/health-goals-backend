# Developer API Guide

Base URL (local, default port): **`http://localhost:5000/api/v1`**

Server URL: `http://localhost:5000`  
Health check: `GET http://localhost:5000/api/health`

`PORT` change hone par URL mein port bhi change karein. Deployed backend ka domain is guide mein assume nahi kiya gaya hai. Android emulator se local backend ke liye `http://10.0.2.2:5000/api/v1` use karein; physical phone par reachable computer LAN IP use karein.

Neeche har endpoint ka path Base URL ke baad add hoga. Example: `/auth/login` ka full URL `http://localhost:5000/api/v1/auth/login` hai.

## Headers aur access

JSON body wale requests mein:

```http
Content-Type: application/json
```

Protected APIs mein OTP verification se mila access token bhejein:

```http
Authorization: Bearer <accessToken>
```

Public = token nahi chahiye. User = logged-in active user. Admin = logged-in user jiska email backend ke `ADMIN_EMAILS` allowlist mein hai. Sirf body mein `admin: true` bhejne se admin permission nahi milti.

## 1. Authentication

| Method | Path | Access | Kaam / input |
|---|---|---|---|
| POST | `/auth/register` | Public | Account registration OTP shuru karein. Body: `name`, `email`, `password` (8–72 characters), optional `companyCode` and `goal`. Account OTP verify hone par banta hai. |
| POST | `/auth/login` | Public | Password check ke baad OTP challenge. Body: `identifier` (email ya public User ID), `password`. `email` aur `userId` aliases bhi supported hain. |
| POST | `/auth/verify-otp` | Public | Body: `challengeId`, `otp`. Successful verification par user aur tokens milte hain. |
| POST | `/auth/password/forgot` | Public | Body: `email`. Account ho to 6-digit password reset code bhejta hai. |
| POST | `/auth/password/reset` | Public | Body: `challengeId`, `otp`, `password` (8–72 characters). Password update karke existing sessions revoke karta hai. |
| POST | `/auth/google` | Public | Body: verified Google `idToken`. Backend token verify karke existing account sign in karta hai ya naya user account banata hai. Requires `GOOGLE_CLIENT_ID`. |
| POST | `/auth/refresh` | Public | Body: `refreshToken`. Naya access token aur rotated refresh token deta hai. |
| POST | `/auth/logout` | User | Session revoke karein; body required nahi. |
| GET | `/auth/me` | User | Current user profile. |
| PATCH | `/auth/me` | User | Profile fields update karein: optional `name`, `goal`, `heightCm` (50–300), `weightKg` (20–500), `birthDate` (`DD/MM/YYYY`). Email read-only hai. |
| PATCH | `/auth/me/goals` | User | Daily health goal save karein. Body: `metricType` (`steps`, `sleep`, `heart_rate`, `stress`) aur numeric `targetValue`. |
| POST | `/auth/me/device` | User | Current account ke profile mein phone metadata save/update karein. Body: `deviceIdentifier`, `manufacturer`, `brand`, `model`, `platform`, `osVersion`, `appVersion`. Hardware serial/IMEI na bhejein. |

Login/register HTTP `202` par `data.challengeId` dete hain, token nahi. Login response mein `maskedEmail` bhi milta hai. Uske baad verify request karein:

```json
{"challengeId":"<challengeId>","otp":"123456"}
```

`123456` sirf `APP_MODE=dev` ka fixed OTP hai; live mode mein emailed OTP use karein. OTP 5 minutes valid hai, maximum 5 attempts; resend ke liye 60 seconds baad initial login/register request repeat karein. Purana code invalidate hota hai.

Verification response ke `data.accessToken` aur `data.refreshToken` save karein. Session fixed 1 hour ka hai; access token maximum 15 minutes ka. Refresh session deadline extend nahi karta. Refresh response ke dono naye tokens replace karein; same refresh token dobara use na karein. `sessionExpiresAt` aur `accessTokenExpiresAt` epoch milliseconds mein hain. Session expire hone par dobara login + OTP karein.

Login example:

```json
{"identifier":"user@example.com","password":"password123"}
```

Registration example:

```json
{"name":"Test User","email":"user@example.com","password":"password123"}
```

## 2. Devices — 3 APIs (User)

| Method | Path | Kaam / input |
|---|---|---|
| GET | `/devices` | User ke devices ki list. |
| POST | `/devices` | Device register karein. Required: `deviceType`, `deviceIdentifier`. Optional: `manufacturer`, `model`, `platform` (default `android`). |
| DELETE | `/devices/:id` | Apna device remove karein; `:id` device ka internal ID hai. |

```json
{"deviceType":"phone","deviceIdentifier":"android-device-001","manufacturer":"Samsung","model":"Galaxy","platform":"android"}
```

## 3. Health data — 5 APIs (User)

| Method | Path | Kaam / input |
|---|---|---|
| POST | `/health/records` | Ek health record save/update karein. Neeche payload dekhein. New record `201`, duplicate `200`. |
| POST | `/health/sync` | Batch upload: `{"records":[...]}`; 1–100 records per request. |
| GET | `/health/records` | Apne records; optional `metricType`. Is endpoint par pagination/date filters implemented nahi hain; paginated list ke liye `/activity/records` use karein. |
| GET | `/health/history` | Daily aggregated metric history; `metricType`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD` required. |
| GET | `/health/summary` | Health metrics ka summary. |
| GET | `/health/dashboard` | Dashboard ke liye combined data. |

Record ke required fields: `metricType`, `value`, `unit`, `recordedAt`, `source`, `sourceRecordId`. Optional fields mein `deviceId`, `sourceVersion`, `startTime`, `endTime`, `dataOrigin`, `recordingMethod`, `activityType`, `metadata`, `deleted` shamil hain. `deviceId` diya ho to woh logged-in user ka hona chahiye.

```json
{
  "metricType":"steps",
  "value":4000,
  "unit":"count",
  "recordedAt":"2026-10-20T09:30:00+05:30",
  "startTime":"2026-10-20T09:30:00+05:30",
  "endTime":"2026-10-20T10:30:00+05:30",
  "source":"health_connect",
  "sourceRecordId":"steps-stable-id-001",
  "sourceVersion":1,
  "dataOrigin":"com.example.tracker",
  "recordingMethod":"automatic"
}
```

Supported metrics: `steps`, `workout`, `meditation`, `water_checkin`, `sleep_checkin`, `running`, `walking`, `heart_rate`, `sleep`, `oxygen_saturation`, `weight`, `blood_pressure`, `calories`, `distance`, `active_minutes`.

Coins ke liye steps mein valid interval, origin aur automatic/active recording metadata chahiye. Workout/meditation mein interval timestamps bhejein; workout mein `activityType` bhi. Habits ke liye `value: 1`, `unit: "checkin"` use karein. Interval ko IST midnight par split karein.

Same user + source + sourceRecordId ki same/older version duplicate hai. Correction ke liye higher `sourceVersion` bhejein. Source record invalidate karne ke liye higher version ke saath `deleted: true` aur original required fields bhejein. Batch partially save ho sakta hai; same IDs/versions ke saath retry karein.

Sync se instant coins credit nahi hote. IST day complete hone ke baad worker settlement karta hai; late data ka additional entitlement baad mein credit ho sakta hai. Detailed ingestion rules: [ACTIVITY_API.md](ACTIVITY_API.md). Current rule versions ke liye admin `/admin/coin-rules` dekhein.

## 4. Activity / daily coins — 4 APIs (User)

| Method | Path | Kaam / query |
|---|---|---|
| GET | `/activity/today` | Aaj ka progress, entitlement, credited/pending coins aur saved rules. Optional `day=YYYY-MM-DD` se doosra IST day. |
| GET | `/activity/history` | Daily settlement history; `page`, `limit`. |
| GET | `/activity/records` | Paginated apne raw records; `page`, `limit`, `q`, `from`, `to`, `metricType`. |
| GET | `/activity/transactions` | Paginated coin ledger; `page`, `limit`. |

Example: `/activity/records?page=1&limit=20&metricType=steps&from=2026-10-01&to=2026-10-20`.

## 5. Wallet, rewards aur redemptions — 5 APIs (User)

| Method | Path | Kaam |
|---|---|---|
| GET | `/wallet` | Wallet balance, transactions aur `dailyActivity`. Embedded transactions maximum 100; older ledger ke liye `/activity/transactions`. |
| GET | `/rewards` | Available reward catalogue. |
| POST | `/rewards/:id/redeem` | Reward redeem karein; `:id` catalogue se reward ID. Body required nahi. |
| GET | `/redemptions` | Apni redemption history. |
| GET | `/redemptions/:id` | Ek apni redemption ki details. |

## 6. Groups aur challenges (User)

| Method | Path | Kaam |
|---|---|---|
| GET | `/community/groups` | Apne groups list karein. |
| GET | `/community/groups/discover` | Public groups list karein. |
| POST | `/community/groups` | Group banayein: `name`, optional `description`, `emoji`, `private`. Creator automatically member hota hai. |
| GET | `/community/groups/:id` | Group details; private group sirf members ke liye. |
| POST | `/community/groups/:id/join` | Group join karein. |
| GET/POST | `/community/groups/:id/messages` | Joined members ka chat history/send; send body `message`. |
| GET/POST | `/community/groups/:id/challenges` | Group challenges list/create. |
| GET | `/community/challenges` | Active challenges list karein. |
| POST | `/community/challenges` | Challenge banayein: `title`, `metricType`, `targetValue`, `endsAt`, optional `description`, `startsAt`, `rewardPoints`. |
| POST | `/community/challenges/:id/join` | Challenge join karein. |
| GET | `/community/badges` | Synced health activity se earned badges aur progress. |

## 7. Admin (Admin only)

Yahan `:id` user ka **internal `id`** hai; `USR-...` wala permanent `publicId` login/display ke liye hai.

| Method | Path | Kaam / input |
|---|---|---|
| GET | `/admin/overview` | User/record/device counts aur recent records. |
| GET | `/admin/users` | Paginated users; `page`, `limit`, `q`, `from`, `to`, `status`. |
| GET | `/admin/records` | Paginated records; `page`, `limit`, `q`, `from`, `to`, `userId`, `metricType`. |
| GET | `/admin/devices` | Paginated devices; `page`, `limit`, `q`, `from`, `to`, `userId`, `status`, `platform`, `model`. |
| GET | `/admin/rewards` | Paginated reward catalogue including inactive/out-of-stock entries; `page`, `limit`. |
| GET | `/admin/redemptions` | Paginated redemption history with user and reward details; `page`, `limit`. |
| POST | `/admin/rewards` | Reward create karein; `name`, `description`, `pointsCost`, optional `stock`, `imageUrl`, `isActive`. |
| PATCH | `/admin/rewards/:id` | Reward details, stock, ya active state update karein. |
| GET | `/admin/users/:id` | Profile, wallet, record/device counts aur `canChangeStatus`. |
| PATCH | `/admin/users/:id/status` | Body: `{"status":"ACTIVE"}` ya `{"status":"SUSPENDED"}`. Self/admin accounts ka status yahan change nahi hota. Status change existing sessions revoke karta hai. |
| GET | `/admin/users/:id/steps` | Date-wise reported/counted steps; `page`, `limit`, `from`, `to`. |
| GET | `/admin/users/:id/daily` | User ke daily coins/progress; optional `day=YYYY-MM-DD`. |
| GET | `/admin/users/:id/settlements` | Daily settlement breakdown; `page`, `limit`, `from`, `to`. |
| GET | `/admin/users/:id/transactions` | User coin ledger; `page`, `limit`. |
| POST | `/admin/users/:id/activities` | Audited manual entry; body neeche. Coins normal settlement se milte hain. |
| GET | `/admin/coin-rules` | Current/latest/baseline coin rules aur version history; `page`, `limit`. |
| POST | `/admin/coin-rules` | New rule version schedule karein; `baseVersion`, `note`, complete `rules` object. |
| GET | `/admin/settlements/status` | Worker enabled state, timezone, batch/concurrency aur state counts. |

`/admin/coin-rules` ke GET aur POST alag APIs hain.

Manual activity example:

```json
{
  "entryId":"admin-water-20261020-001",
  "metricType":"water_checkin",
  "value":1,
  "day":"2026-10-20",
  "note":"Verified user check-in"
}
```

`entryId` 16–80 letters/digits/hyphens ka unique ID ho; retries mein same ID rakhein. `note` required, maximum 500 characters. Supported types: `steps`, `workout`, `meditation`, `water_checkin`, `sleep_checkin`. Steps/workout/meditation ke liye `startTime`, `endTime` required; workout ke liye supported `activityType` bhi. Start selected IST day se match hona chahiye. Manual steps coins nahi earn karte.

Coin-rule save mein pehle GET response ka `data.latest.version` lein aur `baseVersion` bhejein:

```json
{
  "baseVersion":"<data.latest.version>",
  "note":"Update daily incentive settings",
  "rules":{
    "dailyCap":20,
    "stepsPerTier":2000,
    "stepTierCoins":2,
    "stepMaxCoins":8,
    "workoutMinutes":20,
    "workoutCoins":5,
    "meditationMinutes":5,
    "meditationCoins":2,
    "waterCheckinCoins":1,
    "sleepCheckinCoins":2
  }
}
```

Numbers example hain; current settings GET se load karein. Accepted version next IST midnight se effective hota hai. Stale `baseVersion` par `409`: reload karke changes review karein. Existing user/day rule snapshots preserve hote hain.

## Pagination, dates aur responses

Paginated APIs default `page=1`, `limit=20`; allowed `limit` 1–100. Lists generally `data.items`, `total`, `page`, `limit` deti hain; `totalPages` sirf un responses par use karein jahan present ho. Device/reward/redemption aur legacy health lists par pagination assume na karein.

Raw/admin record lists ke `from`/`to` inclusive UTC dates hain. Daily coins, step history aur settlement day filters Asia/Kolkata calendar dates hain. Activity timestamps ISO 8601 timezone offset ke saath bhejein.

Success envelope:

```json
{"success":true,"message":"...","data":{}}
```

Error envelope:

```json
{"success":false,"error":{"code":"API_ERROR","message":"...","details":null}}
```

Common statuses: `200` success, `201` created, `202` OTP challenge, `400` invalid input, `401` invalid/expired authentication, `403` access denied, `404` missing resource, `409` conflict, `429` rate limit, `503` unavailable service (for example live OTP email configuration).

## Suggested app integration order

1. Register/login → verify OTP → save tokens and expiry times.
2. `/auth/me` se session/profile fetch karein; refresh expiry se pehle token rotate karein.
3. Device register karein → Android se data read karke `/health/sync` bhejein.
4. Dashboard aur `/activity/today` se progress/pending coins dikhayein.
5. `/wallet`, activity history aur ledger se credited coins dikhayein.
6. Rewards catalogue → redeem → redemption history.
7. Admin screens mein allowlisted session se admin APIs call karein.

Source: current backend route/controller/service implementation. Total: **37 versioned APIs + 1 public server health check = 38 method-path combinations**. This guide documents code; live server connectivity is not verified here.
