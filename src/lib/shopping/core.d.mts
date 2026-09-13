/**
 * core.mjs 타입 선언 (TS 소비자용)
 */

/** 통합검색 쇼핑 카드 (외부 데이터 — 필요한 필드만 선언) */
export interface SourceCard {
  cardType?: string;
  sourceType?: string;
  nvMid?: number | string | null;
  productName?: string;
  productUrl?: { pcUrl?: string; mobileUrl?: string } | null;
  productClickUrl?: { pcUrl?: string; mobileUrl?: string } | null;
  images?: Array<{ imageUrl?: string }> | null;
  mallName?: string;
  mallCount?: number;
  salePrice?: number;
  discountedSalePrice?: number;
  discountedKRWSalePrice?: number;
  isOverseaProduct?: boolean;
  [key: string]: unknown;
}

/** 페이지 이동 응답의 페이지 단위 */
export interface SourcePage {
  page: number;
  slots: Array<{ slotType?: string; data?: unknown }>;
  [key: string]: unknown;
}

/** 통합검색 HTML의 쇼핑 초기 상태 (필요한 필드만 선언) */
export interface ShoppingState {
  initProps: {
    pagedSlot: SourcePage[];
    byPassBFFParams: Record<string, unknown>;
    [key: string]: unknown;
  };
  query: string;
  areaCode?: string;
  pageId?: string;
  sessionId?: string;
  viewType?: string;
  rev?: string;
  nxReferer?: string;
  route?: string;
  device?: { type?: string };
  [key: string]: unknown;
}

/** 기존 NaverShopRawItem 호환 + 수집 확장 필드 */
export interface CrawledRawItem {
  title: string;
  link: string;
  image: string;
  lprice: string;
  hprice: string;
  mallName: string;
  productId: string;
  productType: string;
  brand: string;
  maker: string;
  category1: string;
  category2: string;
  category3: string;
  category4: string;
  sellerCount: number;
  isOversea: boolean;
}

export interface CollectionMeta {
  source: "naver-integrated-search";
  order: "relevance";
  pagesRequested: number;
  pagesCollected: number;
  totalCards: number;
  adCards: number;
  organicCards: number;
  catalogCards: number;
  droppedCards: number;
  warnings: string[];
}

export const SOURCE_MAX_PAGES: number;

export function parseShoppingState(html: string): ShoppingState | null;
export function cardsFromPages(pages: unknown): SourceCard[];
export function pagesFromPagedResponse(json: unknown): SourcePage[] | null;
export function pagingRequest(state: ShoppingState, page: number): { url: URL; headers: Record<string, string> };
export function httpUrl(value: unknown): string | null;
export function sanitizeTitleHtml(name: string): string;
export function mapCardToRawItem(card: SourceCard): CrawledRawItem | null;
export function buildCollection(input: {
  primaryCards: SourceCard[];
  extraCards?: SourceCard[];
  pagesRequested: number;
  pagesReturned: number[];
  warnings?: string[];
}): { items: CrawledRawItem[]; meta: CollectionMeta };
export function detectBlocked(input: { status: number; finalHost: string; html?: string }): string | null;
