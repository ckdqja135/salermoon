/**
 * 최저가 검색 비즈니스 로직 서비스
 * Route Handler에서 분리된 핵심 로직
 *
 * 데이터 출처: 네이버 통합검색 쇼핑 영역 수집 (src/lib/shoppingSource.ts)
 * - 수집 순서는 통합검색 노출순(관련도순)이며, 정렬·통계는 수집된 상품 범위 내 기준이다.
 * - 페이지 수와 무관하게 검색 1회당 원격 요청은 최대 2회(HTML 1 + 페이지 이동 1)다.
 *
 * [핵심 원칙]
 * 1. 가격 필터(minPrice/maxPrice)는 절대 완화되지 않음
 * 2. exclude 옵션은 구조적 신호(해외직구 플래그) + 키워드 후처리 필터로 적용
 * 3. 완화 대상은 비가격 필터(filterNoise, exclude, pages)만 해당
 */

import { collectShoppingItems } from "@/lib/shoppingSource";
import { filterAndSortItems, extractTopResults } from "@/domain/filtering";
import {
  SearchFilters,
  LowestPriceResponse,
  ValidatedSearchRequest,
  SortOption,
  RelaxationStep,
  AppliedFilters,
} from "@/types/naver";
import { PAGINATION_CONFIG, DEFAULT_FILTERS } from "@/config/naver";

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
 * 완화 순서 (결과 0건 시, 비가격 필터만):
 * 1) filterNoise=false (domain 레이어에서 처리)
 * 2) pages를 최대(10)로 확대해 재수집
 * 3) exclude 해제 후 재필터 (수집 데이터에 후처리만 하므로 재수집 불필요)
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

  // 1. 통합검색에서 상품 수집 (광고 제외·중복 제거·가격/링크 검증 포함)
  let collected = await collectShoppingItems(query, currentPages);

  // 2. 필터링 및 정렬 (가격 필터 원본 유지 + exclude 후처리)
  let filterResult = filterAndSortItems(collected.items, {
    ...filters,
    minPrice,
    maxPrice,
    exclude: currentExclude,
    pages: currentPages,
  });

  // [완화 단계 2] 결과 0건이면 수집 범위를 최대로 확대해 재수집
  if (filterResult.items.length === 0 && currentPages < PAGINATION_CONFIG.MAX_PAGES) {
    currentPages = PAGINATION_CONFIG.MAX_PAGES;
    appliedRelaxation.push("increasePages");

    collected = await collectShoppingItems(query, currentPages);
    filterResult = filterAndSortItems(collected.items, {
      ...filters,
      minPrice,
      maxPrice,
      filterNoise: filterResult.appliedFilters.filterNoise,
      exclude: currentExclude,
      pages: currentPages,
    });
  }

  // [완화 단계 3] exclude 해제 (후처리 필터만 해제하면 되므로 재수집 없음)
  if (filterResult.items.length === 0 && currentExclude !== null && currentExclude.length > 0) {
    currentExclude = null;
    appliedRelaxation.push("dropExclude");

    filterResult = filterAndSortItems(collected.items, {
      ...filters,
      minPrice,
      maxPrice,
      filterNoise: filterResult.appliedFilters.filterNoise,
      exclude: currentExclude,
      pages: currentPages,
    });
  }

  // 3. 전체 완화 단계 병합
  const allRelaxation = [...filterResult.appliedRelaxation, ...appliedRelaxation];

  // 4. 최종 적용된 필터 상태 (가격 필터는 항상 원본)
  const finalAppliedFilters: AppliedFilters = {
    minPrice, // 원본 유지 (절대 null로 변경되지 않음)
    maxPrice, // 원본 유지 (절대 null로 변경되지 않음)
    filterNoise: filterResult.appliedFilters.filterNoise,
    exclude: currentExclude,
    excludeKeywordsEnabled: filterResult.appliedFilters.excludeKeywordsEnabled,
    pages: currentPages,
  };

  // 5. Top1, Top10 그룹 추출
  const { top1, top10Groups, priceBand } = extractTopResults(filterResult.items);

  // 6. 응답 구성 (allItems 포함 - 클라이언트에서 추가 필터링/정렬/표시 가능)
  return {
    query,
    filters,
    top1,
    top10Groups,
    priceBand,
    totalCandidates: filterResult.items.length,
    // 수집된 일반 상품 수 (광고 제외·중복 제거 후). 전체 검색 건수가 아님.
    totalFromApi: collected.items.length,
    collection: collected.meta,
    filterRelaxed: allRelaxation.length > 0,
    appliedRelaxation: allRelaxation,
    appliedFilters: finalAppliedFilters,
    excludedByKeywordsCount: filterResult.excludedByKeywordsCount,
    allItems: filterResult.items, // 전체 필터링된 아이템 (클라이언트 추가 처리용)
  };
}
