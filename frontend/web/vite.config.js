// @ts-check
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * OpenMake Web — Vite content-hash 번들 파이프라인.
 *
 * 목적: 운영 배포물을 `dist/assets/*.<hash>.js|css` 형태로 만들어 파일명이 내용에
 * 따라 바뀌게 함(캐시 버스터 근본 해결). 이 설정은 **빌드 산출물 생성 전용**이며,
 * backend(setup.ts) 의 프로덕션 서빙 전환·캐시 정책 변경은 별도 단계에서 다룬다.
 *
 * 핵심 전제:
 *  - 진입점은 `public/index.html`. Vite 가 `<script type="module">` / `<link rel=stylesheet>`
 *    를 파싱해 자동으로 entry 그래프를 구성한다.
 *  - 페이지 모듈(23개)은 spa-router.js 의 `import.meta.glob('./modules/pages/*.js')` 로
 *    그래프에 포함되어 hash code-split 된다 (완전 변수 import 누락 방지).
 *  - 서드파티 정적 자산(`public/vendor/`, `images/`, `icons/`, `css/` 등)은 그대로 복사.
 *    vendor 는 `<script defer>` / CSS @font-face 등으로 직접 로드되므로 번들하지 않는다.
 */
export default defineConfig({
    // public/ 을 빌드 root 로 사용 → index.html 이 entry
    root: resolve(__dirname, 'public'),

    // 절대경로 자산 참조 유지 (예: /js/..., /vendor/...) — backend 서빙 경로와 동일
    base: '/',

    /**
     * publicDir 비활성화.
     *
     * root 가 public/ 이므로 root 자체를 publicDir 로 지정하면 순환이 된다.
     * index.html 이 참조하지 않는 정적 자산(vendor, images, 런타임 동적 CSS 등)은
     * 아래 `copyStaticDirs` 플러그인이 closeBundle 시점에 명시적으로 dist 로 복사한다.
     * index.html 이 참조하는 JS/CSS/폰트는 entry 그래프를 통해 hash 번들된다.
     */
    publicDir: false,

    build: {
        // public/ 기준 한 단계 위의 dist/
        outDir: resolve(__dirname, 'dist'),
        assetsDir: 'assets',
        emptyOutDir: true,
        // 소스맵은 운영 디버깅용으로 분리 생성(원하면 false 로)
        sourcemap: false,
        // CSS 도 hash code-split — 각 entry/청크별 별도 hash CSS 파일
        cssCodeSplit: true,
        // CSS minify 활성화 (unified-sidebar.css 의 괄호 중복 타이포 수정 후 재활성화).
        // lightningcss 가 CSS 문법 오류를 빌드 블로커로 잡아주므로 회귀 방지에도 유효.
        cssMinify: true,
        // 작은 자산도 인라인(base64)하지 않음 — CSP(nonce) 위반·파일명 hash 유지 목적
        assetsInlineLimit: 0,
        rollupOptions: {
            input: resolve(__dirname, 'public/index.html'),
            // 동적 import 청크를 단일 파일로 합치지 않음 → 페이지 모듈 code-split 유지.
            // (Vite8/rolldown 은 codeSplitting 이 기본 true. 명시적으로 보존 의도 표기.)
            output: {
                entryFileNames: 'assets/[name].[hash].js',
                chunkFileNames: 'assets/[name].[hash].js',
                assetFileNames: 'assets/[name].[hash][extname]',
            },
        },
    },

    plugins: [
        copyStaticDirs(),
    ],
});

/**
 * copyStaticDirs — 번들 그래프에 포함되지 않는 정적 디렉토리/파일을 dist 로 복사.
 *
 * Vite 의 publicDir 은 root 와 분리된 별도 디렉토리만 복사할 수 있어, root(public/)
 * 자체의 비-entry 자산(vendor/, images/, icons/, generated/, *.html, sw 등)을
 * 복사하지 못한다. 이 플러그인이 `closeBundle` 시점에 명시적으로 복사한다.
 *
 * 주의: `css/` 와 `js/` 는 index.html 이 참조하는 부분만 Vite 가 hash 처리하므로
 * 통째로 복사하지 않는다. 단, css/pages/* 처럼 런타임에 동적 주입되는 CSS(loadModuleCSS)
 * 는 절대경로(/css/...)로 fetch 되므로 css/ 전체를 복사 대상에 포함한다.
 */
function copyStaticDirs() {
    return {
        name: 'openmake-copy-static-dirs',
        apply: 'build',
        async closeBundle() {
            const fs = await import('node:fs/promises');
            const publicDir = resolve(__dirname, 'public');
            const distDir = resolve(__dirname, 'dist');

            // 디렉토리 단위 복사 대상 (vendor·정적 이미지·런타임 동적 CSS 등)
            const dirs = [
                'vendor',
                'images',
                'icons',
                'generated',
                'policies',
                'css', // 런타임 동적 주입(loadModuleCSS)이 /css/* 절대경로로 fetch
            ];
            // 파일 단위 복사 대상 (entry 가 아닌 보조 HTML·서비스워커·정적 자산)
            const files = [
                'login.html',
                'logo.png',
                'push-sw.js',
                'service-worker.js',
                'style.css', // 일부 절대경로 참조 호환용 (index.html 은 hash 본을 쓰지만 잔존 참조 안전망)
            ];

            for (const d of dirs) {
                const src = resolve(publicDir, d);
                try {
                    await fs.cp(src, resolve(distDir, d), { recursive: true });
                } catch (e) {
                    // 디렉토리가 없으면 스킵
                    if (e && e.code !== 'ENOENT') throw e;
                }
            }
            for (const f of files) {
                const src = resolve(publicDir, f);
                try {
                    await fs.cp(src, resolve(distDir, f));
                } catch (e) {
                    if (e && e.code !== 'ENOENT') throw e;
                }
            }
        },
    };
}
