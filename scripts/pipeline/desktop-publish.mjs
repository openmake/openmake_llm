#!/usr/bin/env node
// 데스크톱 앱(dmg) 게시 — 앱 버전마다 한 번 만든 GitHub 릴리스 자산을 서버가 계보·sha256 확인 뒤 게시한다.
//   manifest (CI):   --dmg PATH --sha FULL_SHA --output PATH
//   publish (서버):  --cwd LLM_DIR --sha INSTALLED_SHA --dir UPDATE_DIR --repo OWNER/REPO --output RECEIPT_PATH
// 인자 모양은 고정이다 — 파이프라인(pipeline.sh)은 갱신 전 판이 메모리에 남아 한 주기 동안 새 스크립트를 옛 인자로 부른다.
// 종료 코드: 0 완료·해당 없음 / 75 릴리스 자산 대기 / 1 실패·사용법.

/** 점으로 나눈 수 비교(모자란 자리는 0) — 앱 Updater.swift 의 isNewer 와 같은 규칙. */
export function compareVersions(a, b) {
    const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const x = pa[i] || 0, y = pb[i] || 0;
        if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
}

/** 저장소(체크아웃) 버전과 게시된 버전 → 'unchanged' | 'ahead' | 'publish'. */
export function decide({ repoVersion, publishedVersion }) {
    if (!publishedVersion) return 'publish';
    const order = compareVersions(repoVersion, publishedVersion);
    return order === 0 ? 'unchanged' : order < 0 ? 'ahead' : 'publish';
}
