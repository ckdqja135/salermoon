import { z } from "zod";
import { SORT_OPTIONS, EXCLUDE_OPTIONS } from "@/config/naver";
import type { CollectionMeta } from "@/lib/shopping/core.mjs";

// ==================== 수집 원본 아이템 타입 ====================

/**
 * 수집된 상품 원본 아이템
 * 종료된 네이버 쇼핑 오픈 API의 응답 형식을 그대로 유지해 기존 필터/통계 로직을 재사용한다.
 * (현재 데이터 출처는 네이버 통합검색 쇼핑 영역 — src/lib/shoppingSource.ts)
 */
export interface NaverShopRawItem {
  title: string;
  link: string;
  image: string;
  lprice: string; // 기존 API 형식과 동일하게 문자열 유지
  hprice: string;
  mallName: string; // 가격비교 카탈로그는 개별 판매처명이 없어 빈 문자열
  productId: string;
  productType: string; // "1" = 가격비교 카탈로그, "2" = 일반 판매처 상품
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
  /** 가격비교 카탈로그의 판매처 수 (일반 상품은 0) */
  sellerCount?: number;
  /** 해외직구 상품 여부 (수집 데이터의 isOverseaProduct) */
  isOversea?: boolean;
}

/** 수집 경로/범위 메타 정보 (응답에 그대로 전달) */
export type SearchCollectionMeta = CollectionMeta;

// ==================== 내부 사용 타입 ====================

/** 정제된 상품 아이템 */
export interface Item {
  title: string;
  titleText: string; // HTML 태그 제거된 텍스트
  lprice: number;
  hprice: number;
  mallName: string;
  link: string;
  image?: string;
  productId: string;
  productType: string;
  brand?: string;
  maker?: string;
  category1?: string;
  category2?: string;
  category3?: string;
  category4?: string;
  /** 가격비교 카탈로그의 판매처 수 (일반 상품은 0) */
  sellerCount?: number;
  /** 해외직구 상품 여부 */
  isOversea?: boolean;
}

/** 정렬 옵션 타입 */
export type SortOption = (typeof SORT_OPTIONS)[keyof typeof SORT_OPTIONS];

/** 제외 옵션 타입 */
export type ExcludeOption = (typeof EXCLUDE_OPTIONS)[keyof typeof EXCLUDE_OPTIONS];

/** 검색 필터 옵션 (null은 미적용 의미) */
export interface SearchFilters {
  minPrice: number | null;
  maxPrice: number | null;
  sort: SortOption;
  exclude: ExcludeOption[] | null;
  pages: number;
  filterNoise: boolean;
}

/** 동일 가격대 그룹 */
export interface PriceGroup {
  price: number;
  count: number;
  items: Item[];
  representative: Item; // 그룹 대표 상품 (첫 번째)
}

/** 가격 밴드 요약 */
export interface PriceBandSummary {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
}

/** 목표가 비교 결과 */
export interface TargetPriceComparison {
  targetPrice: number;
  lowestPrice: number;
  difference: number;
  differencePercent: number;
  status: "higher" | "lower" | "equal";
  statusText: string;
}

/**
 * 완화 단계 타입
 * - 가격 필터(minPrice/maxPrice)는 완화 대상이 아님
 * - 비가격 필터만 완화 대상
 */
export type RelaxationStep =
  | "dropFilterNoise"
  | "dropExclude"
  | "reducePages"
  | "increasePages";

/** 완화 단계 설명 */
export const RELAXATION_STEP_LABELS: Record<RelaxationStep, string> = {
  dropFilterNoise: "노이즈 필터 해제",
  dropExclude: "제외 옵션 해제 (중고/렌탈/해외직구 포함)",
  reducePages: "검색 범위 축소",
  increasePages: "검색 범위 확대 (고가 제품 탐색)",
};

/** 적용된 필터 요약 (개발용) */
export interface AppliedFilters {
  minPrice: number | null;
  maxPrice: number | null;
  filterNoise: boolean;
  exclude: ExcludeOption[] | null;
  excludeKeywordsEnabled: boolean; // exclude 키워드 필터 활성화 여부
  pages: number;
}

/** API 응답 */
export interface LowestPriceResponse {
  query: string;
  filters: SearchFilters;
  top1: Item | null;
  top10Groups: PriceGroup[];
  priceBand: PriceBandSummary | null;
  totalCandidates: number;
  /** 수집된 일반 상품 카드 수 (광고 제외, 중복 제거 후) — 전체 검색 건수가 아님 */
  totalFromApi: number;
  /** 수집 경로/범위 정보 — 정렬·통계는 이 범위 내 기준임을 표시 */
  collection: SearchCollectionMeta;
  // 완화 관련 필드
  filterRelaxed: boolean;
  appliedRelaxation: RelaxationStep[];
  appliedFilters: AppliedFilters;
  // 디버깅용
  excludedByKeywordsCount: number; // exclude 키워드로 제외된 건수
  // 추가 리스트용 (Top10 이후 데이터)
  allItems: Item[];
}

// ==================== Zod 스키마 (런타임 검증) ====================

const SortOptionSchema = z.enum(["sim", "date", "asc", "dsc"]);
const ExcludeOptionSchema = z.enum(["used", "rental", "cbshop"]);

/** 요청 쿼리 파라미터 스키마 */
export const SearchRequestSchema = z.object({
  query: z
    .string()
    .min(1, "검색어는 필수입니다")
    .max(100, "검색어는 100자를 초과할 수 없습니다"),
  minPrice: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const num = parseInt(val, 10);
      // 비정상 값(NaN, 음수)은 무시
      if (isNaN(num) || num < 0) return undefined;
      return num;
    }),
  maxPrice: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const num = parseInt(val, 10);
      // 비정상 값(NaN, 음수)은 무시
      if (isNaN(num) || num < 0) return undefined;
      return num;
    }),
  sort: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const result = SortOptionSchema.safeParse(val);
    return result.success ? result.data : undefined;
  }),
  exclude: z.string().optional().transform((val) => {
    if (!val) return undefined;
    const items = val.split(":");
    return items.filter((item) => ExcludeOptionSchema.safeParse(item).success) as ExcludeOption[];
  }),
  pages: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      const num = parseInt(val, 10);
      if (isNaN(num) || num < 1) return undefined;
      return num;
    }),
  filterNoise: z
    .string()
    .optional()
    .transform((val) => val === "true"),
});

/** 검증된 요청 타입 */
export type ValidatedSearchRequest = z.infer<typeof SearchRequestSchema>;
