/**
 * 최저가 검색 비즈니스 로직 서비스
 * Route Handler에서 분리된 핵심 로직
 *
 * [핵심 원칙]
 * 1. 가격 필터(minPrice/maxPrice)는 절대 완화되지 않음
 * 2. exclude 옵션은 API + 후처리 키워드 필터 모두 적용
 * 3. 완화 대상은 비가격 필터(filterNoise, exclude, pages)만 해당
 */

import { fetchAllPages } from "@/lib/naverShopClient";
import { filterAndSortItems, extractTopResults } from "@/domain/filtering";
import {
  SearchFilters,
  LowestPriceResponse,
  ValidatedSearchRequest,
  SortOption,
  ExcludeOption,
  RelaxationStep,
  AppliedFilters,
} from "@/types/naver";
import {
  PAGINATION_CONFIG,
  DEFAULT_FILTERS,
  SORT_OPTIONS,
} from "@/config/naver";

/**
 * 검색 필터 정규화
 * - minPrice/maxPrice는 선택값 (null = 미적용)
 * - minPrice > maxPrice면 자동 swap
 * - 비정상 값(음수/NaN)은 null로 무시
 * - filterNoise 기본값은 false
 */
export function normalizeFilters(request: ValidatedSearchRequest): SearchFilters {
  const pages = Math.min(
    request.pages ?? PAGINATION_CONFIG.DEFAULT_PAGES,
    PAGINATION_CONFIG.MAX_PAGES
  );

  // minPrice/maxPrice 정규화
  let minPrice: number | null = request.minPrice ?? null;
  let maxPrice: number | null = request.maxPrice ?? null;

  // 비정상 값 처리 (음수는 null로)
  if (minPrice !== null && minPrice < 0) minPrice = null;
  if (maxPrice !== null && maxPrice < 0) maxPrice = null;

  // minPrice > maxPrice면 자동 swap
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    [minPrice, maxPrice] = [maxPrice, minPrice];
  }

  return {
    minPrice,
    maxPrice,
    sort: (request.sort as SortOption) ?? DEFAULT_FILTERS.SORT,
    exclude: request.exclude ?? DEFAULT_FILTERS.EXCLUDE,
    pages,
    filterNoise: request.filterNoise ?? false, // 기본값 false
  };
}

/**
 * 최저가 검색 메인 서비스 함수
 *
 * [핵심 원칙]
 * - 가격 필터(minPrice/maxPrice)는 절대 완화되지 않음
 * - exclude 옵션은 API exclude + 후처리 키워드 필터 모두 적용
 * - 완화 대상은 비가격 필터(filterNoise, exclude, pages)만 해당
 *
 * 완화 순서 (결과 0건 시, 비가격 필터만):
 * 1) filterNoise=false (domain 레이어에서 처리)
 * 2) exclude 파라미터 제거 (API + 후처리 필터 모두 해제)
 * 3) pages를 1페이지로 축소
 *
 * @param query - 검색어
 * @param filters - 정규화된 필터
 * @returns 검색 결과 (그룹핑된 Top10 포함)
 */
export async function getLowestPrice(
  query: string,
  filters: SearchFilters
): Promise<LowestPriceResponse> {
  // 가격 필터는 절대 변경하지 않음 (원본 유지)
  const minPrice = filters.minPrice;
  const maxPrice = filters.maxPrice;

  // 비가격 필터만 완화 대상
  let currentExclude = filters.exclude;
  let currentPages = filters.pages;
  const appliedRelaxation: RelaxationStep[] = [];

  // 1. 네이버 API에서 데이터 수집 (exclude 파라미터 포함)
  let { items: rawItems, total: totalFromApi } = await fetchAllPages(
    query,
    currentPages,
    SORT_OPTIONS.ASC,
    currentExclude ?? [] // exclude 파라미터를 API에 전달
  );

  // 2. 필터링 및 정렬 (가격 필터는 항상 원본 유지 + exclude 키워드 후처리)
  let filterResult = filterAndSortItems(rawItems, {
    ...filters,
    minPrice, // 원본 유지
    maxPrice, // 원본 유지
    exclude: currentExclude, // API exclude + 후처리 키워드 필터 적용
    pages: currentPages,
  });

  // 3. 결과가 0건이고 추가 완화가 가능한 경우 (비가격 필터만)
  // [완화 단계 2] exclude 파라미터 제거 (API + 후처리 필터 모두 해제)
  if (filterResult.items.length === 0 && currentExclude !== null && currentExclude.length > 0) {
    currentExclude = null;
    appliedRelaxation.push("dropExclude");

    // API 재호출 (exclude 없이)
    const result = await fetchAllPages(
      query,
      currentPages,
      SORT_OPTIONS.ASC,
      []
    );
    rawItems = result.items;
    totalFromApi = result.total;

    // 재필터링 (가격 필터는 항상 원본 유지, exclude는 해제)
    filterResult = filterAndSortItems(rawItems, {
      ...filters,
      minPrice, // 원본 유지
      maxPrice, // 원본 유지
      filterNoise: filterResult.appliedFilters.filterNoise, // 이전 완화 상태 유지
      exclude: currentExclude, // null로 해제
      pages: currentPages,
    });
  }

  // [완화 단계 3] pages를 1페이지로 축소
  if (filterResult.items.length === 0 && currentPages > 1) {
    currentPages = 1;
    appliedRelaxation.push("reducePages");

    // API 재호출 (1페이지만)
    const result = await fetchAllPages(
      query,
      currentPages,
      SORT_OPTIONS.ASC,
      currentExclude ?? []
    );
    rawItems = result.items;
    totalFromApi = result.total;

    // 재필터링 (가격 필터는 항상 원본 유지, 비가격 필터만 완화)
    filterResult = filterAndSortItems(rawItems, {
      ...filters,
      minPrice, // 원본 유지
      maxPrice, // 원본 유지
      filterNoise: false, // 노이즈 필터만 완화
      exclude: currentExclude,
      pages: currentPages,
    });
  }

  // 4. 전체 완화 단계 병합
  const allRelaxation = [...filterResult.appliedRelaxation, ...appliedRelaxation];

  // 5. 최종 적용된 필터 상태 (가격 필터는 항상 원본)
  const finalAppliedFilters: AppliedFilters = {
    minPrice, // 원본 유지 (절대 null로 변경되지 않음)
    maxPrice, // 원본 유지 (절대 null로 변경되지 않음)
    filterNoise: filterResult.appliedFilters.filterNoise,
    exclude: currentExclude,
    excludeKeywordsEnabled: filterResult.appliedFilters.excludeKeywordsEnabled,
    pages: currentPages,
  };

  // 6. Top1, Top10 그룹 추출
  const { top1, top10Groups, priceBand } = extractTopResults(filterResult.items);

  // 7. 응답 구성
  return {
    query,
    filters,
    top1,
    top10Groups,
    priceBand,
    totalCandidates: filterResult.items.length,
    totalFromApi,
    filterRelaxed: allRelaxation.length > 0,
    appliedRelaxation: allRelaxation,
    appliedFilters: finalAppliedFilters,
    excludedByKeywordsCount: filterResult.excludedByKeywordsCount,
  };
}
