# 카카오 API MCP 서버

카카오맵 API 및 Daum 검색 API를 [Model Context Protocol](https://github.com/anthropics/model-context-protocol)(MCP)을 통해 활용할 수 있는 서버입니다. 이 서버를 통해 AI 모델이 카카오맵의 지도 관련 기능과 Daum의 다양한 검색 기능을 활용할 수 있습니다.

## 주의 사항

*   **카카오 로그인, 카카오톡 메시지 보내기 등 사용자 계정 관련 기능은 포함되어 있지 않습니다.** 이 서버는 공개된 카카오 및 Daum의 Open API만을 사용합니다.
*   본 서버를 사용하기 위해서는 유효한 **카카오 REST API 키**가 필요합니다. [카카오 디벨로퍼스](https://developers.kakao.com/)에서 앱을 생성하고 REST API 키를 발급받으세요.

## 주요 기능

### 카카오맵 API

1. **장소 검색 (`mcp_kakao_map_search_places`)**
   - 키워드로 카카오맵에서 장소를 검색
   - 위치, 카테고리, 연락처 정보 제공

2. **좌표-주소 변환 (`mcp_kakao_map_coord_to_address`)**
   - 경위도 좌표를 실제 주소로 변환
   - 도로명 주소 및 지번 주소 정보 제공

3. **길찾기 (`mcp_kakao_map_find_route`)**
   - 출발지에서 목적지까지의 경로 검색
   - 거리, 소요 시간, 예상 택시 요금 등 제공
   - 교통 상황 정보 포함 (선택적)

### Daum 검색 API

1. **웹 문서 검색 (`mcp_kakao_map_search_web`)**
   - 키워드로 다음 웹 문서 검색
   - 페이지 정렬 및 검색 결과 개수 조정 가능

2. **이미지 검색 (`mcp_kakao_map_search_image`)**
   - 키워드로 다음 이미지 검색
   - 이미지 URL 및 관련 정보 제공

3. **블로그 검색 (`mcp_kakao_map_search_blog`)**
   - 키워드로 다음 블로그 글 검색
   - 블로그 이름, 포스트 제목, 내용 요약 제공

4. **카페 검색 (`mcp_kakao_map_search_cafe`)**
   - 키워드로 다음 카페 글 검색
   - 카페 이름, 게시물 제목, 내용 요약 제공

## 도구 사용 예시 (MCP)

아래는 MCP 클라이언트(예: AI 모델)가 이 서버의 도구를 호출하는 방법과 예상되는 응답 형식입니다.

### 카카오맵 API

#### 1. 장소 검색 (`mcp_kakao_map_search_places`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_search_places",
  "parameters": {
    "keyword": "판교역 현대백화점"
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_search_places",
  "result": "장소 검색 결과 (결과 수: 15, 총 18개):\n이름: 현대백화점 판교점\n주소: 경기 성남시 분당구 백현동 541\n카테고리: 쇼핑,유통 > 백화점 > 현대백화점\n전화번호: 031-5170-2233\n상세정보: http://place.map.kakao.com/18757447\n---\n... (추가 결과)"
}
```

#### 2. 좌표-주소 변환 (`mcp_kakao_map_coord_to_address`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_coord_to_address",
  "parameters": {
    "x": 127.1120278,
    "y": 37.3955833
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_coord_to_address",
  "result": "주소 변환 결과:\n도로명: 경기 성남시 분당구 판교역로146번길 20\n지번: 경기 성남시 분당구 백현동 535"
}
```

#### 3. 길찾기 (`mcp_kakao_map_find_route`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_find_route",
  "parameters": {
    "origin": "판교역",
    "destination": "정자역",
    "transportation_type": "car",
    "traffic_info": true
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_find_route",
  "result": "🗺️ 길찾기 결과\n\n출발지: 판교역 신분당선 (경기 성남시 분당구 삼평동)\n\n목적지: 정자역 신분당선 (경기 성남시 분당구 정자동)\n\n이동 수단: 자동차\n\n총 거리: 3.6km\n예상 소요 시간: 10분\n예상 택시 요금: 5,600원\n\n📊 교통 상황 요약:\n\n카카오맵에서 보기: https://map.kakao.com/?sName=%ED%8C%90%EA%B5%90%EC%97%AD&eName=%EC%A0%95%EC%9E%90%EC%97%AD\n"
}
```

### Daum 검색 API

#### 1. 웹 문서 검색 (`mcp_kakao_map_search_web`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_search_web",
  "parameters": {
    "query": "카카오브레인 칼로",
    "size": 2
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_search_web",
  "result": "웹 문서 검색 결과 (총 2083개 중 2개 표시):\n\n1. 카카오브레인 | 칼로 Karlo\n   내용: 카카오브레인의 이미지 생성 모델 Karlo는 사용자가 입력한 문장(Text)을 이해하여, 세상에 단 하나뿐인 이미지를 만들어내는 인공지능 화가입니다. 수백만 장 규모의...\n   URL: https://kakaobrain.com/karlo\n   날짜: 2024. 1. 1.\n\n2. 카카오브레인, AI 아티스트 '칼로 2.0' 공개 - 테크레시피\n   내용: 카카오브레인이 초거대 인공지능(AI) 이미지 생성 모델 '칼로(Karlo) 2.0'을 공개했다고 11일 밝혔다. 칼로 2.0은 약 3억 장 규모의 텍스트-이미지 데이터셋을 학습한 모델이...\n   URL: https://techrecipe.co.kr/posts/56513\n   날짜: 2023. 7. 11.\n\n현재 페이지가 마지막 페이지가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.\n"
}
```

#### 2. 이미지 검색 (`mcp_kakao_map_search_image`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_search_image",
  "parameters": {
    "query": "고양이",
    "size": 1
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_search_image",
  "result": "이미지 검색 결과 (총 8715385개 중 1개 표시):\n\n1. 컬렉션 이름: Daum 백과\n   문서 URL: http://100.daum.net/encyclopedia/view/172XX61300001\n   이미지 URL: https://t1.daumcdn.net/thumb/R1024x0/?fname=http%3A%2F%2Ft1.daumcdn.net%2Fencyclop%2F172%2F613%2F172XX61300001\n   썸네일 URL: https://search1.kakaocdn.net/thumb/R100x100/?fname=http%3A%2F%2Ft1.daumcdn.net%2Fencyclop%2F172%2F613%2F172XX61300001&token=1579057346066cfd0b2e0c671d07c433\n   크기: 가로 1024px, 세로 682px\n   표시 URL: 100.daum.net\n   날짜: 2014. 11. 6.\n\n현재 페이지가 마지막 페이지가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.\n"
}
```

#### 3. 블로그 검색 (`mcp_kakao_map_search_blog`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_search_blog",
  "parameters": {
    "query": "판교 맛집",
    "size": 1
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_search_blog",
  "result": "블로그 검색 결과 (총 215893개 중 1개 표시):\n\n1. 블로그명: 짱돌의 일상다반사\n   제목: 판교 맛집 추천 | 유스페이스몰 가성비 좋은 점심 맛집\n   내용: 판교테크노밸리 유스페이스몰은 늘 점심시간마다 직장인들로 인산인해를 이루는 곳이다. 오늘은 판교 점심 맛집으로 괜찮은 곳 두 군데를 소개해 본다. 1.... \n   URL: http://jdcamping.tistory.com/1374\n   썸네일: https://search2.kakaocdn.net/thumb/R180x180/?fname=https%3A%2F%2Fblog.kakaocdn.net%2Fdn%2FcQv0tX%2FbtrOfR4oUu3%2FdKQGkK0kY6kKk40f4kYkYK%2Fimg.jpg&token=1c251bb24ae4bb01657303012e2641ac\n   날짜: 2024. 12. 17.\n\n현재 페이지가 마지막 페이지가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.\n"
}
```

#### 4. 카페 검색 (`mcp_kakao_map_search_cafe`)

**호출 (Request):**
```json
{
  "tool_name": "mcp_kakao_map_search_cafe",
  "parameters": {
    "query": "코딩 스터디",
    "size": 1
  }
}
```

**응답 (Response - 예시):**
```json
{
  "tool_name": "mcp_kakao_map_search_cafe",
  "result": "카페 검색 결과 (총 18335개 중 1개 표시):\n\n1. 카페명: 독취사-취업,대학생,대기업,공기업,NCS,인적성,취업카페\n   제목: [스터디] 웹개발/코딩 기초 스터디 구해요\n   내용: 안녕하세요! 웹개발 및 코딩 기초를 함께 공부할 스터디원을 모집합니다. 현재 2명이며, 최대 4명까지 생각하고 있습니다. 장소는 주로 강남/사당에서 진행하고, 온라...\n   URL: http://cafe.daum.net/breakjob/DldL/12345\n   썸네일: https://search1.kakaocdn.net/thumb/P180x180/?fname=https%3A%2F%2Ft1.daumcdn.net%2Fcafe_image%2F%2Fconfig%2Fimg_default_profile%3Fver%3D1&token=de43b9d06222d0a2192f9f70fcb0f134\n   날짜: 2025. 3. 28.\n\n현재 페이지가 마지막 페이지가 아닙니다. 더 많은 결과를 보려면 page 매개변수를 증가시키세요.\n"
}
```

## 설치 및 설정

1. **저장소 복제 및 종속성 설치:**
```bash
git clone https://github.com/yousleepwhen/kakao-api-mcp-server.git # 저장소 URL을 실제 URL로 변경해주세요
cd kakao-api-mcp-server
yarn install
```
*   이 프로젝트는 `yarn` 패키지 매니저 사용을 권장합니다.

2. **카카오 REST API 키 설정:**
   - 프로젝트 루트 디렉토리에 `.env` 파일을 생성합니다.
   - `.env` 파일 안에 다음과 같이 카카오 디벨로퍼스에서 발급받은 REST API 키를 입력합니다:
     ```
     KAKAO_REST_API_KEY=여기에_카카오_REST_API_키_입력
     ```
   - 또는, 서버 실행 시 `--kakao-api-key` 인자를 통해 직접 전달할 수도 있습니다.

## 실행 방법

서버를 실행하기 전에 코드를 빌드해야 합니다. `start` 관련 스크립트에 빌드 과정이 포함되어 있으므로 별도로 `yarn build`를 실행할 필요는 없습니다.

### HTTP 모드 (기본)

다른 서비스나 도구와 HTTP를 통해 통신할 때 사용합니다.

```bash
yarn start
```

기본적으로 3000번 포트를 사용합니다. 포트를 변경하려면 `--port` 인자를 사용하세요:

```bash
yarn start --port 8080
```

### stdio 모드

터미널의 표준 입출력(stdin/stdout)을 통해 MCP 메시지를 주고받을 때 사용합니다.

```bash
yarn start:stdio
```

### 개발 모드

개발 중 코드 변경 시 자동으로 빌드하고 서버를 재시작하려면 (nodemon 등 별도 설정 필요) `dev` 스크립트를 활용할 수 있습니다. 현재 `dev` 스크립트는 `start`와 동일하게 동작합니다.

```bash
yarn dev
```

## 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.