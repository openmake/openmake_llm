/**
 * kakao-map add-on (웹) — ```kakaomap 블록(장소 좌표·경로 JSON)을 지도 컴포넌트로 렌더한다.
 */
import type { WebAddon } from "../types";
import { KakaoMap } from "./kakao-map";

interface MapPayload {
  places: { name: string; lat: number; lng: number; address?: string; url?: string }[];
  route?: { lat: number; lng: number }[];
}

function parse(raw: string): MapPayload | null {
  try {
    const obj = JSON.parse(raw.trim());
    if (!Array.isArray(obj?.places)) return null;
    return { places: obj.places, route: Array.isArray(obj?.route) ? obj.route : undefined };
  } catch {
    return null;
  }
}

export const kakaoMapAddon: WebAddon = {
  id: "kakao-map",
  messageBlocks: [
    {
      pattern: /```kakaomap\s*\n([\s\S]*?)```/g,
      render(match) {
        const payload = parse(match[1]);
        return payload ? <KakaoMap places={payload.places} route={payload.route} /> : null;
      },
      // 도구가 실어보내는 안내 마커 라인 — 모델이 그대로 옮겨도 표시되지 않게 제거
      stripFromText: /^\s*\[지도 표시용[^\]]*\]\s*$/gm,
    },
  ],
};
