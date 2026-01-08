/**
 * 네이버 쇼핑 API 클라이언트 (Gateway 레이어)
 * API 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
 */

import {
  NaverShopApiResponseSchema,
  NaverShopRawItem,
  SortOption,
  ExcludeOption,
} from "@/types/naver";
import { NAVER_API_CONFIG, PAGINATION_CONFIG, DEFAULT_FILTERS } from "@/config/naver";
import { NaverApiError, TimeoutError } from "@/utils/errors";

/** API 호출 파라미터 */
interface FetchParams {
  query: string;
  display: number;
  start: number;
  sort: SortOption;
  exclude: ExcludeOption[];
}

/**
 * 네이버 API 요청 파라미터 조립
 */
function buildSearchParams(params: FetchParams): URLSearchParams {
  const searchParams = new URLSearchParams({
    query: params.query,
    display: String(params.display),
    start: String(params.start),
    sort: params.sort,
  });

  // exclude 파라미터 조립 (예: "used:rental:cbshop")
  if (params.exclude.length > 0) {
    searchParams.set("exclude", params.exclude.join(":"));
  }

  return searchParams;
}

/**
 * 네이버 API 요청 헤더 생성
 */
function buildHeaders(): HeadersInit {
  const clientId = process.env.NAVER_CLIENT_ID;
  const clientSecret = process.env.NAVER_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new NaverApiError("네이버 API 인증 정보가 설정되지 않았습니다");
  }

  return {
    "X-Naver-Client-Id": clientId,
    "X-Naver-Client-Secret": clientSecret,
  };
}

/**
 * 단일 페이지 API 호출
 */
async function fetchSinglePage(
  query: string,
  start: number,
  sort: SortOption,
  exclude: ExcludeOption[]
): Promise<{ items: NaverShopRawItem[]; total: number }> {
  const params = buildSearchParams({
    query,
    display: NAVER_API_CONFIG.DISPLAY_PER_PAGE,
    start,
    sort,
    exclude,
  });

  const url = `${NAVER_API_CONFIG.ENDPOINT}?${params.toString()}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NAVER_API_CONFIG.TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: buildHeaders(),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new NaverApiError(
        `네이버 API 응답 오류: ${response.status}`,
        { status: response.status, statusText: response.statusText, body: errorBody }
      );
    }

    const data = await response.json();
    
    // 런타임 검증
    const validated = NaverShopApiResponseSchema.safeParse(data);
    if (!validated.success) {
      console.warn("[NaverShopClient] API 응답 형식 불일치:", validated.error);
      return { items: data.items ?? [], total: data.total ?? 0 };
    }

    return {
      items: validated.data.items as NaverShopRawItem[],
      total: validated.data.total,
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof Error && error.name === "AbortError") {
      throw new TimeoutError(error);
    }
    if (error instanceof NaverApiError) {
      throw error;
    }
    throw new NaverApiError("네이버 API 호출 중 오류가 발생했습니다", error);
  }
}

/**
 * 수집할 start 값 목록 계산
 * @param pages - 수집할 페이지 수
 * @returns start 값 배열 (예: [1, 101, 201])
 */
function calculateStartValues(pages: number): number[] {
  const effectivePages = Math.min(pages, PAGINATION_CONFIG.MAX_PAGES);
  const startValues: number[] = [];

  for (let i = 0; i < effectivePages; i++) {
    const start = 1 + i * NAVER_API_CONFIG.DISPLAY_PER_PAGE;
    if (start > PAGINATION_CONFIG.MAX_START_VALUE) break;
    startValues.push(start);
  }

  return startValues;
}

/**
 * 여러 페이지의 상품 데이터 수집
 * @param query - 검색어
 * @param pages - 수집할 페이지 수
 * @param sort - 정렬 옵션
 * @param exclude - 제외 옵션
 * @returns 모든 페이지의 상품 목록 (수집 순서 유지)
 */
export async function fetchAllPages(
  query: string,
  pages: number,
  sort: SortOption = DEFAULT_FILTERS.SORT,
  exclude: ExcludeOption[] = DEFAULT_FILTERS.EXCLUDE
): Promise<{ items: NaverShopRawItem[]; total: number }> {
  const startValues = calculateStartValues(pages);
  
  // 순차적으로 호출 (네이버 API 부하 방지)
  const allItems: NaverShopRawItem[] = [];
  let totalFromApi = 0;
  
  for (const start of startValues) {
    const { items, total } = await fetchSinglePage(query, start, sort, exclude);
    allItems.push(...items);
    totalFromApi = total; // 마지막 응답의 total 사용
  }

  return { items: allItems, total: totalFromApi };
}
