#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import axios, { type AxiosError } from "axios";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import express, { type Request, type Response } from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import cors from "cors";
import { fileURLToPath } from "url";

// Load environment variables from .env file
dotenv.config();

// --- Configuration ---

const argv = yargs(hideBin(process.argv))
  .option('kakao-api-key', {
    alias: 'k',
    type: 'string',
    description: 'Kakao REST API Key',
  })
  .option('mode', {
    type: 'string',
    choices: ['stdio', 'http'],
    default: 'stdio',
    description: 'Transport mode: stdio or http (default: stdio)',
  })
  .option('port', {
    type: 'number',
    default: 3000,
    description: 'Port for HTTP server (HTTP mode only)',
  })
  .help()
  .alias('help', 'h')
  .parseSync();

// Custom logger to prevent interference with stdio transport
const logger = {
  log: (message: string, ...args: unknown[]) => {
    // In stdio mode, write to stderr to avoid interfering with JSON messages
    if (argv.mode === 'stdio') {
      process.stderr.write(`LOG: ${message}\n`);
    } else {
      console.log(message, ...args);
    }
  },
  error: (message: string, ...args: unknown[]) => {
    // Always write errors to stderr
    if (argv.mode === 'stdio') {
      process.stderr.write(`ERROR: ${message}\n`);
    } else {
      console.error(message, ...args);
    }
  }
};

// Get Kakao API Key: prioritize command-line arg, then env var
const KAKAO_API_KEY = argv.kakaoApiKey || process.env.KAKAO_REST_API_KEY;

if (!KAKAO_API_KEY) {
  logger.error(
    "Error: Kakao REST API Key not found. " +
    "Provide it via --kakao-api-key argument or KAKAO_REST_API_KEY environment variable."
  );
  process.exit(1); // Exit if no key is found
}

logger.log("Kakao REST API Key loaded successfully.");

// --- Define Kakao API Response Types ---

interface KakaoPlaceDocument {
  place_name: string;
  address_name: string;
  category_name: string;
  place_url: string;
  phone?: string;
  x?: string;
  y?: string;
}

interface KakaoKeywordSearchMeta {
  total_count: number;
  pageable_count: number;
  is_end: boolean;
}

interface KakaoKeywordSearchResponse {
  documents: KakaoPlaceDocument[];
  meta: KakaoKeywordSearchMeta;
}

interface KakaoAddress {
  address_name: string;
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  mountain_yn: string;
  main_address_no: string;
  sub_address_no?: string;
  zip_code?: string;
}

interface KakaoRoadAddress {
  address_name: string;
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  road_name: string;
  underground_yn: string;
  main_building_no: string;
  sub_building_no?: string;
  building_name?: string;
  zone_no: string;
}

interface KakaoCoord2AddressDocument {
  road_address: KakaoRoadAddress | null;
  address: KakaoAddress | null;
}

interface KakaoCoord2AddressResponse {
  meta: { total_count: number };
  documents: KakaoCoord2AddressDocument[];
}

// Daum 검색 API 응답 타입 정의
interface DaumSearchResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: Record<string, unknown>[];
}

// <<< WaypointResult 인터페이스 정의 이동 >>>
interface WaypointResult {
  success: boolean;
  name: string;
  placeName?: string;
  addressName?: string;
  x?: string;
  y?: string;
}

// --- MCP Server Setup ---

const server = new McpServer(
  {
    name: "kakao-map",
    version: "0.1.0"
  },
  {
    capabilities: {
      logging: {},
      tools: {}
    }
  }
);

// 위 코드 대신 MCP SDK의 문서나 타입을 확인하여 올바른 이벤트 처리 방식 적용
// 임시로 주석 처리

// 카카오맵 API용 axios 인스턴스 생성
const kakaoApiClient = axios.create({
  baseURL: 'https://dapi.kakao.com',
  headers: {
    Authorization: `KakaoAK ${KAKAO_API_KEY}`,
  }
});

