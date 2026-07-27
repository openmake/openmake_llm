/**
 * 예약 task 산출물 게시 — 무인 실행 결과를 고정 URL 로 도달시킨다.
 *
 * 예약 task 는 채팅 세션이 없어 아티팩트로 등록되지 않고, 목록은 owner 스코프라
 * 소유자 외에는 보이지 않는다. 산출물도 workspace(/tmp)에만 남아 사실상 도달 불가였다.
 * publish_slug 가 설정된 스케줄은 완료 직후 산출물을 백엔드가 항상 서빙하는 정적 경로로
 * 복사해, 매일 같은 주소(.../<slug>/latest.html)에서 열람할 수 있게 한다.
 *
 * @module services/agent-task/schedule-publish
 */
import { promises as fs } from 'fs';
import path from 'path';
import { AGENT_TASK_LIMITS } from '../../config/runtime-limits';
import { createLogger } from '../../utils/logger';

const logger = createLogger('SchedulePublish');

/** slug 는 URL 경로가 되므로 디렉토리 탈출·구분자를 원천 차단(영숫자/하이픈/밑줄만). */
const SLUG_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** 게시 파일명의 날짜 — 리포트 기준 TZ 기준(서버가 UTC 라도 날짜가 밀리지 않게). */
function publishDate(now: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: AGENT_TASK_LIMITS.SCHEDULE_PUBLISH_TZ,
        year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
}

/**
 * task workspace 의 산출물을 공개 경로에 게시한다.
 *
 * @returns 게시된 공개 URL 경로. 게시 대상이 아니거나 산출물이 없으면 null.
 */
export async function publishScheduleOutput(
    slug: string | null | undefined,
    workspacePath: string | null | undefined,
    now: Date = new Date(),
): Promise<string | null> {
    if (!slug || !workspacePath) return null;
    if (!SLUG_RE.test(slug)) {
        logger.warn(`[Publish] 잘못된 slug 무시: ${slug}`);
        return null;
    }

    const src = path.join(workspacePath, AGENT_TASK_LIMITS.SCHEDULE_PUBLISH_FILE);
    let html: Buffer;
    try {
        html = await fs.readFile(src);
    } catch {
        // 산출물 미생성(목표 미달성·실패) — 게시하지 않고 기존 latest 를 유지한다.
        logger.warn(`[Publish] 산출물 없음, 게시 생략: ${src}`);
        return null;
    }

    const dir = path.join(AGENT_TASK_LIMITS.SCHEDULE_PUBLISH_DIR, slug);
    await fs.mkdir(dir, { recursive: true });
    const dated = `${publishDate(now)}.html`;
    await fs.writeFile(path.join(dir, dated), html);
    await fs.writeFile(path.join(dir, 'latest.html'), html);

    const url = `${AGENT_TASK_LIMITS.SCHEDULE_PUBLISH_URL_PREFIX}/${slug}/latest.html`;
    logger.info(`[Publish] 게시 완료: ${url} (${html.length} bytes, 보관본 ${dated})`);
    return url;
}
