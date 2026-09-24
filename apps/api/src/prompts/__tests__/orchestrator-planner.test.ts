/**
 * Planner 시스템 프롬프트 — 긴 원문을 instruction 에 통째로 옮기지 말라는 규칙 고정.
 * 2026-09-24: 곡 설계서를 instruction 에 옮겨 적다 출력 상한에서 잘려 재시도까지 실패하고 음악이 만들어지지 않았다.
 */
import { getPlannerSystemPrompt } from '../orchestrator-planner';

it.each([
    ['ko', /300자 이내/, /통째로 옮기지 말고/],
    ['en', /under 300 characters/, /Never copy the user's message/],
])('%s 프롬프트는 instruction 길이 상한과 원문 복사 금지를 담는다', (lang, limit, noCopy) => {
    const prompt = getPlannerSystemPrompt(lang);
    expect(prompt).toMatch(limit);
    expect(prompt).toMatch(noCopy);
});
