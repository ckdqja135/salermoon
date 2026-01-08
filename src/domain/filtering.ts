/**
 * 상품 필터링/정렬/후처리 로직 (Domain 레이어)
 * 순수 함수로 구성되어 테스트 용이
 *
 * [핵심 원칙]
 * 1. 가격 필터(minPrice/maxPrice)는 절대 완화되지 않음
 * 2. 필터 우선순위: 가격 → exclude 키워드 → 노이즈
 * 3. exclude 키워드 필터는 사용자가 체크한 옵션만 활성화
 */

import {
  Item,
  NaverShopRawItem,
  SearchFilters,
  PriceGroup,
  PriceBandSummary,
  RelaxationStep,
  AppliedFilters,
  ExcludeOption,
} from "@/types/naver";
import { RESULT_CONFIG, EXCLUDE_KEYWORDS } from "@/config/naver";
import { stripHtmlTags, containsAnyKeyword, safeParseInt } from "@/utils/text";
import { TEXT_FILTER_CONFIG } from "@/config/naver";

/** 필터링 결과 */
export interface FilteringResult {
  items: Item[];
  filterRelaxed: boolean;
  appliedRelaxation: RelaxationStep[];
  appliedFilters: AppliedFilters;
  excludedByKeywordsCount: number; // exclude 키워드로 제외된 건수
}

/**
 * 네이버 API 원본 아이템을 내부 Item 형식으로 변환
 * - title 정제(stripHtml)만 수행하고 과도한 문자열 필터는 최소화
 */
export function transformRawItem(raw: NaverShopRawItem): Item {
  return {
    title: raw.title,
    titleText: stripHtmlTags(raw.title),
    lprice: safeParseInt(raw.lprice, 0),
    hprice: safeParseInt(raw.hprice, 0),
    mallName: raw.mallName || "",
    link: raw.link,
    image: raw.image || undefined,
    productId: raw.productId || "",
    productType: raw.productType || "",
    brand: raw.brand || undefined,
    maker: raw.maker || undefined,
    category1: raw.category1 || undefined,
    category2: raw.category2 || undefined,
    category3: raw.category3 || undefined,
    category4: raw.category4 || undefined,
  };
}

/**
 * 노이즈 키워드 포함 여부 확인
 */
function hasNoiseKeyword(titleText: string): boolean {
  return containsAnyKeyword(titleText, TEXT_FILTER_CONFIG.NOISE_KEYWORDS);
}

/**
 * exclude 키워드 필터 체크
 * - exclude 옵션에 포함된 타입의 키워드만 체크
 * - API exclude만으로는 불완전하므로 후처리 필터 필수
 */
function hasExcludeKeyword(titleText: string, excludeOptions: ExcludeOption[]): boolean {
  for (const option of excludeOptions) {
    const keywords = EXCLUDE_KEYWORDS[option];
    if (containsAnyKeyword(titleText, keywords)) {
      return true;
    }
  }
  return false;
}

/**
 * 가격 필터 (null은 해당 조건 미적용)
 * [우선순위 1] 가격 필터는 항상 첫 단계로 적용
 */
function matchesPriceFilter(
  item: Item,
  minPrice: number | null,
  maxPrice: number | null
): boolean {
  // lprice가 0이면 가격 정보 없음 - 제외
  if (item.lprice <= 0) return false;

  // 최소 가격 체크 (null이면 미적용)
  if (minPrice !== null && item.lprice < minPrice) return false;

  // 최대 가격 체크 (null이면 미적용)
  if (maxPrice !== null && item.lprice > maxPrice) return false;

  return true;
}

/**
 * 필터 조건에 맞는지 확인
 * 적용 순서: [1] 가격 필터 → [2] exclude 키워드 → [3] 노이즈 필터
 */
