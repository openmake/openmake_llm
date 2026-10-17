import { z } from "zod";
import axios, { type AxiosError } from "axios";
import { argv, logger } from "./config.js";
import { server } from "./server.js";
import { kakaoApiClient } from "./api-clients.js";
import { formatAddressResponse, formatPlacesResponse } from "./format.js";
import type { KakaoCoord2AddressResponse, KakaoKeywordSearchResponse } from "./types.js";

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
