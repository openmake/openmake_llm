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
      // 계층 경계 — 프론트는 백엔드 소스를 직접 참조하지 않는다(현재 위반 0).
      // 공유가 필요한 타입·상수는 @openmake/shared-types · @openmake/config 를 거친다.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              // 주의: 패턴은 import 문자열을 매칭한다(해석된 경로가 아님). 현실적인 침범
              // 경로는 `../../api/src/...` 처럼 'apps/' 가 빠진 상대경로이므로 둘 다 막는다.
              group: ["**/apps/api/**", "**/api/src/**"],
              message:
                "apps/web 은 apps/api 소스를 직접 import 하지 않는다 — 공유 계약은 @openmake/shared-types / @openmake/config 를 경유할 것.",
            },
          ],
        },
      ],
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