function matchesFilters(
  item: Item,
  minPrice: number | null,
  maxPrice: number | null,
  excludeOptions: ExcludeOption[] | null,
  filterNoise: boolean
): boolean {
  // [1단계] 가격 필터 - 최우선
  if (!matchesPriceFilter(item, minPrice, maxPrice)) return false;

  // [2단계] exclude 키워드 필터 (사용자가 체크한 옵션만)
  if (excludeOptions !== null && excludeOptions.length > 0) {
    if (hasExcludeKeyword(item.titleText, excludeOptions)) return false;
  }

  // [3단계] 노이즈 키워드 제외 (옵션)
  if (filterNoise && hasNoiseKeyword(item.titleText)) return false;

  return true;
}

/**
 * link 기준 중복 제거
 * 첫 번째로 등장한 아이템 유지 (수집순=정확도순 보존)
 */
export function deduplicateByLink(items: Item[]): Item[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });
}

/**
 * 가격 오름차순 정렬
 * 동일 가격 시 원래 순서(정확도) 유지 (stable sort)
 */
export function sortByPriceAsc(items: Item[]): Item[] {
  return [...items].sort((a, b) => a.lprice - b.lprice);
}

/**
 * 필터 적용 및 결과 반환 (중복제거 + 정렬 포함)
 */
function applyFiltersAndProcess(
  items: Item[],
  minPrice: number | null,
  maxPrice: number | null,
  excludeOptions: ExcludeOption[] | null,
  filterNoise: boolean
): Item[] {
  const filtered = items.filter((item) =>
    matchesFilters(item, minPrice, maxPrice, excludeOptions, filterNoise)
  );
  const deduplicated = deduplicateByLink(filtered);
  return sortByPriceAsc(deduplicated);
}

/**
 * exclude 키워드로 제외된 건수 계산 (디버깅용)
 */
function countExcludedByKeywords(
  items: Item[],
  minPrice: number | null,
  maxPrice: number | null,
  excludeOptions: ExcludeOption[] | null
): number {
  if (excludeOptions === null || excludeOptions.length === 0) return 0;

  let count = 0;
  for (const item of items) {
    // 가격 필터는 통과했지만 exclude 키워드에 걸린 아이템 수
    if (matchesPriceFilter(item, minPrice, maxPrice)) {
      if (hasExcludeKeyword(item.titleText, excludeOptions)) {
        count++;
      }
    }
  }
  return count;
}

/**
 * 메인 필터링 파이프라인
 *
 * [핵심 원칙]
 * - 가격 필터(minPrice/maxPrice)는 절대 완화되지 않음
 * - 가격 필터는 항상 첫 단계로 적용
 * - exclude 키워드 필터는 사용자가 체크한 옵션만 활성화
 * - 완화 대상은 비가격 필터(filterNoise)만 해당
 *
 * 완화 순서 (결과 0건 시, 비가격 필터만):
 * 1) filterNoise=false 강제
 * 2) exclude 파라미터 제거 (서비스 레이어에서 처리)
 * 3) pages 축소 (서비스 레이어에서 처리)
 *
 * @param rawItems - 네이버 API 원본 아이템 목록
 * @param filters - 검색 필터
 * @returns 필터링 및 정렬된 아이템 목록 + 완화 정보
 */
