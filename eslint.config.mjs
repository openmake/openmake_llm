import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.claude/**",
      "**/*.min.js",
      "frontend/web/public/vendor/**",
      "frontend/web/public/js/vendor/**",
      "jest.config.js",
      "ecosystem.config.js",
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
  {
    files: ["frontend/web/public/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
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
      "backend/api/src/**/*locales*.ts",
      "backend/api/src/chat/language-policy.ts",
      "backend/api/src/chat/prompt-templates.ts",
      "backend/api/src/swagger/paths-*.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
];
