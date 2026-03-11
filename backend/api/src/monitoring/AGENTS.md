<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# monitoring — Analytics and Alerting

## Purpose
Real-time analytics dashboard engine and multi-channel alert system. `analytics.ts` aggregates request metrics, model usage statistics, latency percentiles, and error rates into time-bucketed snapshots consumed by the admin dashboard. `alerts.ts` evaluates metric thresholds and dispatches notifications across configured channels (email, webhook). `metrics.ts` provides the counters and gauge primitives that other modules increment.

## Key Files
| File | Description |
|------|-------------|
| `analytics.ts` | Time-bucketed metric aggregation; powers admin dashboard data endpoints |
| `alerts.ts` | Threshold-based alert evaluation and multi-channel notification dispatch |
| `metrics.ts` | Counter, gauge, and histogram primitives incremented throughout the app |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Metrics increments must be non-blocking and non-throwing — wrap in try/catch to prevent analytics from crashing request handling
- Alert thresholds are configured via environment variables or admin settings; do not hardcode them
- Analytics snapshots are stored in memory (rolling window); they do not persist across restarts
- Keep `metrics.ts` primitives simple — counter (increment only), gauge (set), histogram (observe value)

### Testing Requirements
- Unit test metric aggregation with known inputs and expected output buckets
- Test alert evaluation: threshold not exceeded (no alert), threshold exceeded (alert dispatched)
- Mock notification channels in alert tests
- Run `npm run test:bun`

### Common Patterns
- Metric increment: `metrics.increment('chat.requests.total', { model: modelName })`
- Alert check: runs on a configurable interval via `setInterval` in `alerts.ts`
- Analytics endpoint consumes: `analytics.getSnapshot(timeRange)` returning bucketed data

## Dependencies
### Internal
- `config/env.ts` — Alert channel configuration, notification credentials
- `utils/logger.ts` — Metric collection errors
- `data/repositories/` — Persisting alert history if needed

### External
- `nodemailer` — Email alert channel (conditional on SMTP config)
- No metrics storage dependency — all in-memory

<!-- MANUAL: -->