// 카카오모빌리티 API용 axios 인스턴스 생성
const kakaoMobilityApiClient = axios.create({
  baseURL: 'https://apis-navi.kakaomobility.com',
  headers: {
    Authorization: `KakaoAK ${KAKAO_API_KEY}`,
  }
});

// axios 인스턴스에 인터셉터 추가
kakaoApiClient.interceptors.request.use(request => {
  logger.log(`Kakao API Request: ${request.method?.toUpperCase()} ${request.url}`);
  return request;
});

kakaoApiClient.interceptors.response.use(response => {
  logger.log(`Kakao API Response: ${response.status} ${response.statusText}`);
  return response;
}, error => {
  logger.error(`Kakao API Error: ${error.message}`);
  return Promise.reject(error);
});

kakaoMobilityApiClient.interceptors.request.use(request => {
  logger.log(`Kakao Mobility API Request: ${request.method?.toUpperCase()} ${request.url}`);
  logger.log(`Request Headers: ${JSON.stringify(request.headers)}`);
  logger.log(`Request Params: ${JSON.stringify(request.params)}`);
  return request;
});

kakaoMobilityApiClient.interceptors.response.use(response => {
  logger.log(`Kakao Mobility API Response: ${response.status} ${response.statusText}`);
  return response;
}, error => {
  logger.error(`Kakao Mobility API Error: ${error.message}`);
  if (axios.isAxiosError(error)) {
    logger.error(`Status: ${error.response?.status}`);
    logger.error(`Data: ${JSON.stringify(error.response?.data)}`);
  }
  return Promise.reject(error);
});

