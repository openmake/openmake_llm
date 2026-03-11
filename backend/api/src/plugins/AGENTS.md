<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# plugins — Dynamic Plugin System

## Purpose
Provides a dynamic user plugin system that scans a configured plugin directory, loads valid third-party plugins at startup, and registers them with the plugin registry. `loader.ts` handles filesystem scanning and `require()`-based dynamic loading with error isolation (a broken plugin does not crash the server). `registry.ts` maintains the list of active plugins and provides lookup by name or capability. `types.ts` defines the `Plugin` interface that all plugins must implement.

## Key Files
| File | Description |
|------|-------------|
| `loader.ts` | Scans plugin directory, dynamically loads modules, isolates load errors |
| `registry.ts` | Active plugin registry — register, lookup by name/capability, list all |
| `types.ts` | `Plugin` interface: `name`, `version`, `capabilities`, `initialize()`, `destroy()` |

## Subdirectories
_None_

## For AI Agents
### Working In This Directory
- Plugin loading errors must be caught and logged, never propagated — a bad plugin must not prevent server startup
- The plugin directory path comes from `config/env.ts`; do not hardcode paths
- Plugins must implement the `Plugin` interface from `types.ts`; validate this at load time
- `registry.ts` is a singleton; plugins registered at startup persist for the server lifetime

### Testing Requirements
- Test loader with a mock plugin directory containing valid and invalid plugins
- Verify that a plugin throwing in `initialize()` does not prevent other plugins from loading
- Run `npm run test:bun`

### Common Patterns
- Plugin lifecycle: `loader.scan()` → `registry.register(plugin)` → `plugin.initialize(context)`
- Capability lookup: `registry.getByCapability('web-search')` returns matching plugins
- Shutdown: `plugin.destroy()` called for all plugins on graceful server shutdown

## Dependencies
### Internal
- `config/env.ts` — Plugin directory path
- `utils/logger.ts` — Plugin load/error logging
- `server.ts` — Triggers `loader.scan()` during bootstrap

### External
- `fs` (Node built-in) — Directory scanning
- `path` (Node built-in) — Plugin module path resolution

<!-- MANUAL: -->