export function filterAndSortItems(
  rawItems: NaverShopRawItem[],
  filters: SearchFilters
): FilteringResult {
  // 1. 변환
  const items = rawItems.map(transformRawItem);

  // 가격 필터는 절대 변경하지 않음 (원본 유지)
  const minPrice = filters.minPrice;
  const maxPrice = filters.maxPrice;

  // exclude 옵션도 원본 유지 (API + 후처리 필터 모두 적용)
  const excludeOptions = filters.exclude;

  // 비가격 필터만 완화 대상
  let currentFilterNoise = filters.filterNoise;

  const appliedRelaxation: RelaxationStep[] = [];

  // 2. 초기 필터링 (가격 + exclude 키워드 + 노이즈)
  let result = applyFiltersAndProcess(
    items,
    minPrice,
    maxPrice,
    excludeOptions,
    currentFilterNoise
  );

  // 3. 결과가 0건이면 비가격 필터만 완화
  // [완화 단계 1] filterNoise=false 강제
  if (result.length === 0 && currentFilterNoise) {
    currentFilterNoise = false;
    appliedRelaxation.push("dropFilterNoise");
    result = applyFiltersAndProcess(items, minPrice, maxPrice, excludeOptions, currentFilterNoise);
  }

  // [중요] 가격 필터와 exclude 키워드 필터는 절대 완화하지 않음
  // - exclude 옵션이 있으면 해당 키워드 필터는 항상 적용
  // - 결과가 0건이더라도 유지

  // 4. exclude 키워드로 제외된 건수 계산 (디버깅용)
  const excludedByKeywordsCount = countExcludedByKeywords(
    items,
    minPrice,
    maxPrice,
    excludeOptions
  );

  // 5. 적용된 필터 요약 (가격 필터와 exclude는 항상 원본 유지)
  const appliedFilters: AppliedFilters = {
    minPrice,  // 원본 유지
    maxPrice,  // 원본 유지
    filterNoise: currentFilterNoise,
    exclude: excludeOptions,  // 원본 유지
    excludeKeywordsEnabled: excludeOptions !== null && excludeOptions.length > 0,
    pages: filters.pages,
  };

  return {
    items: result,
    filterRelaxed: appliedRelaxation.length > 0,
    appliedRelaxation,
    appliedFilters,
    excludedByKeywordsCount,
  };
}

/**
 * 동일 가격대 상품 그룹핑
 * @param items - 정렬된 아이템 목록 (가격 오름차순)
 * @param maxGroups - 최대 그룹 수 (Top N)
 * @returns 가격 그룹 배열
 */
export function groupByPrice(
  items: Item[],
  maxGroups: number = RESULT_CONFIG.TOP_N
): PriceGroup[] {
  if (items.length === 0) return [];

  const groupMap = new Map<number, Item[]>();

  // 가격별 그룹핑
  for (const item of items) {
    const existing = groupMap.get(item.lprice) || [];
    if (existing.length < RESULT_CONFIG.MAX_ITEMS_PER_GROUP) {
      existing.push(item);
      groupMap.set(item.lprice, existing);
    }
  }

  // Map을 배열로 변환하고 가격순 정렬
  const groups: PriceGroup[] = Array.from(groupMap.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, maxGroups)
    .map(([price, groupItems]) => ({
      price,
      count: groupItems.length,
      items: groupItems,
      representative: groupItems[0],
    }));

  return groups;
}

/**
 * 가격 밴드 요약 계산
 * @param groups - 가격 그룹 배열
 * @returns 가격 밴드 요약 또는 null
 */
export function calculatePriceBand(groups: PriceGroup[]): PriceBandSummary | null {
  if (groups.length === 0) return null;

  const prices = groups.map((g) => g.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // 가중 평균 (각 그룹의 상품 수 고려)
  const totalItems = groups.reduce((sum, g) => sum + g.count, 0);
  const weightedSum = groups.reduce((sum, g) => sum + g.price * g.count, 0);
  const avgPrice = Math.round(weightedSum / totalItems);

  // 중앙값 (상품 수 고려)
  const allPrices: number[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.count; i++) {
      allPrices.push(group.price);
    }
  }
  allPrices.sort((a, b) => a - b);
  const mid = Math.floor(allPrices.length / 2);
  const medianPrice =
    allPrices.length % 2 === 0
      ? Math.round((allPrices[mid - 1] + allPrices[mid]) / 2)
      : allPrices[mid];

  return {
    minPrice,
    maxPrice,
    avgPrice,
    medianPrice,
  };
}

/**
 * Top1과 Top10 그룹 추출
 */
export function extractTopResults(items: Item[]): {
  top1: Item | null;
  top10Groups: PriceGroup[];
  priceBand: PriceBandSummary | null;
} {
  const top1 = items.length > 0 ? items[0] : null;
  const top10Groups = groupByPrice(items, RESULT_CONFIG.TOP_N);
  const priceBand = calculatePriceBand(top10Groups);

  return { top1, top10Groups, priceBand };
}
