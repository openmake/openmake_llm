<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-11 | Updated: 2026-03-11 -->

# frontend/web/scripts

## Purpose
Frontend build and validation tooling. Contains scripts that verify the integrity of the ES Module architecture and catch broken module references before deployment. These scripts are invoked by `npm run build:frontend` and the CI pipeline.

## Key Files
| File | Description |
|------|-------------|
| `validate-modules.sh` | ES Module integrity verification. Scans all `<script type="module">` src attributes in HTML files and all `import` statements in JS files, then verifies each referenced path exists on disk. Fails with a non-zero exit code if any module reference is broken. |

## For AI Agents
### Working In This Directory
- Run `bash frontend/web/scripts/validate-modules.sh` after adding, removing, or renaming any JS file referenced by an import or script tag.
- This script is the primary guard against "module not found" errors that would silently break the SPA in production.
- Do not modify the script to suppress failures — fix the broken module reference instead.

### Testing Requirements
- The CI pipeline (`scripts/ci-test.sh` and `.github/workflows/ci.yml`) runs this script as part of the build gate.
- Run locally before committing any frontend JS changes.

### Common Patterns
- Script uses `grep` to extract module paths and `test -f` to verify file existence.
- Paths are resolved relative to `frontend/web/public/`.

## Dependencies
### Internal
- `frontend/web/public/` — scans HTML and JS files within this directory tree

### External
- `bash`, standard POSIX utilities (`grep`, `sed`, `test`)

<!-- MANUAL: -->
