# Vehicle Maintenance Scheduler Architecture

## Overview
This backend service builds an optimal daily maintenance plan for each depot. It pulls depot hour budgets and vehicle tasks from the evaluation service, runs a knapsack-style planner, and returns the schedule through a simple HTTP API.

## Core Components
- API server (Express) exposes /health and /schedule.
- Upstream data client fetches depots and vehicles from the evaluation service.
- Planner computes the best set of tasks within the mechanic-hours limit.
- Logging middleware sends structured logs to the evaluation log endpoint.

## Request Flow
1. Client calls GET /schedule (optionally with depotId).
2. API reads the Authorization header (Bearer token).
3. API forwards the token to the evaluation service to fetch depots and vehicles.
4. Planner computes the best task set for each depot.
5. API returns the schedules as JSON.
6. Each major step writes a log event via Log(stack, level, package, message).

## Data Flow
- Input: depots (ID, MechanicHours) and vehicles (TaskID, Duration, Impact).
- Output: for each depot, a list of tasks with totalDuration and totalImpact.

## Algorithm
- 0/1 knapsack dynamic programming by mechanic-hours.
- Uses a DP array for scores and a keep matrix to rebuild the chosen tasks.

## Error Handling
- Missing or invalid depotId returns 400.
- Upstream failures return 502 with source details.
- All failures are logged with level error or fatal.

## Observability
- All requests and key actions are logged through the logging middleware.
- Logs include request timing and upstream fetch outcomes.

## Scaling Notes
- Stateless API nodes are easy to scale horizontally.
- The planner runs per request; for large data sizes, consider caching results or precomputing per depot.

## Security
- Bearer token is required for upstream calls to the evaluation service.
- No user registration or login flows.
