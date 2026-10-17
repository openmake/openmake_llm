import { z } from "zod";
import type { findRouteSchema } from "./route-tool.js";
import type { KakaoPlaceDocument, WaypointResult } from "./types.js";

// 카카오모빌리티 API 응답을 포맷팅하는 함수
export function formatMobilityRouteResult(
  route: Record<string, any>,
  origin: KakaoPlaceDocument,
  destination: KakaoPlaceDocument,
  waypoints: WaypointResult[],
  params: z.infer<typeof findRouteSchema>
): string {
  let result = '🗺️ 길찾기 결과\\n\\n';
  result += `출발지: ${origin.place_name} (${origin.address_name})\\n`;

  // 경유지가 있는 경우
  if (waypoints.length > 0) {
    const successWaypoints = waypoints.filter(wp => wp.success);
    if (successWaypoints.length > 0) {
      result += '\\n경유지:\\n';
      for (const [index, wp] of successWaypoints.entries()) { // forEach 대신 for...of 사용
        result += `${index + 1}. ${wp.placeName} (${wp.addressName})\\n`;
      }
    }
  }

  result += `\\n목적지: ${destination.place_name} (${destination.address_name})\\n`;
  result += `\\n이동 수단: ${getTransportationName(params.transportation_type)}\\n`;

  // 카카오모빌리티 API 결과 표시
  const summary = route.summary;
  if (summary && typeof summary === 'object') { // summary 타입 확인 추가
    if (typeof summary.distance === 'number') { // distance 타입 확인 추가
      result += `\\n총 거리: ${formatDistance(summary.distance)}\\n`;
    }
    if (typeof summary.duration === 'number') { // duration 타입 확인 추가
      result += `예상 소요 시간: ${formatDuration(summary.duration)}\\n`;
    }

    // 택시 요금 표시
    if (summary.fare && typeof summary.fare === 'object' && typeof summary.fare.taxi === 'number') { // 타입 확인 추가
      result += `예상 택시 요금: ${summary.fare.taxi.toLocaleString()}원\\n`;
    }

    // 통행 요금 표시
    if (summary.fare && typeof summary.fare === 'object' && typeof summary.fare.toll === 'number' && summary.fare.toll > 0) { // 타입 확인 추가
      result += `통행 요금: ${summary.fare.toll.toLocaleString()}원\\n`;
    }
  }

  // 교통 정보 표시
  if (params.traffic_info && Array.isArray(route.sections)) { // sections 타입 확인 추가
    result += '\\n📊 교통 상황 요약:\\n';

    let totalDistance = 0;
    let totalCongestionDistance = 0;
    let totalHeavyDistance = 0;
    let totalSlowDistance = 0;

    // 타입 단언 대신 타입 가드 사용 (더 안전한 방식은 API 응답 타입 정의)
    for (const section of route.sections) {
      if (section && typeof section === 'object' && Array.isArray(section.roads)) {
        for (const road of section.roads) {
          if (road && typeof road === 'object' && typeof road.distance === 'number' && typeof road.traffic_state === 'number') {
            totalDistance += road.distance;
            if (road.traffic_state === 4) {
              totalCongestionDistance += road.distance;
            } else if (road.traffic_state === 3) {
              totalHeavyDistance += road.distance;
            } else if (road.traffic_state === 2) {
              totalSlowDistance += road.distance;
            }
          }
        }
      }
    }

    // 전체 거리 중 교통 상태별 비율 계산
    if (totalDistance > 0) {
      const congestionPercent = Math.round((totalCongestionDistance / totalDistance) * 100);
      const heavyPercent = Math.round((totalHeavyDistance / totalDistance) * 100);
      const slowPercent = Math.round((totalSlowDistance / totalDistance) * 100);
      const smoothPercent = 100 - congestionPercent - heavyPercent - slowPercent;
      
      result += `🟢 원활: ${smoothPercent}%\\n`;
      result += `🟡 서행: ${slowPercent}%\\n`;
      result += `🟠 지체: ${heavyPercent}%\\n`;
      result += `🔴 정체: ${congestionPercent}%\\n`;
    }
    
    // 주요 정체 구간 표시 (최대 3개)
    if (Array.isArray(route.sections) && params.traffic_info) { // sections 타입 확인 추가
      const congestionRoads: { name: string; distance: number; traffic_state: number }[] = [];

      for (const section of route.sections) {
        if (section && typeof section === 'object' && Array.isArray(section.roads)) {
          for (const road of section.roads) {
            if (road && typeof road === 'object' && typeof road.traffic_state === 'number' && road.traffic_state >= 3 && typeof road.distance === 'number' && road.distance > 300 && typeof road.name === 'string') {
              congestionRoads.push({
                name: road.name,
                distance: road.distance,
                traffic_state: road.traffic_state
              });
            }
          }
        }
      }
      
      congestionRoads.sort((a, b) => b.distance - a.distance);
      
      if (congestionRoads.length > 0) {
        result += '\\n주요 정체 구간:\\n';
        for(const road of congestionRoads.slice(0, 3)) {
          const trafficEmoji = road.traffic_state === 4 ? '🔴' : '🟠';
          result += `${trafficEmoji} ${road.name} (${formatDistance(road.distance)})\\n`;
        }
      }
    }
  }

  // 카카오맵 링크
  const mapUrl = `https://map.kakao.com/?sName=${encodeURIComponent(origin.place_name)}&eName=${encodeURIComponent(destination.place_name)}`;
  result += `\\n카카오맵에서 보기: ${mapUrl}\\n`;

  return result;
}

// 기본 경로 결과 포맷팅 함수
export function formatBasicRouteResult(
  origin: KakaoPlaceDocument,
  destination: KakaoPlaceDocument,
  waypoints: WaypointResult[],
  params: z.infer<typeof findRouteSchema>,
  mapUrl: string
): string {
  let result = '🗺️ 길찾기 결과\\n\\n';
  result += `출발지: ${origin.place_name} (${origin.address_name})\\n`;

  if (waypoints.length > 0) {
    const successWaypoints = waypoints.filter(wp => wp.success && wp.placeName && wp.addressName);
    if (successWaypoints.length > 0) {
      result += '\\n경유지:\\n';
      successWaypoints.forEach((wp, index) => {
        result += `${index + 1}. ${wp.placeName} (${wp.addressName})\\n`;
      });
    }
  }

  result += `\\n목적지: ${destination.place_name} (${destination.address_name})\\n`;
  result += `\\n이동 수단: ${getTransportationName(params.transportation_type)}\\n`;
  result += `\\n카카오맵 길찾기: ${mapUrl}\\n`;
  result += '\\n상세 경로 및 소요 시간은 카카오맵 링크를 통해 확인하세요.';

  return result;
}

// 거리를 포맷팅하는 함수
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

// 시간을 포맷팅하는 함수
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  
  if (hours > 0) {
    return `${hours}시간 ${minutes}분`;
  }
  return `${minutes}분`;
}

// 이동 수단 한글 이름 반환 함수
function getTransportationName(type: string): string {
  switch (type) {
    case "car":
      return "자동차";
    case "public":
      return "대중교통";
    case "walk":
      return "도보";
    default:
      return "자동차";
  }
}