// Tool: search-places
const searchPlacesSchema = z.object({
  keyword: z.string().describe('검색할 키워드 (예: "강남역 맛집")'),
  x: z.number().optional().describe("중심 좌표의 X 또는 longitude 값 (WGS84)"),
  y: z.number().optional().describe("중심 좌표의 Y 또는 latitude 값 (WGS84)"),
  radius: z.number().int().min(0).max(20000).optional().describe("중심 좌표부터의 검색 반경(0~20000m)"),
});
server.tool(
  "search-places",
  "키워드를 사용하여 카카오맵에서 장소를 검색합니다.",
  searchPlacesSchema.shape,
  async (params: z.infer<typeof searchPlacesSchema>) => {
    logger.log("Executing search-places tool with params:", params);
    try {
      const response = await kakaoApiClient.get<KakaoKeywordSearchResponse>(
        "/v2/local/search/keyword.json",
        {
          params: {
            query: params.keyword,
            x: params.x,
            y: params.y,
            radius: params.radius,
          },
        }
      );
      
      logger.log(`API Response received: ${response.status}`);
      logger.log(`Results count: ${response.data.documents?.length || 0}`);
      
      const formattedResponse = formatPlacesResponse(response.data);
      
      logger.log(`Formatted response: ${formattedResponse.substring(0, 100)}...`);
      
      // 결과를 STDOUT에 명시적으로 출력 (디버깅용)
      if (argv.mode === 'stdio') {
        const result = {
          type: "tool_response",
          tool: "search-places",
          content: [{ type: "text", text: formattedResponse }]
        };
        console.log(JSON.stringify(result));
      }
      
      return {
        content: [{ type: "text", text: formattedResponse }],
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        logger.error("API Error details:", JSON.stringify(axiosError.response?.data));
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      // 오류 결과를 STDOUT에 명시적으로 출력 (디버깅용)
      if (argv.mode === 'stdio') {
        const errorResult = {
          type: "tool_response",
          tool: "search-places",
          content: [{ type: "text", text: `장소 검색 중 오류 발생: ${errorMessage}` }]
        };
        console.log(JSON.stringify(errorResult));
      }
      
      return {
        content: [{ type: "text", text: `장소 검색 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// Tool: coord-to-address
const coordToAddressSchema = z.object({
  x: z.number().describe("경도 (longitude) WGS84 좌표"),
  y: z.number().describe("위도 (latitude) WGS84 좌표"),
});
server.tool(
  "coord-to-address",
  "좌표(경도, 위도)를 주소(도로명, 지번)로 변환합니다.",
  coordToAddressSchema.shape,
  async (params: z.infer<typeof coordToAddressSchema>) => {
    logger.log("Executing coord-to-address tool with params:", params);
    try {
      const response = await kakaoApiClient.get<KakaoCoord2AddressResponse>(
        "https://dapi.kakao.com/v2/local/geo/coord2address.json",
        {
          params: {
            x: params.x,
            y: params.y,
          },
        }
      );
      const formattedResponse = formatAddressResponse(response.data);
      return {
        content: [{ type: "text", text: formattedResponse }],
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
        content: [{ type: "text", text: `좌표-주소 변환 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// Tool: find-route
const findRouteSchema = z.object({
  origin: z.string().describe('출발지 이름 (예: "강남역")'),
  destination: z.string().describe('목적지 이름 (예: "코엑스")'),
  waypoints: z.array(z.string()).optional().describe('경유지 이름 목록 (선택사항)'),
  transportation_type: z.enum(["car", "public", "walk"]).default("car").describe("이동 수단 (자동차, 대중교통, 도보)"),
  priority: z.enum(["RECOMMEND", "TIME", "DISTANCE"]).default("RECOMMEND").describe("경로 탐색 우선순위 (추천, 최단시간, 최단거리)"),
  traffic_info: z.boolean().default(true).describe("교통 정보 포함 여부")
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

      // 이동 수단에 따라 처리 분기
      if (params.transportation_type === "car") {
        // 자동차 경로는 카카오모빌리티 API 사용

        // 카카오모빌리티 API용 axios 인스턴스 생성
        const mobilityApiClient = axios.create({
          headers: {
            Authorization: `KakaoAK ${KAKAO_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });

        // 카카오모빌리티 API 파라미터 구성
        const originCoord = `${origin.x},${origin.y}`;
        const destCoord = `${destination.x},${destination.y}`;

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
              summary: "true"
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
      
      return {
        content: [{ type: "text", text: formattedResult }]
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

// Daum 웹 검색 도구
const webSearchSchema = z.object({
  query: z.string().describe('검색할 질의어'),
  sort: z.enum(['accuracy', 'recency']).optional().describe('결과 정렬 방식 (accuracy: 정확도순, recency: 최신순)'),
  page: z.number().int().min(1).max(50).optional().describe('결과 페이지 번호 (1~50, 기본값 1)'),
  size: z.number().int().min(1).max(50).optional().describe('한 페이지에 보여질 문서 수 (1~50, 기본값 10)'),
});

server.tool(
  "search-web",
  "다음(Daum) 검색에서 웹 문서를 검색합니다.",
  webSearchSchema.shape,
  async (params: z.infer<typeof webSearchSchema>) => {
    logger.log("Executing search-web tool with params:", params);
    try {
      const response = await kakaoApiClient.get<DaumSearchResponse>(
        "/v2/search/web",
        {
          params: {
            query: params.query,
            sort: params.sort,
            page: params.page,
            size: params.size,
          },
        }
      );
      
      logger.log(`API Response received: ${response.status}`);
      logger.log(`Results count: ${response.data.meta.total_count}`);
      
      const formattedResponse = formatDaumSearchResponse("웹 문서", response.data);
      
      return {
        content: [{ type: "text", text: formattedResponse }],
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        logger.error("API Error details:", JSON.stringify(axiosError.response?.data));
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        content: [{ type: "text", text: `웹 검색 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// Daum 이미지 검색 도구
const imageSearchSchema = z.object({
  query: z.string().describe('검색할 질의어'),
  sort: z.enum(['accuracy', 'recency']).optional().describe('결과 정렬 방식 (accuracy: 정확도순, recency: 최신순)'),
  page: z.number().int().min(1).max(50).optional().describe('결과 페이지 번호 (1~50, 기본값 1)'),
  size: z.number().int().min(1).max(80).optional().describe('한 페이지에 보여질 문서 수 (1~80, 기본값 10)'),
});

server.tool(
  "search-image",
  "다음(Daum) 검색에서 이미지를 검색합니다.",
  imageSearchSchema.shape,
  async (params: z.infer<typeof imageSearchSchema>) => {
    logger.log("Executing search-image tool with params:", params);
    try {
      const response = await kakaoApiClient.get<DaumSearchResponse>(
        "/v2/search/image",
        {
          params: {
            query: params.query,
            sort: params.sort,
            page: params.page,
            size: params.size,
          },
        }
      );
      
      logger.log(`API Response received: ${response.status}`);
      logger.log(`Results count: ${response.data.meta.total_count}`);
      
      const formattedResponse = formatDaumSearchResponse("이미지", response.data);
      
      return {
        content: [{ type: "text", text: formattedResponse }],
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        logger.error("API Error details:", JSON.stringify(axiosError.response?.data));
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        content: [{ type: "text", text: `이미지 검색 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// Daum 블로그 검색 도구
const blogSearchSchema = z.object({
  query: z.string().describe('검색할 질의어'),
  sort: z.enum(['accuracy', 'recency']).optional().describe('결과 정렬 방식 (accuracy: 정확도순, recency: 최신순)'),
  page: z.number().int().min(1).max(50).optional().describe('결과 페이지 번호 (1~50, 기본값 1)'),
  size: z.number().int().min(1).max(50).optional().describe('한 페이지에 보여질 문서 수 (1~50, 기본값 10)'),
});

server.tool(
  "search-blog",
  "다음(Daum) 검색에서 블로그 글을 검색합니다.",
  blogSearchSchema.shape,
  async (params: z.infer<typeof blogSearchSchema>) => {
    logger.log("Executing search-blog tool with params:", params);
    try {
      const response = await kakaoApiClient.get<DaumSearchResponse>(
        "/v2/search/blog",
        {
          params: {
            query: params.query,
            sort: params.sort,
            page: params.page,
            size: params.size,
          },
        }
      );
      
      logger.log(`API Response received: ${response.status}`);
      logger.log(`Results count: ${response.data.meta.total_count}`);
      
      const formattedResponse = formatDaumSearchResponse("블로그", response.data);
      
      return {
        content: [{ type: "text", text: formattedResponse }],
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        logger.error("API Error details:", JSON.stringify(axiosError.response?.data));
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        content: [{ type: "text", text: `블로그 검색 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// Daum 카페 검색 도구
const cafeSearchSchema = z.object({
  query: z.string().describe('검색할 질의어'),
  sort: z.enum(['accuracy', 'recency']).optional().describe('결과 정렬 방식 (accuracy: 정확도순, recency: 최신순)'),
  page: z.number().int().min(1).max(50).optional().describe('결과 페이지 번호 (1~50, 기본값 1)'),
  size: z.number().int().min(1).max(50).optional().describe('한 페이지에 보여질 문서 수 (1~50, 기본값 10)'),
});

server.tool(
  "search-cafe",
  "다음(Daum) 검색에서 카페 글을 검색합니다.",
  cafeSearchSchema.shape,
  async (params: z.infer<typeof cafeSearchSchema>) => {
    logger.log("Executing search-cafe tool with params:", params);
    try {
      const response = await kakaoApiClient.get<DaumSearchResponse>(
        "/v2/search/cafe",
        {
          params: {
            query: params.query,
            sort: params.sort,
            page: params.page,
            size: params.size,
          },
        }
      );
      
      logger.log(`API Response received: ${response.status}`);
      logger.log(`Results count: ${response.data.meta.total_count}`);
      
      const formattedResponse = formatDaumSearchResponse("카페", response.data);
      
      return {
        content: [{ type: "text", text: formattedResponse }],
      };
    } catch (error: unknown) {
      let errorMessage = "알 수 없는 오류 발생";
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError<{ message?: string }>;
        logger.error("API Error status:", axiosError.response?.status);
        logger.error("API Error details:", JSON.stringify(axiosError.response?.data));
        errorMessage = axiosError.response?.data?.message || axiosError.message;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }
      
      return {
        content: [{ type: "text", text: `카페 검색 중 오류 발생: ${errorMessage}` }],
      };
    }
  }
);

// --- Helper Functions ---

function formatPlacesResponse(data: KakaoKeywordSearchResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return "검색 결과가 없습니다.";
  }
  const places = data.documents.map((place: KakaoPlaceDocument) => {
    let result = `이름: ${place.place_name}\n주소: ${place.address_name}\n카테고리: ${place.category_name}`;
    
    // 전화번호가 있으면 추가
    if (place.phone) {
      result += `\n전화번호: ${place.phone}`;
    }
    
    // 카카오맵 링크 추가
    result += `\n상세정보: ${place.place_url}`;
    
    return result;
  }).join("\n---\n");
  
  const pageInfo = data.meta ? ` (결과 수: ${data.meta.pageable_count}, 총 ${data.meta.total_count}개)` : "";

  // 지도 렌더용 kakaomap 블록 — 좌표(x=lng, y=lat)를 가진 상위 결과를 JSON 으로 동봉한다.
  // 프론트(markdown.tsx)가 이 fenced 블록을 KakaoMap 컴포넌트로 렌더한다. 도구 결과에
  // "그대로 포함" 지시를 실어 모델이 블록을 변형 없이 통과시키게 한다(전역 프롬프트 불필요).
  const mapPoints = data.documents
    .filter(p => p.x && p.y)
    .slice(0, 15)
    .map(p => ({
      name: p.place_name,
      lat: Number(p.y),
      lng: Number(p.x),
      address: p.address_name,
      url: p.place_url,
    }));
  let mapBlock = "";
  if (mapPoints.length > 0) {
    const json = JSON.stringify({ places: mapPoints });
    mapBlock = `\n\n[지도 표시용 — 아래 kakaomap 블록을 답변에 변형 없이 그대로 포함하세요]\n\`\`\`kakaomap\n${json}\n\`\`\``;
  }

  return `장소 검색 결과${pageInfo}:\n${places}${mapBlock}`;
}

function formatAddressResponse(data: KakaoCoord2AddressResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return "해당 좌표에 대한 주소 정보를 찾을 수 없습니다.";
  }
  const doc = data.documents[0];
  const roadAddress = doc.road_address ? `도로명: ${doc.road_address.address_name}` : "도로명 주소 정보 없음";
  const lotAddress = doc.address ? `지번: ${doc.address.address_name}` : "지번 주소 정보 없음";
  return `주소 변환 결과:\n${roadAddress}\n${lotAddress}`;
}

// 카카오모빌리티 API 응답을 포맷팅하는 함수
function formatMobilityRouteResult(
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
function formatBasicRouteResult(
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

// 다음 검색 결과 포맷팅 함수
function formatDaumSearchResponse(searchType: string, data: DaumSearchResponse): string {
  if (!data || !data.documents || data.documents.length === 0) {
    return '검색 결과가 없습니다.';
  }

  let result = `${searchType} 검색 결과 (총 ${data.meta.total_count}개 중 ${data.documents.length}개 표시):\n\n`;

  for (const [index, doc] of data.documents.entries()) {
    result += `${index + 1}. `;

    // 제목 처리
    const title = doc.title;
    const sitename = doc.display_sitename;
    if (typeof title === 'string' && title) {
      result += `${title.replace(/<b>/g, '').replace(/<\/b>/g, '')}\n`;
    } else if (typeof sitename === 'string' && sitename) {
      result += `${sitename}\n`;
    } else {
      result += '[제목 없음]\n';
    }

    // 내용 처리
    const contents = doc.contents;
    if (typeof contents === 'string' && contents) {
      const cleanContent = contents.replace(/<b>/g, '').replace(/<\/b>/g, '');
      result += `   내용: ${cleanContent.substring(0, 100)}${cleanContent.length > 100 ? '...' : ''}\n`;
    }

    // URL 처리
    if (typeof doc.url === 'string' && doc.url) {
      result += `   URL: ${doc.url}\n`;
    }

    // 날짜 처리
    const datetimeValue = doc.datetime;
    if (typeof datetimeValue === 'string' || typeof datetimeValue === 'number') {
      try {
        const datetime = new Date(datetimeValue);
        if (!Number.isNaN(datetime.getTime())) { // isNaN 대신 Number.isNaN 사용 및 유효성 검사 강화
          result += `   날짜: ${datetime.toLocaleDateString('ko-KR')}\n`;
        }
      } catch (e) {
        logger.error(`Invalid date format for datetime: ${datetimeValue}`);
      }
    }

    // 이미지 URL 처리
    const thumbnailUrl = doc.thumbnail_url;
    const imageUrl = doc.image_url;
    if (typeof thumbnailUrl === 'string' || typeof imageUrl === 'string') {
      result += `   이미지: ${thumbnailUrl || imageUrl}\n`;
    }

    // 카페명 처리
    if (typeof doc.cafename === 'string' && doc.cafename) {
      result += `   카페: ${doc.cafename}\n`;
    }

    // 블로그명 처리
    if (typeof doc.blogname === 'string' && doc.blogname) {
      result += `   블로그: ${doc.blogname}\n`;
    }

    // 출처 처리
    if (typeof doc.collection === 'string' && doc.collection) {
      result += `   출처: ${doc.collection}\n`;
    }

    // 크기 처리
    if (typeof doc.width === 'number' && typeof doc.height === 'number') {
      result += `   크기: ${doc.width}x${doc.height}\n`;
    }

    result += '\n'; // 각 문서 사이에 줄바꿈 추가
  }

  // 페이지 정보 추가
  result += `현재 페이지가 마지막 페이지${data.meta.is_end ? '입니다.' : '가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.'}\n`;

  return result; // 함수 끝에 return 명시
}

// --- Run the Server (based on mode) ---

// Export the server instance if needed for testing or other modules
// export { server }; // <-- 파일 최상단으로 이동하거나 제거 (Node.js ESM 권장사항 따름)

// ESM에서는 require.main === module 대신 다른 방식으로 직접 실행 감지
// https://nodejs.org/api/esm.html#esm_no_require_exports_module_exports_filename_dirname
// Node.js v20부터는 import.meta.url을 사용하여 현재 파일이 직접 실행되는지 확인할 수 있음
// const isMainModule = import.meta.url === \`file://\${process.argv[1]}\`; // 수정 전
let isMainModule = false;
try {
  // fileURLToPath를 사용하여 올바르게 경로 비교
  const currentFilePath = fileURLToPath(import.meta.url);
  isMainModule = currentFilePath === process.argv[1];
} catch (e) {
  // import.meta.url이 지원되지 않는 환경 고려 (예: CommonJS)
  // 또는 다른 방식으로 메인 모듈 여부 확인 필요 시 추가
}

// import/export는 최상위 레벨에서만 사용 가능하므로, 서버 시작 로직을 함수로 감싸기
async function startServer() {
  const mode = argv.mode as 'stdio' | 'http';
  const port = argv.port as number;

  if (mode === 'stdio') {
    // STDIO Mode - Direct connection via stdio
    logger.log("Starting Kakao Map MCP Server in stdio mode...");
    
    const stdioTransport = new StdioServerTransport();
    
    // 디버깅을 위한 stdio 입력 로깅
    process.stdin.on('data', (data) => {
      const input = data.toString().trim();
      logger.log(`STDIN received: ${input}`); // logger.log로 복원
      // logger.error(\`STDIN received (error level): \${input}\`); // logger.error 주석 처리

      try {
        // 입력 데이터 파싱
        const parsedData = JSON.parse(input);
        logger.log(`Parsed message type: ${parsedData.type}, tool: ${parsedData.tool}`); // logger.log로 복원
        // logger.error(\`Parsed message (error level) - Type: \${parsedData.type}, Tool: \${parsedData.tool}\`); // logger.error 주석 처리
      } catch (err: unknown) {
        if (err instanceof Error) {
          logger.error(`Failed to parse input: ${err.message}`);
        } else {
          logger.error('Failed to parse input: Unknown error'); // 수정 후
        }
      }
    });
    
    server.connect(stdioTransport).then(() => {
      logger.log("Kakao Map MCP Server connected via stdio.");
    }).catch(error => {
      logger.error(`Failed to connect server via stdio: ${error}`);
      process.exit(1);
    });
  } else {
    // HTTP/SSE Mode - Express server with SSE
    const app = express();
    let sseTransport: SSEServerTransport | null = null;
    
    // CORS Configuration
    const corsOptions = {
      origin: 'http://localhost:5173', // For MCP Inspector
      methods: "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS",
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
      optionsSuccessStatus: 204
    };
    app.use(cors(corsOptions));
    
    // Routes
    app.get("/sse", async (req: Request, res: Response) => {
      logger.log("New SSE connection request received.");
      
      if (sseTransport) {
        logger.log("An existing SSE transport is active. Replacing with the new connection.");
      }
      
      // Create a new transport for this request
      const currentTransport = new SSEServerTransport("/messages", res as unknown as ServerResponse<IncomingMessage>);
      sseTransport = currentTransport;
      
      try {
        await server.connect(sseTransport);
        logger.log("MCP Server connected to SSE transport.");
        
        req.on("close", () => {
          logger.log("SSE connection closed by client.");
          if (sseTransport === currentTransport) {
            sseTransport = null;
          }
        });
      } catch (error) {
        logger.error(`Error connecting MCP server to SSE transport: ${error}`);
        if (sseTransport === currentTransport) {
          sseTransport = null;
        }
        if (!res.writableEnded) {
          res.status(500).end();
        }
      }
    });
    
    app.post("/messages", (req: Request, res: Response): void => {
      logger.log("Received POST /messages request.");
      if (!sseTransport) {
        logger.error("Received POST message but no active SSE transport.");
        res.status(400).send("No active SSE connection");
        return;
      }
      
      sseTransport.handlePostMessage(req as unknown as IncomingMessage, res as unknown as ServerResponse<IncomingMessage>)
        .then(() => {
          logger.log("POST message handled by SSE transport.");
        })
        .catch((error) => {
          logger.error(`Error handling POST message: ${error}`);
          if (!res.headersSent) {
            res.status(500).send("Error processing message");
          }
        });
    });
    
    // Start Server
    app.listen(port, () => {
      logger.log(`Kakao Map MCP Server (HTTP/SSE) listening on port ${port}`);
      logger.log(`SSE endpoint available at http://localhost:${port}/sse`);
      logger.log(`Message endpoint available at http://localhost:${port}/messages`);
    });
  }
} // startServer 함수 닫는 중괄호

// 메인 모듈로 실행될 때만 서버 시작
if (isMainModule) {
  startServer().catch(error => {
    logger.error("Failed to start server:", error);
    process.exit(1);
  });
} // if (isMainModule) 닫는 중괄호

// 서버 인스턴스를 export해야 한다면 파일 최상단에서 export
export { server };
