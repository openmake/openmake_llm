/**
 * 파일 편집 충돌 안내 (하네스 P2-6) — 편집 해시 비교 후 교체가 거절했을 때 모델이 받는 도구 결과.
 *
 * @module prompts/edit-conflict
 */

/** 마지막으로 본 뒤 파일이 바뀌어(또는 지워져) 편집을 반영하지 않았다는 안내. */
export function getEditConflictNotice(path: string, deleted: boolean): string {
    const what = deleted ? '지워졌습니다' : '다른 곳에서 바뀌었습니다';
    return `편집하지 않았습니다: ${path} 가 마지막으로 본 뒤 ${what}(사용자나 다른 작업이 고쳤을 수 있습니다). `
        + '덮어쓰면 그 변경이 사라집니다. str_replace_editor view(또는 file_ops read)로 현재 내용을 다시 본 뒤, 그 내용을 기준으로 다시 편집하세요.';
}
