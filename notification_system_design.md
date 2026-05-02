# Stage 1

## REST API Design and Contract

### Headers (All API Requests)
- Authorization: Bearer <token>
- Content-Type: application/json
- Accept: application/json

### Core Actions

#### List notifications
- GET /notifications?studentId={id}&status=unread&limit=20&cursor={cursor}
- Response (200)
```json
{
  "notifications": [
    {
      "id": "uuid",
      "studentId": 1042,
      "type": "Placement",
      "message": "CSX Corporation hiring",
      "createdAt": "2026-04-22T17:51:18Z",
      "isRead": false,
      "priorityWeight": 3
    }
  ],
  "nextCursor": "opaque_cursor"
}
```

#### Mark a notification as read
- PATCH /notifications/{id}/read
- Request (empty body)
- Response (200)
```json
{
  "notification": {
    "id": "uuid",
    "studentId": 1042,
    "isRead": true,
    "readAt": "2026-04-22T17:55:00Z"
  }
}
```

#### Update notification preferences (subscription mechanism)
- PUT /notification-preferences/{studentId}
- Request
```json
{
  "channels": {
    "in_app": true,
    "email": true
  },
  "types": {
    "Placement": true,
    "Result": true,
    "Event": false
  },
  "quietHours": {
    "start": "22:00",
    "end": "07:00"
  }
}
```
- Response (200)
```json
{
  "studentId": 1042,
  "channels": {
    "in_app": true,
    "email": true
  },
  "types": {
    "Placement": true,
    "Result": true,
    "Event": false
  },
  "quietHours": {
    "start": "22:00",
    "end": "07:00"
  }
}
```

#### Get notification preferences
- GET /notification-preferences/{studentId}
- Response (200)
```json
{
  "studentId": 1042,
  "channels": {
    "in_app": true,
    "email": true
  },
  "types": {
    "Placement": true,
    "Result": true,
    "Event": false
  },
  "quietHours": {
    "start": "22:00",
    "end": "07:00"
  }
}
```

# Stage 2

## Storage Choice
I would pick PostgreSQL because we need strong consistency for read/unread state, flexible indexing for time-ordered reads, and reliable transactions for notification writes and preference updates.

## Schema (PostgreSQL)
```sql
CREATE TABLE students (
  id BIGINT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TYPE notification_type AS ENUM ('Event', 'Result', 'Placement');

CREATE TABLE notifications (
  id UUID PRIMARY KEY,
  student_id BIGINT NOT NULL REFERENCES students(id),
  notification_type notification_type NOT NULL,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ,
  priority_weight SMALLINT NOT NULL
);

CREATE TABLE notification_preferences (
  student_id BIGINT PRIMARY KEY REFERENCES students(id),
  in_app_enabled BOOLEAN NOT NULL DEFAULT true,
  email_enabled BOOLEAN NOT NULL DEFAULT true,
  placement_enabled BOOLEAN NOT NULL DEFAULT true,
  result_enabled BOOLEAN NOT NULL DEFAULT true,
  event_enabled BOOLEAN NOT NULL DEFAULT true,
  quiet_start TIME,
  quiet_end TIME,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_student_read_created
  ON notifications (student_id, is_read, created_at DESC);

CREATE INDEX idx_notifications_type_created
  ON notifications (notification_type, created_at DESC);
```

## Queries for Stage 1 APIs
- List notifications
```sql
SELECT * FROM notifications
WHERE student_id = $1 AND ($2::BOOLEAN IS NULL OR is_read = $2)
ORDER BY created_at DESC
LIMIT $3;
```

- Mark read
```sql
UPDATE notifications
SET is_read = true, read_at = NOW()
WHERE id = $1 AND student_id = $2
RETURNING *;
```

- Update preferences
```sql
INSERT INTO notification_preferences (
  student_id, in_app_enabled, email_enabled,
  placement_enabled, result_enabled, event_enabled,
  quiet_start, quiet_end
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (student_id) DO UPDATE
SET in_app_enabled = EXCLUDED.in_app_enabled,
    email_enabled = EXCLUDED.email_enabled,
    placement_enabled = EXCLUDED.placement_enabled,
    result_enabled = EXCLUDED.result_enabled,
    event_enabled = EXCLUDED.event_enabled,
    quiet_start = EXCLUDED.quiet_start,
    quiet_end = EXCLUDED.quiet_end,
    updated_at = NOW();
```

## Growth Concerns and Mitigations
- Large table scans: fix with composite indexes and pagination.
- Hot partitions: partition by created_at (monthly) and archive old data.
- Read pressure: add read replicas and cache common queries.
- Write amplification: batch inserts and use async delivery pipelines.

# Stage 3

## Query Review
Query:
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```
- Accuracy: correct for unread notifications, but it can return too many rows without LIMIT.
- Slowness: likely missing a composite index on (student_id, is_read, created_at DESC).
- Fix: add the composite index and use LIMIT with pagination.

### Recommended Index
```sql
CREATE INDEX idx_notifications_student_read_created
  ON notifications (student_id, is_read, created_at DESC);
```

### Why Not Index Every Column
Indexing every column adds storage and slows writes. It does not help queries that do not filter on those columns, so performance can get worse overall.

### Placement notifications in last 7 days
```sql
SELECT * FROM notifications
WHERE student_id = $1
  AND notification_type = 'Placement'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC;
```

# Stage 4

## Performance Improvements
- Cursor-based pagination to reduce large scans.
- Cache unread counts and recent notifications in Redis.
- Use WebSocket or SSE for real-time updates to avoid re-fetch on each page load.
- Add read replicas for heavy read traffic.

## Tradeoffs
- Caching lowers latency but requires careful cache invalidation on writes.
- WebSockets reduce DB reads but increase server resource usage.
- Read replicas reduce load but introduce replication lag.
- Pagination improves DB performance but requires client state management.

# Stage 5

## Issues in Current Pseudocode
- Sequential processing is slow and brittle.
- No retries or idempotency.
- Partial failures are not handled (200 emails failed).
- DB writes tied to external calls make failures more likely.

## Revised Design
- Write notifications first, then queue delivery jobs.
- Use worker pools for email and in-app delivery.
- Retry with exponential backoff and use a DLQ.
- Use idempotency keys to prevent duplicates.

### Revised Pseudocode
```
function notify_all(student_ids, message):
  job_id = create_bulk_job(student_ids, message)
  enqueue("notification_bulk", job_id)

worker notification_bulk:
  job = dequeue("notification_bulk")
  for student_id in job.student_ids:
    insert_notification(student_id, message)
    enqueue("email_delivery", {student_id, message})
    enqueue("in_app_delivery", {student_id, message})

worker email_delivery:
  task = dequeue("email_delivery")
  if send_email(task.student_id, task.message) fails:
    retry_with_backoff(task) or move_to_dlq(task)

worker in_app_delivery:
  task = dequeue("in_app_delivery")
  push_to_app(task.student_id, task.message)
```

# Stage 6

## Priority Inbox (Top 10)
Priority is based on weight and recency. I assign weights (Placement > Result > Event) and compute a combined score where weight dominates and timestamp breaks ties. To keep the top 10 current as new items arrive, I use a min-heap of size 10 and replace the smallest whenever a higher score appears.

The implementation is provided in [notification_app_be/src/priority.js](notification_app_be/src/priority.js).
