import { z } from "zod";
import axios, { type AxiosError } from "axios";
import { logger } from "./config.js";
import { server } from "./server.js";
import { kakaoApiClient, kakaoMobilityApiClient } from "./api-clients.js";
import { formatBasicRouteResult, formatMobilityRouteResult } from "./route-format.js";
import type { KakaoKeywordSearchResponse, WaypointResult } from "./types.js";

// Tool: find-route
export const findRouteSchema = z.object({
  origin: z.string().describe('출발지 이름 (예: "강남역")'),
  destination: z.string().describe('목적지 이름 (예: "코엑스")'),
  waypoints: z.array(z.string()).optional().describe('경유지 이름 목록 (선택사항)'),
  // 아래 3개는 LLM 이 한글값("자동차"/"추천")·문자열("true")을 넘겨 enum/boolean 검증에
  // 실패(-32602)하던 것을 preprocess 로 canonical 값으로 정규화해 항상 유효하게 만든다.
  transportation_type: z.preprocess((v) => {
    const s = String(v ?? "").toLowerCase().trim();
    if (/(public|대중|transit|버스|지하철)/.test(s)) return "public";
    if (/(walk|도보|보행|걷)/.test(s)) return "walk";
    return "car";
  }, z.enum(["car", "public", "walk"])).describe("이동 수단 (car|public|walk, 기본 car). 자동차/대중교통/도보 한글도 허용"),
  priority: z.preprocess((v) => {
    const s = String(v ?? "").toUpperCase().trim();
    if (s.includes("TIME") || s.includes("시간")) return "TIME";
    if (s.includes("DISTANCE") || s.includes("거리")) return "DISTANCE";
    return "RECOMMEND";
  }, z.enum(["RECOMMEND", "TIME", "DISTANCE"])).describe("경로 우선순위 (RECOMMEND|TIME|DISTANCE, 기본 RECOMMEND)"),
  traffic_info: z.preprocess((v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "string") return !/^(false|no|0|아니|off)/i.test(v.trim());
    return true;
  }, z.boolean()).describe("교통 정보 포함 여부 (기본 true)")
});

