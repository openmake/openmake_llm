<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# cache — LRU In-Memory Cache

## Purpose
Provides a lightweight LRU-based multi-layer in-memory cache for response caching and routing result caching. Exposes typed interfaces (`CacheOptions`, `CachedResponse`, `CachedRouting`) and pre-configured LRU cache instances consumed by the semantic cache layer in `chat/` and the agent router in `agents/`. This is a pure in-process cache with no external dependencies — it does not persist across restarts.

## Key Files
| File | Description |
|------|-------------|
| `index.ts` | Exports `CacheOptions`, `CachedResponse`, `CachedRouting` interfaces; creates and exports LRU cache instances |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Cache instances are singletons shared across the process — modifications affect all consumers
- TTL and max-size tuning belongs here; do not set cache options at call sites
- This cache is volatile: entries are lost on server restart; it is not a substitute for DB persistence
- The LRU eviction policy means recently used items survive under memory pressure; size limits prevent unbounded growth

### Testing Requirements
- Unit test cache hit/miss behaviour and TTL expiry independently
- Use `npm run test:bun` for fast iteration

### Common Patterns
- Import the pre-built instance rather than creating new `LRU` instances: `import { responseCache } from '@/cache'`
- Keys are typically SHA-256 hashes of the normalized query string
- Check `chat/semantic-cache.ts` for the primary consumer pattern

## Dependencies
### Internal
- `chat/semantic-cache.ts` — Primary consumer (L1 exact match cache)
- `agents/index.ts` — Routing result cache

### External
- `lru-cache` — LRU eviction implementation

<!-- MANUAL: -->
