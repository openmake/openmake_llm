/**
 * McpServerManifestValidator — MCPSERVER.md frontmatter Zod 검증.
 */
import {
    parseMcpServerFile,
    validateMcpServerManifest,
} from '../../../agents/git-ingest/mcp-server-manifest-validator';

const STDIO_VALID = `---
type: mcp-server
name: "PostgreSQL MCP"
description: "PostgreSQL DB 쿼리 MCP 서버"
category: database
transport_type: stdio
command: npx
args:
  - "-y"
  - "@modelcontextprotocol/server-postgres"
env:
  DATABASE_URL: "\${USER_DATABASE_URL}"
  LOG_LEVEL: info
required_env:
  - DATABASE_URL
version: "1.0.0"
---

# PostgreSQL MCP

Body content here.`;

describe('McpServerManifestValidator', () => {
    test('parseMcpServerFile — YAML frontmatter + body 분리', () => {
        const parsed = parseMcpServerFile(STDIO_VALID);
        expect(parsed.frontmatterYaml).toContain('type: mcp-server');
        expect(parsed.frontmatterYaml).toContain('transport_type: stdio');
        expect(parsed.body).toContain('# PostgreSQL MCP');
        expect(parsed.body).toContain('Body content here.');
    });

    test('validateMcpServerManifest — stdio + command 유효', async () => {
        const result = await validateMcpServerManifest(parseMcpServerFile(STDIO_VALID));
        expect(result.ok).toBe(true);
        expect(result.manifest.name).toBe('PostgreSQL MCP');
        expect(result.manifest.transport_type).toBe('stdio');
        expect(result.manifest.command).toBe('npx');
        expect(result.manifest.args).toEqual(['-y', '@modelcontextprotocol/server-postgres']);
        expect(result.manifest.env?.DATABASE_URL).toBe('${USER_DATABASE_URL}');
        expect(result.manifest.required_env).toEqual(['DATABASE_URL']);
    });

    test('type 이 잘못되면 거부', async () => {
        const text = STDIO_VALID.replace('type: mcp-server', 'type: skill');
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/mcp-server/);
    });

    test('stdio 에 command 없으면 거부', async () => {
        const text = STDIO_VALID.replace(/command: npx\n/, '');
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/command 필수/);
    });

    test('sse transport 에 url 없으면 거부', async () => {
        const text = `---
type: mcp-server
name: SSE Server
description: SSE test
category: util
transport_type: sse
version: "1.0.0"
---
body`;
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/sse transport 는 url 필수/);
    });

    test('required_env 가 env 에 없으면 거부', async () => {
        const text = `---
type: mcp-server
name: Test
description: req env missing
category: util
transport_type: stdio
command: /bin/true
required_env:
  - MISSING_KEY
version: "1.0.0"
---
body`;
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ')).toMatch(/MISSING_KEY.*env 에 정의되지 않음/);
    });

    test('version 이 semver 아니면 거부', async () => {
        const text = STDIO_VALID.replace('version: "1.0.0"', 'version: "1.0"');
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.join(' ').toLowerCase()).toMatch(/semver/);
    });

    test('url 이 유효한 URL 아니면 거부', async () => {
        const text = `---
type: mcp-server
name: Bad URL
description: invalid url
category: util
transport_type: streamable-http
url: not-a-url
version: "1.0.0"
---
body`;
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
    });

    test('args 50 개 초과 시 거부', async () => {
        const args = Array.from({ length: 51 }, (_, i) => `  - arg${i}`).join('\n');
        const text = `---
type: mcp-server
name: Too Many Args
description: args count over
category: util
transport_type: stdio
command: /bin/true
args:
${args}
version: "1.0.0"
---
body`;
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
    });

    test('YAML 파싱 실패 시 깔끔한 에러', async () => {
        const text = `---
not: valid: yaml: structure: here
---
body`;
        const r = await validateMcpServerManifest(parseMcpServerFile(text));
        expect(r.ok).toBe(false);
        expect(r.errors.length).toBeGreaterThan(0);
    });
});
