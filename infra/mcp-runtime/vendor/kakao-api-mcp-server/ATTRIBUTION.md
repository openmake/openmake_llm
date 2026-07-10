# Vendored: kakao-api-mcp-server

- **출처(Origin):** https://github.com/jeong-sik/kakao-api-mcp-server
- **커밋:** `bf8bbdb2d6f882dbbba20082a5b9e93fefd39ed0`
- **라이선스:** MIT (원본 `LICENSE` 동봉)
- **벤더링 일자:** 2026-07-10

## 적용한 수정 (openmake_llm 통합용)
원본은 npm 미배포 + `package.json` 의존성 누락으로 그대로는 빌드/실행이 안 되어, 아래를 수정해 벤더링함:

1. **`package.json` 의존성 정정** — 코드가 import 하는데 누락됐던 런타임 deps 추가:
   `zod`, `yargs`, `dotenv`, `axios`(devDep→dep). 빌드용 `typescript`, `@types/node`,
   `@types/yargs` 를 devDeps 에 추가. `bin`(`dist/index.js`) · `files:["dist"]` ·
   `prepare: npm run build` · `main: dist/index.js` 추가.
2. **`src/index.ts` 최상단 shebang** `#!/usr/bin/env node` 추가.
3. **Yarn PnP 잔재 제거** (`.pnp.cjs` 등) — npm 클린 빌드용.

## 실행 방식
mcp-runtime 이미지 빌드 시 `/home/node/kakao-mcp` 에 설치·빌드되며(`../../Dockerfile`),
MCP 카탈로그(`db/migrations/063_mcp_kakao_catalog.sql`)가
`node /home/node/kakao-mcp/dist/index.js --mode=stdio` 로 Docker 샌드박스 안에서 실행한다.
인증은 `KAKAO_REST_API_KEY`(사용자별 암호화 env).
