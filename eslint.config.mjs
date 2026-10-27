import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "apps/web/**",
      // Companion 헬퍼 하네스 — CommonJS spawn 하네스라 require 가 필수.
      // 앱 소스가 아니라 lint 대상에서 제외.
      "apps/desktop-native/helper/harness.cjs",
      "apps/desktop-windows/test/smoke.cjs",
      "apps/desktop-windows/src/preload.cjs",
      "**/node_modules/**",
      "**/.claude/**",
      "**/*.min.js",
      "jest.config.js",
      "ecosystem.config.js",
      "scripts/build-info.js",
      // .env 를 읽어 포트를 해석하는 부팅 전 스크립트 — pm2/next 설정이 require 로 로드한다.
      // build-info.js 와 동일 취급(앱 소스 아님).
      "scripts/resolve-ports.cjs",
      "scripts/audit-gate.cjs",
      "scripts/tsc7.cjs",
      // CommonJS 로 dist 를 직접 로드하는 운영 스크립트(빌드 산출물 require 필요) —
      // build-info.js 와 동일 취급. 앱 소스가 아니라 lint 대상에서 제외한다.
      "scripts/eval/*.js",
      "playwright.config.ts",
      "tests/e2e/**",
      "**/*.d.ts",
      "mcp-venv/**",
      "coverage/**",
      // 로컬 git worktree — 각자 eslint.config.mjs 를 가진 저장소 사본이다. 함께 읽으면
      // typescript-eslint 가 tsconfig 루트 후보를 여러 개 보고 모든 파일에서 파싱 오류를 낸다.
      ".worktrees/**",
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "max-lines": [
        "warn",
        {
          max: 400,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
    },
  },
  // Declarative data file 예외 — locale / OpenAPI spec / test fixture 은
  // 자연 크기가 큼. max-lines 룰은 logic file 가독성 정책이라 적용 부적합.
  {
    files: [
      "**/__tests__/**/*.test.ts",
      "**/*.test.ts",
      "**/locales/**/*.ts",
      "apps/api/src/**/*locales*.ts",
      "apps/api/src/chat/language-policy.ts",
      "apps/api/src/chat/prompt-templates.ts",
      "apps/api/src/swagger/paths-*.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  // 계층 경계 강제 — 현재 지켜지고 있는(위반 0) 규율에 강제 장치를 붙여, 급한 PR 한 번에
  // 무너지는 것을 막는다. 룰을 늘릴 때는 반드시 "현재 위반 0" 을 먼저 측정할 것
  // (routes→repository 는 이 레포의 확립된 DI 패턴이므로 금지 대상이 아니다).
  {
    // Base ↔ Add-on 경계 (config/addon-boundary.ts) — addons/ 번들은 addon-host 만 읽는다.
    // services 블록이 같은 룰을 다시 정의하므로(뒤 블록이 옵션을 덮는다) 거기에도 같은 patterns 를 둔다.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/addon-host/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: ["**/addons/**"], message: "Base 는 Add-on 콘텐츠를 직접 import 하지 않는다 — addon-host 를 경유할 것(config/addon-boundary.ts)." }] },
      ],
    },
  },
  {
    files: ["apps/api/src/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "express",
              message:
                "services 는 HTTP 를 알지 않는다 — req/res 는 controller 가 다루고, 에러는 throw 해 middlewares/error-handler.ts 가 상태코드로 매핑한다.",
            },
          ],
          patterns: [{ group: ["**/addons/**"], message: "Base 는 Add-on 콘텐츠를 직접 import 하지 않는다 — addon-host 를 경유할 것(config/addon-boundary.ts)." }],
        },
      ],
    },
  },
  {
    // routes 는 배선(미들웨어·검증·핸들러 호출)만 담당한다. SQL 직접 실행은 repository
    // 또는 data/ 데이터 계층 함수를 경유해야 재시도 래퍼·쿼리 관례가 일관되게 적용된다.
    // repository 생성자에 getPool() 을 주입하는 것(이 레포의 DI 관례)은 금지 대상이 아니다.
    files: ["apps/api/src/routes/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.property.name='query'][callee.object.name='pool']",
          message:
            "routes 에서 SQL 직접 실행 금지 — data/repositories 의 repository 나 data/ 계층 함수를 경유할 것(getPool() 을 repository 생성자에 주입하는 것은 허용).",
        },
        {
          selector: "CallExpression[callee.property.name='query'][callee.object.property.name='pool']",
          message:
            "routes 에서 SQL 직접 실행 금지 — data/repositories 의 repository 나 data/ 계층 함수를 경유할 것.",
        },
        {
          selector: "CallExpression[callee.object.callee.name='getPool']",
          message:
            "routes 에서 getPool().query(...) 직접 실행 금지 — repository 나 data/ 계층 함수를 경유할 것.",
        },
      ],
    },
  },
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/**"],
              message:
                "packages 는 apps 를 참조하지 않는다(의존성 역전 금지) — 공통 계약·상수만 담고, 방향은 apps → packages 단방향을 유지한다.",
            },
          ],
        },
      ],
    },
  },
  {
    // 계약 패키지(@openmake/plugin-contracts)는 타입·상수만 — apps·외부 패키지·자기 디렉터리 밖을 import 하지 않는다(런타임 의존 0).
    // 바로 위 packages/*/src 블록과 같은 룰이라 이 블록이 옵션을 덮어쓴다(뒤 블록이 이긴다) — 그래서 apps 금지 패턴도 다시 둔다.
    files: ["packages/plugin-contracts/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/**"],
              message:
                "packages 는 apps 를 참조하지 않는다(의존성 역전 금지) — 공통 계약·상수만 담고, 방향은 apps → packages 단방향을 유지한다.",
            },
            {
              regex: "^(?!\\.{1,2}/)",
              message: "계약 패키지는 런타임 의존이 없다 — 외부 패키지를 import 하지 않는다(타입·상수만).",
            },
            {
              regex: "^\\.\\./\\.\\./",
              message: "계약 패키지는 자기 디렉터리 밖을 import 하지 않는다.",
            },
          ],
        },
      ],
    },
  },
  {
    // apps/api 는 계약 패키지를 type-only(import type / export type)로만 쓴다 — 배포(deploy)는 npm install 없이
    // build→restart 라 워크스페이스 링크가 없을 수 있다. 타입은 tsconfig paths(dist/index.d.ts)로 풀고 런타임 require 는
    // 만들지 않는다. 테스트는 값 비교를 위해 예외.
    files: ["apps/api/src/**/*.ts"],
    ignores: ["apps/api/src/**/__tests__/**", "apps/api/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@openmake/plugin-contracts",
              allowTypeImports: true,
              message:
                "apps/api 는 @openmake/plugin-contracts 를 import type / export type 으로만 쓴다(런타임 require 금지 — 배포에 워크스페이스 링크가 없을 수 있다). 런타임 값은 Base 에 두고 타입을 계약 상수(typeof)에 고정한다.",
            },
          ],
        },
      ],
    },
  },
];
