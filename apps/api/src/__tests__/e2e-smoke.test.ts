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

    it('OpenAICompatService generates valid completion IDs', () => {
         
        const { OpenAICompatService } = require('../services/OpenAICompatService');
        const id = OpenAICompatService.generateCompletionId();
        expect(id).toMatch(/^chatcmpl-/);
    });

    it('OpenAICompatService lists models in OpenAI format', () => {
         
        const { OpenAICompatService } = require('../services/OpenAICompatService');
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
        const mod = await import('../chat/profile-resolver');
        const models = mod.listAvailableModels();
        expect(Array.isArray(models)).toBe(true);
        expect(models.length).toBeGreaterThan(0);
        expect(models[0]).toHaveProperty('id');
    });

    it('ChatRequestHandler exports processChat methods', async () => {
        const mod = await import('../chat/request-handler');
        expect(typeof mod.ChatRequestHandler.processChat).toBe('function');
        expect(typeof mod.ChatRequestHandler.resolveUserContextFromRequest).toBe('function');
    });
});
