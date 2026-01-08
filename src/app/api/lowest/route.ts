/**
 * 최저가 검색 API Route Handler
 * HTTP 입출력만 담당, 비즈니스 로직은 서비스 레이어로 위임
 * 
 * API 문서: https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md
 */

import { NextRequest, NextResponse } from "next/server";
import { SearchRequestSchema } from "@/types/naver";
import { getLowestPrice, normalizeFilters } from "@/services/getLowestPrice";
import {
  ValidationError,
  toSafeErrorMessage,
  getErrorStatusCode,
  getErrorDetails,
} from "@/utils/errors";
import { CACHE_CONFIG } from "@/config/naver";
import { validateEnv } from "@/utils/env";

// 환경 변수 초기화 시점 검증 (서버 시작 시 한 번만 실행)
const envValidation = validateEnv();
if (!envValidation.valid && process.env.NODE_ENV === "development") {
  console.warn("⚠️ 환경 변수 검증 실패:", envValidation.missing);
  console.warn("💡 .env.local 파일을 확인하세요.");
}

/**
 * 쿼리스트링을 안정적으로 정렬하여 캐시 키 생성
 */
function buildCacheKey(params: Record<string, string | undefined>): string {
  const sorted = Object.keys(params)
    .sort()
    .filter((key) => params[key] !== undefined)
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return sorted;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const searchParams = request.nextUrl.searchParams;

  try {
    // 1. 요청 파라미터 추출
    const rawParams = {
      query: searchParams.get("query") ?? "",
      minPrice: searchParams.get("minPrice") ?? undefined,
      maxPrice: searchParams.get("maxPrice") ?? undefined,
      sort: searchParams.get("sort") ?? undefined,
      exclude: searchParams.get("exclude") ?? undefined,
      pages: searchParams.get("pages") ?? undefined,
      filterNoise: searchParams.get("filterNoise") ?? undefined,
    };

    // 2. 입력 검증
    const validation = SearchRequestSchema.safeParse(rawParams);
    if (!validation.success) {
      const errorMessage = validation.error.issues
        .map((e) => e.message)
        .join(", ");
      throw new ValidationError(errorMessage);
    }

    const validatedRequest = validation.data;

    // 3. query 비어있으면 400
    if (!validatedRequest.query.trim()) {
      throw new ValidationError("검색어는 필수입니다");
    }

    // 4. 필터 정규화
    const filters = normalizeFilters(validatedRequest);

    // 5. 서비스 호출
    const result = await getLowestPrice(validatedRequest.query, filters);

    // 6. 캐시 키 로깅 (디버깅용)
    const cacheKey = buildCacheKey({
      query: validatedRequest.query,
      minPrice: String(filters.minPrice),
      maxPrice: String(filters.maxPrice),
      sort: filters.sort,
      exclude: filters.exclude.join(":"),
      pages: String(filters.pages),
      filterNoise: String(filters.filterNoise),
    });
    console.log(`[API] Cache key: ${cacheKey}, Duration: ${Date.now() - startTime}ms`);

    // 7. 성공 응답
    return NextResponse.json(result, {
      status: 200,
      headers: {
        "Cache-Control": `s-maxage=${CACHE_CONFIG.S_MAXAGE}, stale-while-revalidate=${CACHE_CONFIG.STALE_WHILE_REVALIDATE}`,
      },
    });
  } catch (error) {
    // 에러 로깅 (내부용)
    const details = getErrorDetails(error);
    console.error("[API Error]", {
      ...details,
      duration: Date.now() - startTime,
      query: searchParams.get("query"),
    });

    // 안전한 에러 응답 (외부용)
    const statusCode = getErrorStatusCode(error);
    const message = toSafeErrorMessage(error);

    return NextResponse.json(
      { error: message },
      { status: statusCode }
    );
  }
}
