/**
 * 상품 검색/수집 설정 상수
 *
 * 수집 경로: 네이버 통합검색(where=shopping) — 종료된 쇼핑 오픈 API를 대체.
 * 근거와 실측 한도: docs/crawling-feasibility.md
 */

// ==================== 수집(크롤러) 설정 ====================
export const CRAWLER_CONFIG = {
  /** 통합검색 HTML 요청 타임아웃 (ms) */
  HTML_TIMEOUT_MS: 10_000,
  /** 페이지 이동(paged-slot) 요청 타임아웃 (ms) */
  PAGED_TIMEOUT_MS: 10_000,
  /** 통합검색 HTML 최대 크기 (실측 ~1.2MB) */
  MAX_HTML_BYTES: 5_000_000,
  /** 페이지 이동 응답 최대 크기 (실측 10페이지 ~400KB) */
  MAX_JSON_BYTES: 3_000_000,
  /** 서버 수집 캐시 TTL (ms) */
  CACHE_TTL_MS: 60_000,
  /** 수집 캐시 최대 항목 수 */
  CACHE_MAX_ENTRIES: 100,
} as const;

// ==================== 정렬 옵션 ====================
export const SORT_OPTIONS = {
  /** 정확도순 (기본값) */
  SIM: "sim",
  /** 날짜순 */
  DATE: "date",
  /** 가격 오름차순 */
  ASC: "asc",
  /** 가격 내림차순 */
  DSC: "dsc",
} as const;

export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS];

// ==================== 제외 옵션 ====================
export const EXCLUDE_OPTIONS = {
  /** 중고 */
  USED: "used",
  /** 렌탈 */
  RENTAL: "rental",
  /** 해외직구, 구매대행 */
  CBSHOP: "cbshop",
} as const;

export type ExcludeOption = (typeof EXCLUDE_OPTIONS)[keyof typeof EXCLUDE_OPTIONS];

/**
 * Exclude 키워드 필터 설정
 * - API exclude만으로는 완전 제외가 안 되므로 클라이언트 후처리 필터 적용
 * - titleText 기준으로 키워드 포함 시 제외
 */
export const EXCLUDE_KEYWORDS = {
  /** 중고 관련 키워드 */
  used: [
    "중고",
    "리퍼",
    "리퍼비시",
    "반품",
    "전시",
    "리뉴얼",
    "테스트",
    "오픈박스",
    "매입",
  ],
  /** 렌탈/대여 관련 키워드 */
  rental: [
    "렌탈",
    "대여",
    "임대",
    "렌트",
    "대차",
    "리스",
  ],
  /** 해외직구/구매대행 관련 키워드 */
  cbshop: [
    "해외직구",
    "직구",
    "구매대행",
    "병행수입",
    "해외배송",
    "역직구",
  ],
} as const;

// ==================== 페이지네이션 설정 ====================
export const PAGINATION_CONFIG = {
  /** 기본 수집 페이지 수 (페이지 수와 무관하게 요청 횟수는 동일하므로 최대로 수집) */
  DEFAULT_PAGES: 10,
  /** 최대 수집 가능 페이지 수 (2026-09-13 실측: 11페이지 이상은 빈 응답) */
  MAX_PAGES: 10,
} as const;

// ==================== 가격 필터 설정 ====================
export const PRICE_CONFIG = {
  /** 기본 최소 가격 */
  DEFAULT_MIN_PRICE: 0,
  /** 기본 최대 가격 (0 = 제한 없음) */
  DEFAULT_MAX_PRICE: 0,
} as const;

// ==================== 기본 필터 설정 ====================
export const DEFAULT_FILTERS = {
  /** 기본 정렬 */
  SORT: SORT_OPTIONS.SIM,
  /** 기본 제외 옵션 */
  EXCLUDE: [EXCLUDE_OPTIONS.USED, EXCLUDE_OPTIONS.RENTAL, EXCLUDE_OPTIONS.CBSHOP] as ExcludeOption[],
} as const;

// ==================== 텍스트 필터 설정 ====================
/**
 * 노이즈 키워드 설정
 * - 최소 필터 원칙: 실제 상품이 아닌 것만 제외
 * - 자동 완화: 결과가 적을 때 이 필터는 자동으로 비활성화됨
 */
export const TEXT_FILTER_CONFIG = {
  /** 
   * 노이즈 키워드 - 제목에 포함 시 제외 (선택적 적용)
   * 최소화 원칙에 따라 실제 상품이 아닌 경우만 포함
   */
  NOISE_KEYWORDS: [
    "견적",
    "상담권",
  ] as string[],
} as const;

// ==================== 캐시 설정 ====================
export const CACHE_CONFIG = {
  /** CDN 캐시 시간 (초) */
  S_MAXAGE: 60,
  /** stale-while-revalidate 시간 (초) */
  STALE_WHILE_REVALIDATE: 300,
} as const;

// ==================== 결과 설정 ====================
export const RESULT_CONFIG = {
  /** TOP N 결과 개수 */
  TOP_N: 10,
  /** 가격 그룹에서 최대 표시할 상품 수 */
  MAX_ITEMS_PER_GROUP: 20,
} as const;

// ==================== UI 표시 설정 ====================
export const DISPLAY_COUNT_OPTIONS = [10, 20, 30, 50, 100] as const;
export type DisplayCountOption = (typeof DISPLAY_COUNT_OPTIONS)[number];

export const DEFAULT_DISPLAY_COUNT: DisplayCountOption = 20;

// ==================== 정렬 옵션 UI 라벨 ====================
export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  sim: "정확도순",
  date: "최신순",
  asc: "가격낮은순",
  dsc: "가격높은순",
} as const;

// ==================== 이상치 제외 설정 (IQR 기반) ====================
export const OUTLIER_CONFIG = {
  /** IQR 배수 (1.5가 표준, 상품 특성상 2.0 사용) */
  IQR_MULTIPLIER: 2.0,
  /** 최소 샘플 수 (이 미만이면 이상치 필터 미적용) */
  MIN_SAMPLE_SIZE: 5,
} as const;

// ==================== 검색 히스토리 설정 ====================
export const SEARCH_HISTORY_CONFIG = {
  /** localStorage 키 */
  STORAGE_KEY: "searchHistory",
  /** 최대 저장 개수 */
  MAX_ITEMS: 15,
} as const;