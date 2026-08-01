import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "apps/web/**",
      "apps/desktop/**",
      "**/node_modules/**",
      "**/.claude/**",
      "**/*.min.js",
      "jest.config.js",
      "ecosystem.config.js",
      "scripts/build-info.js",
      // CommonJS 로 dist 를 직접 로드하는 운영 스크립트(빌드 산출물 require 필요) —
      // build-info.js 와 동일 취급. 앱 소스가 아니라 lint 대상에서 제외한다.
      "scripts/eval/*.js",
      "playwright.config.ts",
      "tests/e2e/**",
      "**/*.d.ts",
      "mcp-venv/**",
      "coverage/**",
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
];
