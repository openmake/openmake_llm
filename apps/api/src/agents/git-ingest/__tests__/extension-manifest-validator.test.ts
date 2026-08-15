import {
    validateExtensionManifest,
    parseMcpJsonFile,
    normalizeMcpServers,
} from '../extension-manifest-validator';

describe('extension-manifest-validator', () => {
    describe('validateExtensionManifest', () => {
        it('유효한 최소 plugin.json', () => {
            const r = validateExtensionManifest(JSON.stringify({
                name: 'my-plugin',
                version: '1.0.0',
            }));
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.manifest.name).toBe('my-plugin');
            expect(r.manifest.mcpServers).toHaveLength(0);
        });

        it('mcpServers 포함 plugin.json — stdio/http 정규화', () => {
            const r = validateExtensionManifest(JSON.stringify({
                name: 'tool-pack',
                version: '2.1.0',
                description: 'desc',
                mcpServers: {
                    local: { command: 'npx', args: ['-y', '@scope/server'] },
                    remote: { url: 'https://mcp.example.com/mcp' },
                },
            }));
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.manifest.mcpServers).toEqual([
                expect.objectContaining({ name: 'local', transportType: 'stdio', command: 'npx' }),
                expect.objectContaining({ name: 'remote', transportType: 'streamable-http', url: 'https://mcp.example.com/mcp' }),
            ]);
        });

        it('raw 는 원문 유지 ($schema 등 미정의 필드 보존)', () => {
            const r = validateExtensionManifest(JSON.stringify({
                $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
                name: 'my-plugin',
                version: '1.0.0',
            }));
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.manifest.raw.$schema).toBe('https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
        });

        it('JSON 파싱 실패', () => {
            const r = validateExtensionManifest('{ not json');
            expect(r.ok).toBe(false);
            if (r.ok) return;
            expect(r.errors[0]).toContain('유효한 JSON');
        });

        it('name kebab-case 위반 거부', () => {
            const r = validateExtensionManifest(JSON.stringify({ name: 'My Plugin', version: '1.0.0' }));
            expect(r.ok).toBe(false);
        });

        it('version 누락 거부', () => {
            const r = validateExtensionManifest(JSON.stringify({ name: 'my-plugin' }));
            expect(r.ok).toBe(false);
        });

        it('레거시 SSE transport 거부', () => {
            const r = validateExtensionManifest(JSON.stringify({
                name: 'my-plugin',
                version: '1.0.0',
                mcpServers: { old: { url: 'https://x.example.com/sse', type: 'sse' } },
            }));
            expect(r.ok).toBe(false);
            if (r.ok) return;
            expect(r.errors[0]).toContain('SSE');
        });
    });

    describe('normalizeMcpServers', () => {
        it('command 도 url 도 없으면 에러', () => {
            const r = normalizeMcpServers({ broken: {} });
            expect(r.servers).toHaveLength(0);
            expect(r.errors[0]).toContain('command 또는 url 필수');
        });
    });

    describe('parseMcpJsonFile', () => {
        it('mcpServers wrapper 형식', () => {
            const r = parseMcpJsonFile(JSON.stringify({
                mcpServers: { fs: { command: 'npx', args: ['@modelcontextprotocol/server-filesystem'] } },
            }));
            expect(r.errors).toHaveLength(0);
            expect(r.servers).toHaveLength(1);
            expect(r.servers[0].name).toBe('fs');
        });

        it('최상위 record 축약형', () => {
            const r = parseMcpJsonFile(JSON.stringify({
                fs: { command: 'npx' },
            }));
            expect(r.servers).toHaveLength(1);
        });

        it('JSON 파싱 실패', () => {
            const r = parseMcpJsonFile('nope');
            expect(r.servers).toHaveLength(0);
            expect(r.errors[0]).toContain('유효한 JSON');
        });
    });
});
