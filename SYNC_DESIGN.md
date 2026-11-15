# ImmuTrack: Offline-First Backend Sync & Database Design (Next Phase)

> **Status:** Architectural specification for the post-prototype pilot phase.
> In the current prototype, all records live on-device (`localStorage` key `immutrack.v1` with JSON backup/restore) and SMS reminders are simulated (`status: 'simulated'`). Nothing leaves the device during the demo.

---

## 1. Design Principles & Constraints

1. **Offline-First Always:** The browser (`store.js`) remains the immediate source of truth for the UI. Reads and writes never block on network availability. Sync happens asynchronously in the background when connectivity returns.
2. **Preserve Client UUIDs:** Every child record is already assigned a client-generated UUID v4 (`crypto.randomUUID()`) at enrolment. The backend uses this exact `id` as the primary key, eliminating ID-mapping tables.
3. **Event-Based Visit Completions (Conflict-Free):** Instead of overwriting a single JSON blob per child, visit completions and undo actions are stored as discrete, timestamped events (`visit_events`) and folded into a materialised `visits` projection (`ON CONFLICT (child_id, visit_key) DO UPDATE`). Two nurses marking different visits—or the same visit—offline on two clinic tablets will never clobber each other's records.
4. **Idempotent Batch Upload:** Sync payloads carry deterministic client IDs (`id` for children, `(child_id, visit_key, client_event_id)` for visit events). Repeating a `POST /api/v1/sync` batch after a dropped 3G connection is a safe no-op.
5. **Single Clinic Now, Multi-Clinic Ready:** Every table includes `clinic_id UUID NOT NULL` from day one so scaling from one pilot clinic to multiple Primary Health Centres (PHCs) requires zero schema migration.
6. **Roles & Access Control:** Two staff roles only (`health_worker` and `clinic_admin`). Caregivers/parents do **not** have logins; they receive SMS/voice reminders on basic phones.
7. **Data Residency & Compliance:** Before storing real patient PII (child names, DOBs, caregiver phone numbers), the PostgreSQL database must be hosted in a jurisdiction compliant with the **Nigeria Data Protection Act (NDPA) 2023** and NPHCDA health-data guidelines (e.g., local Nigerian cloud tier or EU/South Africa region with encrypted-at-rest volumes and signed DPA).

---

## 2. Recommended Stack

- **On-Device Store (`store.js`):** Keep the synchronous `Store` public API (`load`, `save`, `addChild`, `updateChild`, `setDone`, etc.) and swap the internal persistence layer from `localStorage` to **IndexedDB** (`idb` object stores: `children`, `visits`, `message_log`, `outbox`).
- **Database:** **PostgreSQL 16** (via **Supabase** or self-hosted PostgreSQL) with **Row-Level Security (RLS)** enforcing `clinic_id` isolation.
- **Sync & SMS API:** Lightweight serverless functions (Supabase Edge Functions or Netlify Functions) behind HTTPS.
- **SMS Provider Seam:** Server-side adapter (`SmsProvider`) connecting to **Termii** or **Africa's Talking** (supporting Nigerian DND transactional healthcare routes) once a sender ID is registered. **Browser code never holds an API key.**

---

## 3. PostgreSQL Schema

```sql
-- 1. Clinics & Staff Roles
CREATE TABLE clinics (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL CHECK (char_length(name) <= 60),
  verified    BOOLEAN NOT NULL DEFAULT false,
  verified_by TEXT NOT NULL DEFAULT '',
  templates   JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE staff_role AS ENUM ('health_worker', 'clinic_admin');

CREATE TABLE staff_members (
  user_id     UUID PRIMARY KEY, -- maps to auth.users.id
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  role        staff_role NOT NULL DEFAULT 'health_worker',
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Children (uses existing client-generated UUIDs)
CREATE TABLE children (
  id          UUID PRIMARY KEY, -- generated offline by store.js uid()
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  dob         DATE NOT NULL,
  phone       TEXT NOT NULL CHECK (phone ~ '^\+234[789][0-9]{9}$'),
  alt_phone   TEXT NOT NULL DEFAULT '',
  consent     BOOLEAN NOT NULL DEFAULT false,
  deleted_at  TIMESTAMPTZ,      -- soft tombstone so offline deletes propagate
  created_at  TIMESTAMPTZ NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_children_clinic_updated ON children (clinic_id, updated_at);

-- 3. Visit Events (append-only log of completions & undos so conflicts are rare)
CREATE TABLE visit_events (
  event_id    UUID PRIMARY KEY, -- generated offline when nurse taps Mark Done / Undo
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  child_id    UUID NOT NULL REFERENCES children(id),
  visit_key   TEXT NOT NULL CHECK (visit_key IN ('wk6', 'wk10', 'wk14', 'm9', 'm15')),
  done_date   DATE,             -- YYYY-MM-DD when marked done, NULL when undone
  recorded_by UUID REFERENCES staff_members(user_id),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Materialised Visit State (derived from latest visit_event per (child_id, visit_key))
CREATE TABLE visits (
  child_id    UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  visit_key   TEXT NOT NULL CHECK (visit_key IN ('wk6', 'wk10', 'wk14', 'm9', 'm15')),
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  done_date   DATE,
  updated_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (child_id, visit_key)
);

CREATE INDEX idx_visits_clinic_updated ON visits (clinic_id, updated_at);

-- 5. Message Log (idempotent per (child_id, visit_key, type, send_on))
CREATE TABLE message_log (
  clinic_id   UUID NOT NULL REFERENCES clinics(id),
  child_id    UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  visit_key   TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('reminder', 'recall')),
  send_on     DATE NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('simulated', 'queued', 'sent', 'failed')),
  text        TEXT NOT NULL,
  provider_id TEXT,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (child_id, visit_key, type, send_on)
);
```

