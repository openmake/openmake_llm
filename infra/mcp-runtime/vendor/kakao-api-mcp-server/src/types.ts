// --- Define Kakao API Response Types ---

export interface KakaoPlaceDocument {
  place_name: string;
  address_name: string;
  category_name: string;
  place_url: string;
  phone?: string;
  x?: string;
  y?: string;
}

export interface KakaoKeywordSearchMeta {
  total_count: number;
  pageable_count: number;
  is_end: boolean;
}

export interface KakaoKeywordSearchResponse {
  documents: KakaoPlaceDocument[];
  meta: KakaoKeywordSearchMeta;
}

export interface KakaoAddress {
  address_name: string;
  region_1depth_name: string;
  region_2depth_name: string;
  region_3depth_name: string;
  mountain_yn: string;
  main_address_no: string;
  sub_address_no?: string;
  zip_code?: string;
}

export interface KakaoRoadAddress {
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

export interface KakaoCoord2AddressDocument {
  road_address: KakaoRoadAddress | null;
  address: KakaoAddress | null;
}

export interface KakaoCoord2AddressResponse {
  meta: { total_count: number };
  documents: KakaoCoord2AddressDocument[];
}

// Daum 검색 API 응답 타입 정의
export interface DaumSearchResponse {
  meta: {
    total_count: number;
    pageable_count: number;
    is_end: boolean;
  };
  documents: Record<string, unknown>[];
}

// <<< WaypointResult 인터페이스 정의 이동 >>>
export interface WaypointResult {
  success: boolean;
  name: string;
  placeName?: string;
  addressName?: string;
  x?: string;
  y?: string;
}
