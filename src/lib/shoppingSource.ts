/**
 * 네이버 통합검색 기반 상품 수집 (Gateway 레이어)
 *
 * 종료된 네이버 쇼핑 오픈 API를 대체한다. API 키가 필요 없다.
 * 검증 기록: docs/crawling-feasibility.md, 재현: npm run check:shopping-source -- "검색어" --deep
 *
 * 수집 경로 (2026-09-13 검증):
 * 1. https://search.naver.com/search.naver?where=shopping&query=... HTML의
 *    쇼핑 초기 상태(_INITIAL_STATE)를 acorn으로 정적 해석 (1페이지 카드 + 세션 파라미터)
 * 2. pages > 1이면 공개 클라이언트와 동일한
 *    https://ns-portal.shopping.naver.com/api/v2/shopping-paged-slot 요청 1회로
 *    1~N페이지를 누적 수신 (N > 10은 빈 응답 — 실측 한도)
 *
 * 주의: 공식 API 계약이 아닌 웹 화면 내부 요청이므로 형식 변경에 대비해
 * 구조 검증 실패 시 명확한 오류를 던지고, 차단(418/429/로그인)은 별도 오류로 구분한다.
 */

import {
  parseShoppingState,
  cardsFromPages,
  pagesFromPagedResponse,
  pagingRequest,
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

async function fetchPagedCards(
  state: ShoppingState,
  page: number
): Promise<{ cards: SourceCard[]; pagesReturned: number[] } | { warning: string }> {
  const { url, headers } = pagingRequest(state, page);
  let res: { status: number; finalHost: string; body: string; ok: boolean };
  try {
    res = await fetchText(url, {
      headers,
      timeoutMs: CRAWLER_CONFIG.PAGED_TIMEOUT_MS,
      maxBytes: CRAWLER_CONFIG.MAX_JSON_BYTES,
    });
  } catch (error) {
    return { warning: `페이지 이동 요청 실패(${error instanceof Error ? error.message : String(error)}) — 1페이지 결과만 사용` };
  }
  if (res.status === 418 || res.status === 429) {
    return { warning: `페이지 이동 요청이 제한됨(HTTP ${res.status}) — 1페이지 결과만 사용` };
  }
  if (!res.ok) {
    return { warning: `페이지 이동 응답 오류(HTTP ${res.status}) — 1페이지 결과만 사용` };
  }
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    return { warning: "페이지 이동 응답이 JSON이 아님 — 1페이지 결과만 사용" };
  }
  const pages = pagesFromPagedResponse(json);
  if (!pages) {
    return { warning: "페이지 이동 응답 형식이 변경됨 — 1페이지 결과만 사용" };
  }
  return { cards: cardsFromPages(pages), pagesReturned: pages.map((p) => p.page) };
}

async function collectOnce(query: string, pages: number): Promise<CollectResult> {
  const effectivePages = Math.max(1, Math.min(pages, SOURCE_MAX_PAGES));
  const initial = await fetchInitialState(query);

  if ("empty" in initial) {
    // 쇼핑 검색 결과가 없는 검색어 — 오류가 아닌 빈 결과로 처리
    return buildCollection({
      primaryCards: [],
      pagesRequested: effectivePages,
      pagesReturned: [],
      warnings: ["통합검색에 쇼핑 결과가 없습니다."],
    });
  }

  const { state, firstPageCards } = initial;

  if (effectivePages === 1) {
    return buildCollection({
      primaryCards: firstPageCards,
      pagesRequested: effectivePages,
      pagesReturned: [1],
    });
  }

  const paged = await fetchPagedCards(state, effectivePages);
  if ("warning" in paged) {
    // 추가 페이지 실패는 부분 결과로 처리 (초기 HTML의 1페이지는 확보됨)
    return buildCollection({
      primaryCards: firstPageCards,
      pagesRequested: effectivePages,
      pagesReturned: [1],
      warnings: [paged.warning],
    });
  }

  // 누적 응답(1~N페이지)을 노출 순서의 기준으로 삼고,
  // 광고 로테이션으로 구성이 달라진 초기 HTML의 추가 상품은 뒤에 덧붙인다.
  return buildCollection({
    primaryCards: paged.cards,
    extraCards: firstPageCards,
    pagesRequested: effectivePages,
    pagesReturned: paged.pagesReturned,
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
