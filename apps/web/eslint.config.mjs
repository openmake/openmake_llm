import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler 기반 규칙 — await 이후 setState까지 이행 추적해, 데이터 페칭
      // 라이브러리 없이 쓰는 표준 "mount 시 load() → setState" 관용구(현재 13개 페이지,
      // 23개소)를 전부 에러 처리한다. 규칙을 만족하려면 async/await 로더를 .then 체인으로
      // 전환하는 대규모 행동보존 리팩터가 필요해 실익 대비 회귀 위험이 커 비활성.
      // (데이터 페칭 레이어(react-query 등) 또는 React Compiler 도입 시 재검토)
      "react-hooks/set-state-in-effect": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
