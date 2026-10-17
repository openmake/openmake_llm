import axios from "axios";
import { KAKAO_API_KEY, logger } from "./config.js";

// 카카오맵 API용 axios 인스턴스 생성
export const kakaoApiClient = axios.create({
  baseURL: 'https://dapi.kakao.com',
  headers: {
    Authorization: `KakaoAK ${KAKAO_API_KEY}`,
  }
});

// 카카오모빌리티 API용 axios 인스턴스 생성
export const kakaoMobilityApiClient = axios.create({
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