server.tool(
  "find-route",
  "출발지에서 목적지까지의 길찾기 정보를 제공합니다.",
  findRouteSchema.shape,
  async (params: z.infer<typeof findRouteSchema>) => {
    logger.log("Executing find-route tool with params:", params);
    try {
      // 1. 출발지 검색
      const originResponse = await kakaoApiClient.get<KakaoKeywordSearchResponse>(
        "https://dapi.kakao.com/v2/local/search/keyword.json",
        { params: { query: params.origin } }
      );
      // <<< 출발지 응답 로깅 추가 >>>
      logger.log("Origin Search Response:", JSON.stringify(originResponse.data, null, 2));
      
      if (!originResponse.data.documents || originResponse.data.documents.length === 0) {
        return {
          content: [{ type: "text", text: `출발지 "${params.origin}"를 찾을 수 없습니다.` }]
        };
      }
      
      // 2. 목적지 검색
      const destinationResponse = await kakaoApiClient.get<KakaoKeywordSearchResponse>(
        "https://dapi.kakao.com/v2/local/search/keyword.json",
        { params: { query: params.destination } }
      );
      // <<< 목적지 응답 로깅 추가 >>>
      logger.log("Destination Search Response:", JSON.stringify(destinationResponse.data, null, 2));
      
      if (!destinationResponse.data.documents || destinationResponse.data.documents.length === 0) {
        return {
          content: [{ type: "text", text: `목적지 "${params.destination}"를 찾을 수 없습니다.` }]
        };
      }

      // 3. 경유지 검색 (있는 경우)
      const waypointsPromises = params.waypoints?.map(waypoint => 
        kakaoApiClient.get<KakaoKeywordSearchResponse>(
          "https://dapi.kakao.com/v2/local/search/keyword.json",
          { params: { query: waypoint } }
        )
      ) || [];
      
      const waypointsResponses = await Promise.all(waypointsPromises);
      const waypointsResults: WaypointResult[] = waypointsResponses.map((response, index) => {
        if (!response.data.documents || response.data.documents.length === 0) {
          return { success: false, name: params.waypoints?.[index] || "알 수 없음" };
        }
        const place = response.data.documents[0];
        return { 
          success: true, 
          name: params.waypoints?.[index] || "알 수 없음",
          placeName: place.place_name,
          addressName: place.address_name,
          x: place.x,
          y: place.y
        };
      });
      
      // 실패한 경유지가 있는지 확인
      const failedWaypoints = waypointsResults.filter(wp => !wp.success);
      if (failedWaypoints.length > 0) {
        return {
          content: [{ 
            type: "text", 
            text: `다음 경유지를 찾을 수 없습니다: ${failedWaypoints.map(wp => wp.name).join(', ')}` 
          }]
        };
      }
      
      // 4. 결과 조합
      const origin = originResponse.data.documents[0];
      const destination = destinationResponse.data.documents[0];
      
      // 기본 웹 링크 생성 (카카오맵)
      let formattedResult = "";
      let mapUrl = `https://map.kakao.com/?sName=${encodeURIComponent(origin.place_name)}&eName=${encodeURIComponent(destination.place_name)}`;
      
      // 경유지가 있는 경우
      if (waypointsResults.length > 0) {
        const successWaypoints = waypointsResults.filter(wp => wp.success && wp.placeName);
        if (successWaypoints.length > 0) {
          const waypointsParam = successWaypoints
            .map(wp => wp.placeName ? encodeURIComponent(wp.placeName) : '')
            .filter(Boolean)
            .join(',');
          
          if (waypointsParam) {
            mapUrl += `&waypoints=${waypointsParam}`;
          }
        }
      }

      // 지도 렌더용 경로 폴리라인(자동차 모빌리티 경로에서 추출). 없으면 마커만 표시.
      let routePath: { lat: number; lng: number }[] = [];

      // 이동 수단에 따라 처리 분기
      if (params.transportation_type === "car") {
        // 자동차 경로는 카카오모빌리티 API 사용

        // 경유지 구성
        let waypointsParam = "";
        if (waypointsResults.length > 0) {
          const successWaypoints = waypointsResults.filter(wp => wp.success && wp.x && wp.y);
          if (successWaypoints.length > 0) {
            waypointsParam = successWaypoints
              .map(wp => `${wp.x},${wp.y}`)
              .join('|');
          }
        }

        // 카카오모빌리티 API 호출
        try {
          // <<< 좌표 검색 결과 및 transportation_type 로깅 추가 >>>
          const originSuccess = originResponse.data.documents && originResponse.data.documents.length > 0;
          const destinationSuccess = destinationResponse.data.documents && destinationResponse.data.documents.length > 0;
          logger.log(`Checking conditions for Mobility API call:`);
          logger.log(`  transportation_type: ${params.transportation_type}`);
          logger.log(`  origin success: ${originSuccess}`);
          logger.log(`  destination success: ${destinationSuccess}`);
          // (필요 시 waypoints 결과 로깅 추가)
          // logger.log(\`  waypoints results: \${JSON.stringify(waypointsResults)}\`);

          if (params.transportation_type === "car" && originSuccess && destinationSuccess) {
            // 자동차 경로이고, 출발지/목적지 좌표 검색 성공 시에만 모빌리티 API 호출

            // URL 파라미터 구성 
            const apiParams: Record<string, string> = {
              origin: `${origin.x},${origin.y}`,
              destination: `${destination.x},${destination.y}`,
              priority: params.priority.toLowerCase(),
              car_fuel: "GASOLINE",
              alternatives: "false",
              road_details: params.traffic_info ? "true" : "false",
              // summary=false — sections[].roads[].vertexes(경로 폴리라인 좌표)를 받아 지도에
              // 실제 경로 선을 그린다. (route.summary 는 그대로 반환되어 거리/시간 표시엔 무영향)
              summary: "false"
            };
            
            // 경유지가 있는 경우 추가
            if (waypointsParam) {
              apiParams.waypoints = waypointsParam;
            }
            
            // 카카오모빌리티 API 호출 (GET 방식으로 변경)
            const mobilityResponse = await kakaoMobilityApiClient.get('/v1/directions', { 
              params: apiParams 
            });
            
            // <<< API 응답 로깅 추가 >>>
            logger.log("Kakao Mobility API Response:", JSON.stringify(mobilityResponse.data, null, 2));
            
            if (mobilityResponse.data && mobilityResponse.data.routes && mobilityResponse.data.routes.length > 0) {
              const route = mobilityResponse.data.routes[0];
              
              if (route.result_code === 0) { // 성공
                formattedResult = formatMobilityRouteResult(route, origin, destination, waypointsResults, params);
                routePath = extractRoutePath(route);
              } else {
                // 길찾기 실패 시 기본 맵 URL로 대체
                formattedResult = formatBasicRouteResult(origin, destination, waypointsResults, params, mapUrl);
              }
            } else {
              // 응답 데이터 없음 - 기본 맵 URL로 대체
              formattedResult = formatBasicRouteResult(origin, destination, waypointsResults, params, mapUrl);
            }
          } else {
            // 응답 데이터 없음 - 기본 맵 URL로 대체
            formattedResult = formatBasicRouteResult(origin, destination, waypointsResults, params, mapUrl);
          }
        } catch (error) {
          // 더 자세한 오류 로깅
          logger.error("Mobility API error:", error);
          if (axios.isAxiosError(error)) {
            logger.error("API Error details:", error.response?.data);
            logger.error("API Error status:", error.response?.status);
          }
          // API 호출 실패 시 기본 맵 URL로 대체
          formattedResult = formatBasicRouteResult(origin, destination, waypointsResults, params, mapUrl);
        }
      } else {
        // 대중교통이나 도보는 기존 방식 사용
        const transportMode = params.transportation_type === "public" ? "transit" : "walk";
        mapUrl += `&carMode=${transportMode}`;
        formattedResult = formatBasicRouteResult(origin, destination, waypointsResults, params, mapUrl);
      }
      
      // 지도 렌더용 kakaomap 블록 — 출발/경유/도착 마커(+ 자동차 경로 폴리라인).
      // search-places 와 동일하게 "그대로 포함" 지시를 실어 프론트가 지도로 렌더한다.
      const routeMarkers: Array<{ name: string; lat: number; lng: number; address?: string }> = [];
      if (origin.x && origin.y) {
        routeMarkers.push({ name: `출발: ${origin.place_name}`, lat: Number(origin.y), lng: Number(origin.x), address: origin.address_name });
      }
      for (const wp of waypointsResults) {
        if (wp.success && wp.x && wp.y) {
          routeMarkers.push({ name: `경유: ${wp.placeName ?? wp.name}`, lat: Number(wp.y), lng: Number(wp.x), address: wp.addressName });
        }
      }
      if (destination.x && destination.y) {
        routeMarkers.push({ name: `도착: ${destination.place_name}`, lat: Number(destination.y), lng: Number(destination.x), address: destination.address_name });
      }
      let routeMapBlock = "";
      if (routeMarkers.length > 0) {
        const json = JSON.stringify({ places: routeMarkers, ...(routePath.length > 1 ? { route: routePath } : {}) });
        routeMapBlock = `\n\n[지도 표시용 — 아래 kakaomap 블록을 답변에 변형 없이 그대로 포함하세요]\n\`\`\`kakaomap\n${json}\n\`\`\``;
      }

      return {
        content: [{ type: "text", text: formattedResult + routeMapBlock }]
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      return {
        content: [{ type: "text", text: `길찾기 중 오류 발생: ${errorMessage}` }]
      };
    }
  }
);

/** 카카오모빌리티 경로 응답에서 폴리라인 좌표(vertexes: [lng,lat,...])를 {lat,lng}[] 로 추출.
 *  블록 비대화 방지를 위해 최대 MAX_ROUTE_POINTS 로 균등 샘플링한다. */
function extractRoutePath(route: unknown): { lat: number; lng: number }[] {
  const MAX_ROUTE_POINTS = 400;
  const path: { lat: number; lng: number }[] = [];
  const r = route as { sections?: Array<{ roads?: Array<{ vertexes?: number[] }> }> };
  for (const section of r.sections ?? []) {
    for (const road of section.roads ?? []) {
      const v = road.vertexes ?? [];
      for (let i = 0; i + 1 < v.length; i += 2) {
        path.push({ lng: v[i], lat: v[i + 1] });
      }
    }
  }
  if (path.length <= MAX_ROUTE_POINTS) return path;
  // 균등 샘플링(시작/끝 보존).
  const step = path.length / MAX_ROUTE_POINTS;
  const sampled: { lat: number; lng: number }[] = [];
  for (let i = 0; i < MAX_ROUTE_POINTS; i++) sampled.push(path[Math.floor(i * step)]);
  sampled.push(path[path.length - 1]);
  return sampled;
}
