/**
 * OpenTelemetry Basic Instrumentation
 * - stdout/file exporter (no Jaeger infrastructure needed)
 * - 10% sampling rate (M4 16GB resource consideration)
 * - HTTP auto-instrumentation
 * - Custom span helpers for DB, WebSocket, LLM calls
 */

import { context, Span, SpanKind, SpanStatusCode, trace, type Tracer } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { BatchSpanProcessor, ConsoleSpanExporter, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-node';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { createLogger } from '../utils/logger';

const logger = createLogger('OTel');

const OTEL_ENABLED = process.env.OTEL_ENABLED !== 'false';
const OTEL_SAMPLE_RATE_RAW = parseFloat(process.env.OTEL_SAMPLE_RATE || '0.1');
const OTEL_SAMPLE_RATE = Number.isFinite(OTEL_SAMPLE_RATE_RAW)
    ? Math.min(1, Math.max(0, OTEL_SAMPLE_RATE_RAW))
    : 0.1;
const OTEL_EXPORT_TO_CONSOLE = process.env.OTEL_EXPORT_CONSOLE === 'true';
const OTEL_OTLP_ENDPOINT = process.env.OTEL_OTLP_ENDPOINT;

let telemetrySdk: NodeSDK | null = null;
let telemetryInitAttempted = false;

function createFallbackSpan(tracerName: string, spanName: string, kind: SpanKind): Span {
    return trace.getTracer(tracerName).startSpan(spanName, { kind });
}

export function initTelemetry(): NodeSDK | null {
    if (!OTEL_ENABLED) {
        logger.info('OpenTelemetry disabled by OTEL_ENABLED=false');
        return null;
    }

    if (telemetrySdk) {
        return telemetrySdk;
    }

    if (telemetryInitAttempted) {
        return null;
    }

    telemetryInitAttempted = true;

    try {
        const spanProcessors: BatchSpanProcessor[] = [];

        if (OTEL_EXPORT_TO_CONSOLE) {
            spanProcessors.push(new BatchSpanProcessor(new ConsoleSpanExporter()));
        }

        if (OTEL_OTLP_ENDPOINT) {
            const otlpExporter = new OTLPTraceExporter({
                url: OTEL_OTLP_ENDPOINT,
            });
            spanProcessors.push(new BatchSpanProcessor(otlpExporter));
        }

        const sdk = new NodeSDK({
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: 'openmake-llm',
                [ATTR_SERVICE_VERSION]: '1.0.0',
            }),
            sampler: new TraceIdRatioBasedSampler(OTEL_SAMPLE_RATE),
            spanProcessors,
            instrumentations: [
                new HttpInstrumentation(),
                new ExpressInstrumentation(),
            ],
        });

        sdk.start();
        telemetrySdk = sdk;
        logger.info(`OpenTelemetry started (sampleRate=${OTEL_SAMPLE_RATE})`);
        return sdk;
    } catch (error: unknown) {
        logger.error('OpenTelemetry initialization failed', error);
        telemetrySdk = null;
        return null;
    }
}

export function getTracer(name: string): Tracer {
    return trace.getTracer(name);
}

export async function withSpan<T>(
    tracerName: string,
    spanName: string,
    fn: (span: Span) => Promise<T>,
    options?: { kind?: SpanKind; attributes?: Record<string, string | number | boolean> }
): Promise<T> {
    const kind = options?.kind ?? SpanKind.INTERNAL;

    if (!OTEL_ENABLED) {
        const fallbackSpan = createFallbackSpan(tracerName, spanName, kind);
        try {
            const result = await fn(fallbackSpan);
            return result;
        } finally {
            fallbackSpan.end();
        }
    }

    const tracer = getTracer(tracerName);
    const span = tracer.startSpan(spanName, { kind });

    if (options?.attributes) {
        for (const [key, value] of Object.entries(options.attributes)) {
            span.setAttribute(key, value);
        }
    }

    try {
        const result = await context.with(trace.setSpan(context.active(), span), async () => fn(span));
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
    } catch (error: unknown) {
        span.recordException(error instanceof Error ? error : new Error(String(error)));
        span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        span.end();
    }
}

export function getCurrentTraceId(): string | undefined {
    const activeSpan = trace.getSpan(context.active());
    if (!activeSpan) {
        return undefined;
    }
    return activeSpan.spanContext().traceId;
}

export async function shutdownTelemetry(): Promise<void> {
    if (!telemetrySdk) {
        return;
    }

    try {
        await telemetrySdk.shutdown();
        logger.info('OpenTelemetry shutdown completed');
    } catch (error: unknown) {
        logger.error('OpenTelemetry shutdown failed', error);
    } finally {
        telemetrySdk = null;
    }
}
