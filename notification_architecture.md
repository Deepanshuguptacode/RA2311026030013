# Campus Notifications Architecture

## Overview
This backend service acts as a thin API layer for campus notifications. It calls the evaluation Notifications API, returns data to clients, and computes a priority inbox (top N) based on type weight and recency.

## Core Components
- API server (Express) exposes /health, /notifications, and /notifications/priority.
- Upstream data client fetches notifications from the evaluation service.
- Priority engine ranks and selects the top N notifications.
- Logging middleware sends structured logs to the evaluation log endpoint.

## Request Flow
1. Client calls GET /notifications or /notifications/priority.
2. API reads the Authorization header (Bearer token).
3. API forwards the token to the evaluation service notifications endpoint.
4. For /notifications/priority, the priority engine selects the top N items.
5. API returns JSON responses and logs each step.

## Priority Logic
- Placement > Result > Event (weights 3, 2, 1).
- Score = weight * large constant + timestamp.
- Uses a size-N min-heap to keep the best N efficiently as new data arrives.

## Error Handling
- Missing Authorization header returns 401.
- Upstream failures return 502 with source details.
- All failures are logged with level error.

## Observability
- Every request and data fetch is logged using the Log function.
- Logs include endpoint, status, and duration.

## Scaling Notes
- Stateless API nodes can scale horizontally.
- Priority selection is in-memory per request; if traffic grows, add caching or precompute top N.

## Security
- Bearer token is required to call the protected evaluation API.
- No user registration or login flows.
