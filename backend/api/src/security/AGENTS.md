<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# security — SSRF Protection

## Purpose
Provides Server-Side Request Forgery (SSRF) protection for all outbound HTTP requests made by the application. `ssrf-guard.ts` validates target URLs against a blocklist of private IP ranges (RFC 1918, loopback, link-local, metadata endpoints) before allowing the request to proceed. Any module that makes outbound HTTP requests on behalf of user-supplied URLs must pass them through the SSRF guard first.

## Key Files
| File | Description |
|------|-------------|
| `ssrf-guard.ts` | URL validation against private/reserved IP ranges; throws on blocked destinations |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- **Every outbound HTTP request triggered by user input must call `ssrfGuard(url)` before the request** — this is a security requirement
- Blocked ranges include: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, cloud metadata endpoints (`169.254.169.254`)
- DNS rebinding is a risk: resolve the hostname and check the resolved IP, not just the URL string
- Do not add allowlist exceptions without explicit security review

### Testing Requirements
- Test with private IPs in all blocked ranges — must be rejected
- Test with public IPs — must be allowed
- Test with hostnames that resolve to private IPs (DNS rebinding scenario)
- Run `npm run test:bun`

### Common Patterns
- Usage: `await ssrfGuard(userUrl); const response = await axios.get(userUrl)`
- Throws `SSRFBlockedError` (or similar) on blocked URL; caller maps to 400 Bad Request
- Applied in: `mcp/web-search.ts`, `mcp/firecrawl.ts`, `mcp/external-client.ts`

## Dependencies
### Internal
- Called by: `mcp/web-search.ts`, `mcp/external-client.ts`, any service making outbound requests

### External
- `dns` (Node built-in) — Hostname resolution for DNS rebinding protection
- `net` (Node built-in) — IP range checking

<!-- MANUAL: -->
