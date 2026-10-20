# Eight-stage pipeline implementation plan

**Goal:** Implement the approved eight-stage flow with local + merged-dev basic/changed-feature testing, explicit human verification and verified releases.
**Spec:** docs/architecture/pipeline-flow-design.md
**Architecture:** existing GitHub CI, managed omk commands, small tested Node/Bash orchestration modules, SHA-stamped evidence.
**Global constraints:** Node24; Base/Add-on boundary unchanged; no runtime configuration/secrets in Git; no full browser suite by default; only explicit operator verify represents human OK.

## Task 1: Source inventory and canonical documentation
Inventory all workflow, command, tests, release and monitor interfaces. Update scripts/env/README.md and docs/architecture/env-flow.html to eight stages and publish a source-to-requirement audit. Retain dated backlog as history. Document current vs implemented vs activated state and local policy conflicts. Verify links and obsolete gate claims.

## Task 2: Managed environment pipeline
Files: scripts/env/omk.sh, new scripts/env/pipeline.sh and tests; scripts/pipeline/validate.mjs and tests. Add `omk env pipeline`, `hold`, `validate` and explicit SHA verify. Contracts: `<env-dir>/.pipeline/validation.json` {schemaVersion:1,stage:'staging-validation',sha,status:'passed'|'failed',checks,startedAt,finishedAt}; hold pins SHA. Reuse existing managed update, smoke, release checks. Test stale SHA, missing results, concurrent update, tag pinning and failure paths first. Preserve old manual commands but pipeline enforces stronger requirements. Schedules use existing PM2 mechanism. Verify shell tests and Node tests.

## Task 3: Merged-dev functional and selected feature tests
Files: scripts/ci/dev-checks*, scripts/ci/feature-checks*, tests/pipeline/*, .github/workflows/ci.yml, package.json. Boot disposable app/DB/model fixture; basic checks+changed source/spec selection. No arbitrary shell metadata. Record tested SHA; fail empty/unknown required coverage rather than claiming tested. Source CI stays. Test selector and real fixture/dev checks, then test infra/build/lint.

## Task 4: GitHub automation, release and external QA
Files: .github/workflows/promote.yml, new auto-merge/release workflows; scripts/pipeline/github* and tests. Trusted orchestration inspects current PR/SHA, event repository, CI and review. Successful exact merged-dev CI triggers promotion; use match-head-commit. Verification and every-commit metadata proof gates release merge. The read-only external scenario runner (bean) is owned by https://github.com/openmake/monitor (private, org access required), not this repository. Tests cover stale CI/PR head, missing token, unverified release, hidden dependency changes, reverted functional changes, failed/unknown remote probes. Never execute untrusted PR source in privileged jobs.

## Task 5: Integration and review
Run baseline and modified shell/Node tests, relevant API/frontend build checks, workflow structural checks and full required npm test. Independent whole-branch review; fix important findings. Create reviewable PR with exact evidence and activation checklist. Do not claim source merge/deploy or remote schedule activation without evidence.

## Review focus
- CI from a stale/fork/untrusted run cannot merge newer trusted code.
- Human-held staging cannot update between validation and verify.
- A passing health check cannot validate a different installed build.
- Release metadata cannot smuggle dependency/functional changes, even if later reverted.
- Missing credentials/scenarios/monitor records remain blocked or unmeasured, never completed.
