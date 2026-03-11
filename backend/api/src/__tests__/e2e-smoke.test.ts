process.env.OTEL_ENABLED = 'false';

describe('E2E Smoke Tests - Pipeline Integration', () => {
    it('SSRF guard exports validateOutboundUrl and safeFetch', async () => {
        const mod = await import('../security/ssrf-guard');
        expect(typeof mod.validateOutboundUrl).toBe('function');
        expect(typeof mod.safeFetch).toBe('function');
    });

    it('Ownership module exports assertResourceOwnerOrAdmin', async () => {
        const mod = await import('../auth/ownership');
        expect(typeof mod.assertResourceOwnerOrAdmin).toBe('function');
    });

    it('RAGService exports searchHybrid and reciprocalRankFusion', async () => {
        const mod = await import('../domains/rag/RAGService');
        expect(typeof mod.RAGService).toBe('function');
        expect(typeof mod.RAGService.prototype.searchHybrid).toBe('function');
        expect(typeof mod.reciprocalRankFusion).toBe('function');
    });

    it('Reranker module exports Reranker class', async () => {
        const mod = await import('../domains/rag/Reranker');
        expect(typeof mod.Reranker).toBe('function');
    });

    it('OCRQualityGate module exports core gate functions', async () => {
        const mod = await import('../domains/rag/OCRQualityGate');
        expect(typeof mod.assessTextQuality).toBe('function');
        expect(typeof mod.isTextQualityAcceptable).toBe('function');
        expect(typeof mod.assessAndGate).toBe('function');
    });

    it('KBRepository exports and can be referenced as class', async () => {
        const mod = await import('../data/repositories/kb-repository');
        expect(typeof mod.KBRepository).toBe('function');
    });

    it('RAGMetrics exports evaluation functions', async () => {
        const mod = await import('../domains/rag/rag-metrics');
        expect(typeof mod.calculateNDCG).toBe('function');
        expect(typeof mod.calculateMRR).toBe('function');
        expect(typeof mod.calculateContextPrecision).toBe('function');
        expect(typeof mod.calculateContextRecall).toBe('function');
    });

    it('OpenAICompatService generates valid completion IDs', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenAICompatService } = require('../routes/openai-compat.service');
        const id = OpenAICompatService.generateCompletionId();
        expect(id).toMatch(/^chatcmpl-/);
    });

    it('OpenAICompatService lists models in OpenAI format', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { OpenAICompatService } = require('../routes/openai-compat.service');
        const response = OpenAICompatService.listModels();
        expect(response.object).toBe('list');
        expect(response.data.length).toBeGreaterThan(0);
        expect(response.data[0].object).toBe('model');
    });

    it('OTel module exports core functions', async () => {
        const mod = await import('../observability/otel');
        expect(typeof mod.initTelemetry).toBe('function');
        expect(typeof mod.getTracer).toBe('function');
        expect(typeof mod.withSpan).toBe('function');
        expect(typeof mod.getCurrentTraceId).toBe('function');
        expect(typeof mod.shutdownTelemetry).toBe('function');
    });

    it('OTel withSpan executes function in no-op mode', async () => {
        const { withSpan } = await import('../observability/otel');
        const result = await withSpan('test', 'smoke', async () => 'smoke-ok');
        expect(result).toBe('smoke-ok');
    });

    it('Profile resolver lists available brand models', async () => {
        const mod = await import('../domains/chat/pipeline/profile-resolver');
        const models = mod.listAvailableModels();
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('id');
    });

    it('ChatRequestHandler exports processChat methods', async () => {
        const mod = await import('../domains/chat/pipeline/request-handler');
        expect(typeof mod.ChatRequestHandler.processChat).toBe('function');
        expect(typeof mod.ChatRequestHandler.resolveUserContextFromRequest).toBe('function');
    });
});
