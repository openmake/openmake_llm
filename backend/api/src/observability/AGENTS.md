<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# observability — OpenTelemetry Tracing

## Purpose
Instruments the application with OpenTelemetry distributed tracing at 10% sampling rate. `otel.ts` initializes the OTLP trace exporter, configures the Node.js auto-instrumentation SDK (Express, HTTP, pg), and sets up the sampler. Trace context propagates through the request lifecycle via W3C TraceContext headers, enabling correlation across services in a distributed deployment.

## Key Files
| File | Description |
|------|-------------|
| `otel.ts` | OTel SDK initialization, OTLP exporter config, 10% probability sampler |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- `otel.ts` must be imported at the very top of `server.ts` before any other imports — SDK must register before instrumented modules load
- Sampling rate (10%) is configured here; adjust via environment variable, not hardcoded constant
- If `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, the SDK should be a no-op (graceful degradation)
- Do not add manual spans for every function — focus on boundaries: HTTP handlers, DB queries, LLM calls

### Testing Requirements
- Observability is tested via integration; unit tests should verify graceful no-op when OTLP endpoint is unset
- Do not block CI on OTLP endpoint availability

### Common Patterns
- Manual span: `const span = tracer.startSpan('llm.inference'); ... span.end()`
- Attribute naming: follow OTel semantic conventions (`http.method`, `db.statement`, `llm.model`)
- Error recording: `span.recordException(err); span.setStatus({ code: SpanStatusCode.ERROR })`

## Dependencies
### Internal
- `config/env.ts` — `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`

### External
- `@opentelemetry/sdk-node` — Node.js OTel SDK
- `@opentelemetry/exporter-trace-otlp-http` — OTLP HTTP exporter
- `@opentelemetry/auto-instrumentations-node` — Express, HTTP, pg auto-instrumentation

<!-- MANUAL: -->
