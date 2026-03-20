

type OtelModule = typeof import('../observability/otel');

const envSnapshot = { ...process.env };

function restoreEnv(): void {
    for (const key of Object.keys(process.env)) {
        if (!(key in envSnapshot)) {
            delete process.env[key];
        }
    }

    for (const [key, value] of Object.entries(envSnapshot)) {
        process.env[key] = value;
    }
}

async function loadOtelModule(): Promise<OtelModule> {
    // Jest는 bun과 달리 쿼리스트링 캐시 버스터를 지원하지 않으므로
    // jest.resetModules()로 모듈 캐시를 초기화한 뒤 require로 로드
    jest.resetModules();
    return require('../observability/otel') as OtelModule;
}

beforeEach(() => {
    restoreEnv();
});

afterEach(async () => {
    try {
        const otel = await loadOtelModule();
        await otel.shutdownTelemetry();
    } catch (_error) {
        // Test cleanup only; ignore module reload noise.
    }
    restoreEnv();
});

describe('observability/otel', () => {
    it('exports all expected functions', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        expect(typeof otel.initTelemetry).toBe('function');
        expect(typeof otel.getTracer).toBe('function');
        expect(typeof otel.withSpan).toBe('function');
        expect(typeof otel.getCurrentTraceId).toBe('function');
        expect(typeof otel.shutdownTelemetry).toBe('function');
    });

    it('getTracer returns a tracer object', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        const tracer = otel.getTracer('otel-test');
        expect(tracer).toBeDefined();
        expect(typeof tracer.startSpan).toBe('function');
    });

    it('getTracer does not throw for same name repeatedly', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        const tracerA = otel.getTracer('stable-name');
        const tracerB = otel.getTracer('stable-name');
        expect(tracerA).toBeDefined();
        expect(tracerB).toBeDefined();
    });

    it('getCurrentTraceId returns undefined without active span', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        expect(otel.getCurrentTraceId()).toBeUndefined();
    });

    it('withSpan executes async function and returns result', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        const result = await otel.withSpan('test', 'span.ok', async () => {
            return 'done';
        });

        expect(result).toBe('done');
    });

    it('withSpan rethrows errors from callback', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        return expect(
            otel.withSpan('test', 'span.error', async () => {
                throw new Error('boom');
            })
        ).rejects.toThrow('boom');
    });

    it('withSpan works before initTelemetry is called', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        const value = await otel.withSpan('test', 'span.preinit', async () => 42);
        expect(value).toBe(42);
    });

    it('withSpan callback receives span that accepts attributes', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        const result = await otel.withSpan('test', 'span.attrs', async (span) => {
            span.setAttribute('custom.string', 'value');
            span.setAttribute('custom.number', 7);
            span.setAttribute('custom.boolean', true);
            return 'ok';
        }, {
            attributes: {
                'root.tag': 'root',
                'root.count': 1,
                'root.flag': true,
            },
        });

        expect(result).toBe('ok');
    });

    it('initTelemetry returns null when OTEL_ENABLED=false', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        expect(otel.initTelemetry()).toBeNull();
    });

    it('initTelemetry initializes SDK when enabled', async () => {
        process.env.OTEL_ENABLED = 'true';
        process.env.OTEL_EXPORT_CONSOLE = 'false';
        delete process.env.OTEL_OTLP_ENDPOINT;
        const otel = await loadOtelModule();

        const sdk = otel.initTelemetry();
        expect(sdk).toBeDefined();
        expect(sdk).not.toBeNull();
        await otel.shutdownTelemetry();
    });

    it('shutdownTelemetry does not throw when not initialized', async () => {
        process.env.OTEL_ENABLED = 'false';
        const otel = await loadOtelModule();

        return expect(otel.shutdownTelemetry()).resolves.toBeUndefined();
    });
});
