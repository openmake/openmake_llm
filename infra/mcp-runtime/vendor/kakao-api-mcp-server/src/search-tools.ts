import { z } from "zod";
import axios, { type AxiosError } from "axios";
import { logger } from "./config.js";
import { server } from "./server.js";
import { kakaoApiClient } from "./api-clients.js";
import { formatDaumSearchResponse } from "./format.js";
import type { DaumSearchResponse } from "./types.js";

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
