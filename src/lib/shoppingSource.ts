/**
 * 네이버 통합검색 기반 상품 수집 (Gateway 레이어)
 *
 * 종료된 네이버 쇼핑 오픈 API를 대체한다. API 키가 필요 없다.
 * 검증 기록: docs/crawling-feasibility.md, 재현: npm run check:shopping-source -- "검색어" --deep
 *
 * 수집 경로 (2026-10-21 기준):
 * 1. https://search.naver.com/search.naver?where=shopping&query=... HTML의
 *    쇼핑 초기 상태(_INITIAL_STATE)를 acorn으로 정적 해석 (1페이지 카드 + 세션 파라미터)
 * 2. 상품 슬롯 API(ns-portal shopping-paged-slot v3)는 요청당 1페이지만 반환하므로
 *    (2026-10 중순 소스 개편으로 누적 페이지네이션 제거됨),
 *    관측 가격의 분위수로 나눈 가격 구간(price="min|max") 요청을 병렬 수행해
 *    수집 범위를 넓힌다. 수집 범위 N = 원격 요청 수 상한 (HTML 1 + 기본 1 + 구간 N-2).
 *
 * 주의: 공식 API 계약이 아닌 웹 화면 내부 요청이므로 형식 변경에 대비해
 * 구조 검증 실패 시 명확한 오류를 던지고, 차단(418/429/로그인)은 별도 오류로 구분한다.
 */

import {
  parseShoppingState,
  cardsFromPages,
  pagesFromPagedResponse,
  pagingRequest,
  pickPrice,
  buildPriceSlices,
  buildCollection,
  detectBlocked,
  SOURCE_MAX_PAGES,
  type CrawledRawItem,
  type CollectionMeta,
  type ShoppingState,
  type SourceCard,
} from "./shopping/core.mjs";
import { CRAWLER_CONFIG } from "@/config/naver";
import { NaverApiError, SourceBlockedError, TimeoutError } from "@/utils/errors";

export type { CrawledRawItem, CollectionMeta };

export interface CollectResult {
  items: CrawledRawItem[];
  meta: CollectionMeta;
}

// ==================== 응답 크기 제한 읽기 ====================

async function readLimitedBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      size += value.byteLength;
      if (size > maxBytes) {
        throw new NaverApiError(`응답이 크기 제한(${maxBytes} bytes)을 초과했습니다`);
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function fetchText(
  url: URL,
  init: { headers?: Record<string, string>; timeoutMs: number; maxBytes: number }
): Promise<{ status: number; finalHost: string; body: string; ok: boolean }> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: init.headers,
      redirect: "follow",
      signal: AbortSignal.timeout(init.timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new TimeoutError(error);
    }
    throw new NaverApiError("검색 요청 중 네트워크 오류가 발생했습니다", error);
  }
  const body = await readLimitedBody(response, init.maxBytes);
  return {
    status: response.status,
    finalHost: new URL(response.url).hostname,
    body,
    ok: response.ok,
  };
}

// ==================== 수집 ====================

async function fetchInitialState(
  query: string
): Promise<{ state: ShoppingState; firstPageCards: SourceCard[] } | { empty: true }> {
  const url = new URL("https://search.naver.com/search.naver");
  url.searchParams.set("where", "shopping");
  url.searchParams.set("query", query);

  const res = await fetchText(url, {
    timeoutMs: CRAWLER_CONFIG.HTML_TIMEOUT_MS,
    maxBytes: CRAWLER_CONFIG.MAX_HTML_BYTES,
  });

  const blocked = detectBlocked({ status: res.status, finalHost: res.finalHost, html: res.body });
  if (blocked) throw new SourceBlockedError(blocked);
  if (!res.ok) throw new NaverApiError(`통합검색 응답 오류: HTTP ${res.status}`);

  const state = parseShoppingState(res.body);
  if (!state) {
    // 결과 없는 검색어의 페이지에는 쇼핑 모듈 참조(newshopping) 자체가 없다.
    // 참조는 있는데 상태를 못 읽으면 페이지 형식이 바뀐 것으로 구분한다.
    if (!res.body.includes("newshopping")) return { empty: true };
    throw new NaverApiError("통합검색 쇼핑 데이터 형식이 변경되어 상품을 해석할 수 없습니다");
  }
  return { state, firstPageCards: cardsFromPages(state.initProps.pagedSlot) };
}

