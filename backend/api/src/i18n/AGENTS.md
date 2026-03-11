<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# i18n — Internationalization

## Purpose
Centralized multilingual string management with locale fallback. `index.ts` provides `getLocaleContent(locale, key)` for retrieving translated strings and `interpolate(template, vars)` for variable substitution. `search-locale.ts` maps language codes to the appropriate search API locale parameters (e.g., mapping `ko` → `lang_ko` for web search). Falls back to English (`en`) when a requested locale is unavailable.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | `getLocaleContent()` with fallback chain; `interpolate()` for `{variable}` substitution |
| `search-locale.ts` | Language code to search API locale parameter mapping |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Always add new string keys to all supported locales simultaneously — partial translations cause fallback to English silently
- `interpolate()` uses `{key}` syntax; do not use template literals inside locale strings
- `search-locale.ts` mappings affect web search result language; test new language mappings with the actual search API

### Testing Requirements
- Test fallback behaviour: request a key in a locale that doesn't have it and verify English is returned
- Test `interpolate()` with missing variables (should leave `{key}` unchanged or replace with empty string — pick one and document)
- Run `npm run test:bun`

### Common Patterns
- Usage: `const msg = getLocaleContent(userLocale, 'error.quota_exceeded')`
- With interpolation: `interpolate(getLocaleContent(locale, 'greeting'), { name: user.name })`
- Locale files are JSON or TS objects; keys use dot notation

## Dependencies
### Internal
- `config/env.ts` — Default locale setting
- Used by: `services/ChatService.ts`, `sockets/ws-chat-handler.ts`, `mcp/web-search.ts`

### External
- None

<!-- MANUAL: -->
