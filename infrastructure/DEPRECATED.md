# ⚠️ DEPRECATED - Infrastructure Folder

**Status**: DEPRECATED (2026-01-29)

## Overview

This folder contains **legacy/duplicate code** that is NO LONGER USED by the main application.

All active code has been consolidated into:
- **Monitoring**: `/backend/api/src/monitoring/`
- **Auth**: `/backend/api/src/auth/`
- **Security**: `/backend/api/src/middlewares/`

## Why This Exists

This folder was likely created during early development or for a planned infrastructure-as-code setup that was never completed.

## Do NOT Use

- Do not import from this folder
- Do not modify files here (they are out of sync with active codebase)
- Consider deleting this folder entirely after reviewing contents

## Active Alternatives

| This Folder | Use Instead |
|-------------|-------------|
| `monitoring/analytics.ts` | `backend/api/src/monitoring/analytics.ts` |
| `security/auth/index.ts` | `backend/api/src/auth/index.ts` |
| `security/auth/middleware.ts` | `backend/api/src/auth/middleware.ts` |
| `security/auth/oauth-provider.ts` | `backend/api/src/auth/oauth-provider.ts` |

## Cleanup Recommendation

```bash
# After confirming no external dependencies:
rm -rf infrastructure/
```