async function fetchSlotCards(
  state: ShoppingState,
  label: string,
  extraParams: Record<string, string> = {}
): Promise<{ cards: SourceCard[] } | { warning: string }> {
  const { url, headers } = pagingRequest(state, 1, extraParams);
  let res: { status: number; finalHost: string; body: string; ok: boolean };
  try {
    res = await fetchText(url, {
      headers,
      timeoutMs: CRAWLER_CONFIG.PAGED_TIMEOUT_MS,
      maxBytes: CRAWLER_CONFIG.MAX_JSON_BYTES,
    });
  } catch (error) {
    return { warning: `${label} 요청 실패(${error instanceof Error ? error.message : String(error)})` };
  }
  if (res.status === 418 || res.status === 429) {
    return { warning: `${label} 요청이 제한됨(HTTP ${res.status})` };
  }
  if (!res.ok) {
    return { warning: `${label} 응답 오류(HTTP ${res.status})` };
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { warning: `${label} 응답이 JSON이 아님` };
  }
  const pages = pagesFromPagedResponse(json);
  if (!pages) {
    return { warning: `${label} 응답 형식이 변경됨` };
  }
  return { cards: cardsFromPages(pages) };
}

/** 작은 동시성으로 병렬 실행 (소스 부하와 응답 시간의 절충) */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await run(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function collectOnce(query: string, pages: number): Promise<CollectResult> {
  const effectivePages = Math.max(1, Math.min(pages, SOURCE_MAX_PAGES));
  const initial = await fetchInitialState(query);

  if ("empty" in initial) {
    // 쇼핑 검색 결과가 없는 검색어 — 오류가 아닌 빈 결과로 처리
    return buildCollection({
      primaryCards: [],
      pagesRequested: effectivePages,
      requestsSucceeded: 1,
      warnings: ["통합검색에 쇼핑 결과가 없습니다."],
    });
  }

  const { state, firstPageCards } = initial;
  const warnings: string[] = [];
  let requestsSucceeded = 1; // HTML

  if (effectivePages === 1) {
    return buildCollection({
      primaryCards: firstPageCards,
      pagesRequested: effectivePages,
      requestsSucceeded,
    });
  }

  // 기본(필터 없는) 상품 슬롯 요청 — 노출 순서의 기준. HTML과는 광고 로테이션으로 구성이 다르다.
  const base = await fetchSlotCards(state, "상품 슬롯");
  let primaryCards = firstPageCards;
  const extraCards: SourceCard[] = [];
  if ("warning" in base) {
    warnings.push(base.warning);
  } else {
    primaryCards = base.cards;
    extraCards.push(...firstPageCards);
    requestsSucceeded += 1;
  }

  // 가격 구간 분할: 기준 수집에서 관측한 가격 분포로 구간을 나눠 추가 수집
  const observedPrices = [...primaryCards, ...extraCards]
    .filter((card) => card.sourceType === "SAS")
    .map((card) => pickPrice(card))
    .filter((price): price is number => price !== null);
  const priceSlices = buildPriceSlices(observedPrices, effectivePages - 2);

  if (priceSlices.length > 0) {
    const sliceResults = await mapWithConcurrency(priceSlices, 3, (slice) =>
      fetchSlotCards(state, `가격 구간(${slice.replace("|", "~")}원)`, {
        price: slice,
        filterSource: "SHOPPING",
      })
    );
    for (const result of sliceResults) {
      if ("warning" in result) {
        warnings.push(result.warning);
      } else {
        extraCards.push(...result.cards);
        requestsSucceeded += 1;
      }
    }
  }

  return buildCollection({
    primaryCards,
    extraCards,
    pagesRequested: effectivePages,
    requestsSucceeded,
    priceSlices,
    warnings,
  });
}

// ==================== 캐시 + 동일 요청 병합 ====================

interface CacheEntry {
  expires: number;
  promise: Promise<CollectResult>;
}

const cache = new Map<string, CacheEntry>();

function pruneCache(now: number): void {
  for (const [key, entry] of cache) {
    if (entry.expires <= now) cache.delete(key);
  }
  // 비정상적으로 커지면 오래된 것부터 제거 (삽입 순서 = 오래된 순)
  while (cache.size > CRAWLER_CONFIG.CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * 검색어와 페이지 수로 상품을 수집한다.
 * 같은 (query, pages) 요청은 TTL 동안 캐시되고, 진행 중인 요청은 병합된다.
 */
export async function collectShoppingItems(query: string, pages: number): Promise<CollectResult> {
  const now = Date.now();
  pruneCache(now);

  const key = `${query} ${Math.max(1, Math.min(pages, SOURCE_MAX_PAGES))}`;
  const existing = cache.get(key);
  if (existing && existing.expires > now) {
    return existing.promise;
  }

  const promise = collectOnce(query, pages);
  cache.set(key, { expires: now + CRAWLER_CONFIG.CACHE_TTL_MS, promise });
  // 실패한 수집은 캐시에 남기지 않는다
  promise.catch(() => {
    if (cache.get(key)?.promise === promise) cache.delete(key);
  });
  return promise;
}

/** 소스가 지원하는 최대 페이지 수 (실측 한도) */
export { SOURCE_MAX_PAGES };
