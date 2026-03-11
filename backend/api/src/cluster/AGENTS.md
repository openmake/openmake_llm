<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# cluster — Distributed Ollama Node Pool

## Purpose
Manages a distributed pool of Ollama nodes with health-checking, latency-based node selection, and a 3-state circuit breaker per node. `ClusterManager` is a singleton that maintains the node registry, periodically pings nodes for health, tracks response latencies, and selects the optimal node for each request. The circuit breaker (`circuit-breaker.ts`) prevents cascading failures by opening the circuit after repeated failures and resetting after a cooldown window.

## Key Files
| File | Description |
|------|-------------|
| `manager.ts` | `ClusterManager` singleton — node registry, health checks, latency-based selection |
| `circuit-breaker.ts` | 3-state circuit breaker (Closed/Open/Half-Open) per cluster node |
| `multiClient.ts` | Multi-node Ollama client that routes requests through ClusterManager |
| `config.ts` | Cluster configuration — node URLs, health check intervals, failure thresholds |
| `types.ts` | TypeScript types for cluster nodes, health status, circuit breaker state |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `ClusterManager` is a singleton — get the instance via the exported factory, never construct directly
- Circuit breaker states: `CLOSED` (normal), `OPEN` (failing, requests blocked), `HALF_OPEN` (probe request allowed)
- Health checks run on a timer; do not call health check manually in request paths
- Latency tracking uses an exponential moving average — short spikes do not immediately affect routing
- Node list is configured via environment variables in `config/env.ts`, not hardcoded here

### Testing Requirements
- Circuit breaker state transitions must be unit tested (Closed→Open, Open→Half-Open, Half-Open→Closed/Open)
- Mock individual node HTTP responses to test failover behaviour
- Run `npm run test:bun`

### Common Patterns
- `ClusterManager.selectNode()` returns the best available node or throws `AllNodesFailedError`
- Import `AllNodesFailedError` from `errors/all-nodes-failed.error.ts` for error handling
- Always check circuit breaker state before attempting a request to a node

## Dependencies
### Internal
- `errors/all-nodes-failed.error.ts` — Thrown when all nodes are unavailable
- `errors/circuit-open.error.ts` — Thrown when a specific node circuit is open
- `config/env.ts` — Node URLs and cluster settings
- `ollama/client.ts` — Underlying HTTP client per node

### External
- `axios` — HTTP health check pings

<!-- MANUAL: -->
