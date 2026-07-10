"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 카카오 지도 인라인 렌더 컴포넌트.
 *
 * 채팅 메시지의 ```kakaomap 펜스 블록(장소 좌표 JSON)을 실제 카카오 지도로 렌더한다.
 * 아티팩트(격리 iframe, null-origin)와 달리 앱 본체 origin 에서 SDK 를 로드하므로
 * 카카오 콘솔에 등록된 JS SDK 도메인 검증을 통과한다.
 *
 * JS 키는 클라이언트 노출용(도메인 제한으로 보호)이라 NEXT_PUBLIC_ 로 주입한다.
 */

interface KakaoPlace {
  name: string;
  lat: number;
  lng: number;
  address?: string;
  url?: string;
}

// 외부 SDK — 전역 kakao 네임스페이스는 타입 미제공이라 최소 표면만 느슨히 참조한다.
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    kakao?: any;
  }
}

const JS_KEY = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;

let sdkPromise: Promise<void> | null = null;

/** 카카오 Maps SDK 를 1회만 로드(autoload=false → kakao.maps.load 로 명시 초기화). */
function loadKakaoSdk(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.kakao?.maps) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  if (!JS_KEY) return Promise.reject(new Error("NEXT_PUBLIC_KAKAO_JS_KEY 미설정"));

  sdkPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${JS_KEY}&autoload=false`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error("kakao SDK 로드 실패"));
        return;
      }
      window.kakao.maps.load(() => resolve());
    };
    script.onerror = () => reject(new Error("kakao SDK 스크립트 로드 오류(도메인 등록 확인)"));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

export function KakaoMap({ places }: { places: KakaoPlace[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const valid = (places ?? []).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng),
    );
    if (valid.length === 0) {
      setError("표시할 좌표가 없습니다.");
      return;
    }
    loadKakaoSdk()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const kakao = window.kakao;
        const center = new kakao.maps.LatLng(valid[0].lat, valid[0].lng);
        const map = new kakao.maps.Map(containerRef.current, { center, level: 5 });
        const bounds = new kakao.maps.LatLngBounds();
        valid.forEach((p) => {
          const pos = new kakao.maps.LatLng(p.lat, p.lng);
          const marker = new kakao.maps.Marker({ position: pos, map });
          bounds.extend(pos);
          const iw = new kakao.maps.InfoWindow({
            content: `<div style="padding:6px 8px;font-size:12px;max-width:200px">${escapeHtml(
              p.name,
            )}${p.address ? `<br/><span style="color:#666">${escapeHtml(p.address)}</span>` : ""}</div>`,
          });
          kakao.maps.event.addListener(marker, "click", () => iw.open(map, marker));
        });
        if (valid.length > 1) map.setBounds(bounds);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "지도 로드 실패");
      });
    return () => {
      cancelled = true;
    };
  }, [places]);

  if (error) {
    return (
      <div className="my-3 rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted">
        지도를 표시할 수 없습니다: {error}
      </div>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-border">
      <div ref={containerRef} className="h-[360px] w-full" />
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