### Role Permissions (Row-Level Security)
- **`health_worker`**: Can `SELECT`, `INSERT`, and `UPDATE` `children`, `visit_events`, and `visits` where `clinic_id` matches their assigned clinic; can read `message_log`.
- **`clinic_admin`**: All `health_worker` permissions plus ability to update `clinics` settings (`name`, `templates`, `verified`, `verified_by`), export clinic backups, and manage `staff_members`.

---

## 4. Client Changes (`store.js`) for Sync

To prepare `store.js` without changing its public API:
1. Add `updatedAt` (ISO-8601 timestamp) to every child record on `addChild()`, `updateChild()`, and soft-delete (`deletedAt` + `updatedAt` on `removeChild()`).
2. Whenever `setDone(childId, visitKey, date)` is called, append an immutable event to `state.outbox`:
   ```js
   {
     eventId: uid(),
     childId: childId,
     visitKey: visitKey,
     doneDate: date, // "YYYY-MM-DD" or null
     occurredAt: new Date().toISOString()
   }
   ```
3. Store `lastSyncCursor` (server `TIMESTAMPTZ`) in `state`.

---

## 5. Idempotent Batch Sync Protocol (`POST /api/v1/sync`)

When the device is online (and periodically or on `online` / `visibilitychange`), the client sends one batch request:

### Request Payload
```json
{
  "clinicId": "e4b0...0001",
  "since": "2026-11-15T08:00:00.000Z",
  "children": [
    {
      "id": "8f14e45f-ceea-467a-9538-15d25c92b911",
      "name": "Amina",
      "dob": "2026-10-04",
      "phone": "+2348031234567",
      "altPhone": "",
      "consent": true,
      "createdAt": "2026-11-15T09:12:00.000Z",
      "updatedAt": "2026-11-15T09:12:00.000Z",
      "deletedAt": null
    }
  ],
  "visitEvents": [
    {
      "eventId": "c39a1102-41bc-4f21-b9d2-9081726354aa",
      "childId": "8f14e45f-ceea-467a-9538-15d25c92b911",
      "visitKey": "wk6",
      "doneDate": "2026-11-15",
      "occurredAt": "2026-11-15T10:05:12.000Z"
    }
  ]
}
```

### Server Merge Rules (Single Transaction)
1. **Children Upsert (Last-Write-Wins by `updated_at`):**
   ```sql
   INSERT INTO children (id, clinic_id, name, dob, phone, alt_phone, consent, created_at, updated_at, deleted_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
   ON CONFLICT (id) DO UPDATE
   SET name       = EXCLUDED.name,
       dob        = EXCLUDED.dob,
       phone      = EXCLUDED.phone,
       alt_phone  = EXCLUDED.alt_phone,
       consent    = EXCLUDED.consent,
       updated_at = EXCLUDED.updated_at,
       deleted_at = COALESCE(EXCLUDED.deleted_at, children.deleted_at)
   WHERE EXCLUDED.updated_at >= children.updated_at;
   ```
2. **Visit Events Insert & Materialised State Update:**
   - `INSERT INTO visit_events ... ON CONFLICT (event_id) DO NOTHING;` (safe to retry any number of times).
   - Fold into `visits`:
     ```sql
     INSERT INTO visits (child_id, visit_key, clinic_id, done_date, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (child_id, visit_key) DO UPDATE
     SET done_date  = EXCLUDED.done_date,
         updated_at = EXCLUDED.updated_at
     WHERE EXCLUDED.updated_at >= visits.updated_at
        OR (visits.done_date IS NULL AND EXCLUDED.done_date IS NOT NULL);
     ```
     *(Completion wins over stale null if timestamps tie.)*
3. **Delta Pull Response:**
   - Server returns `serverTime` (`newCursor`) plus all `children`, `visits`, and `message_log` rows for `clinic_id` where `updated_at > since`.
   - Client merges incoming records, clears acknowledged `visitEvents` from `state.outbox`, and advances `lastSyncCursor = serverTime`.

---

## 6. Real SMS Delivery Seam (`processToday`)

In the prototype, `processToday(t)` in `app.js` writes `status: 'simulated'` locally. In production:
1. **Server-Side Scheduler (preferred):** A daily cron job (e.g., 07:00 WAT) runs the exact same pure `Schedule` module (`schedule.js` already runs in Node via `module.exports`) against the clinic's `children` (`consent = true` and `deleted_at IS NULL`) and `visits` (`done_date IS NULL`).
2. **Provider Interface:**
   ```js
   // server/sms-provider.js
   async function sendSms({ to, text, idempotencyKey }) {
     // Calls Termii / Africa's Talking REST API using process.env.SMS_API_KEY
     // Never exposed to browser client.
   }
   ```
3. **Deduplication:** The composite primary key `(child_id, visit_key, type, send_on)` in `message_log` guarantees a caregiver is never sent the same reminder or recall twice.
