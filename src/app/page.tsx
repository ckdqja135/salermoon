"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Image from "next/image";

// ==================== 타입 정의 ====================
interface Item {
  title: string;
  titleText: string;
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
}

interface PriceGroup {
  price: number;
  count: number;
  items: Item[];
  representative: Item;
}

interface PriceBandSummary {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
}

type RelaxationStep =
  | "dropFilterNoise"
  | "dropExclude"
  | "reducePages";

interface AppliedFilters {
  minPrice: number | null;
  maxPrice: number | null;
  filterNoise: boolean;
  exclude: string[] | null;
  excludeKeywordsEnabled: boolean;
  pages: number;
}

interface SearchFilters {
  minPrice: number | null;
  maxPrice: number | null;
  sort: string;
  exclude: string[] | null;
  pages: number;
  filterNoise: boolean;
}

interface SearchResult {
  query: string;
  filters: SearchFilters;
  top1: Item | null;
  top10Groups: PriceGroup[];
  priceBand: PriceBandSummary | null;
  totalCandidates: number;
  totalFromApi: number;
  filterRelaxed: boolean;
  appliedRelaxation: RelaxationStep[];
  appliedFilters: AppliedFilters;
  excludedByKeywordsCount: number;
  allItems: Item[];
}

interface TargetPriceComparison {
  targetPrice: number;
  lowestPrice: number;
  difference: number;
  differencePercent: number;
  status: "higher" | "lower" | "equal";
  statusText: string;
}

type LoadingState = "idle" | "loading" | "success" | "error";
type ViewMode = "list" | "grid";
type SortOption = "sim" | "date" | "asc" | "dsc";

// ==================== 상수 ====================
const UI_CONFIG = {
  DEFAULT_PAGES: 3,
  MAX_PAGES: 10,
} as const;

const API_CONFIG = {
  DAILY_LIMIT: 25000,
  CALLS_PER_SEARCH: 3, // 기본 페이지 수
} as const;

const DISPLAY_COUNT_OPTIONS = [10, 20, 30, 50, 100] as const;
const DEFAULT_DISPLAY_COUNT = 20;

const EXCLUDE_OPTIONS = [
  { value: "used", label: "중고" },
  { value: "rental", label: "렌탈" },
  { value: "cbshop", label: "해외직구/구매대행" },
] as const;

const SORT_OPTIONS = [
  { value: "sim", label: "정확도순" },
  { value: "date", label: "최신순" },
  { value: "asc", label: "가격낮은순" },
  { value: "dsc", label: "가격높은순" },
] as const;

const RELAXATION_STEP_LABELS: Record<RelaxationStep, string> = {
  dropFilterNoise: "노이즈 필터 해제",
  dropExclude: "제외 옵션 해제 (중고/렌탈/해외직구 포함)",
  reducePages: "검색 범위 축소",
};

// ==================== 유틸리티 함수 ====================
function formatPrice(num: number): string {
  return num.toLocaleString("ko-KR");
}

function parsePrice(value: string): number {
  const num = parseInt(value.replace(/[^\d]/g, ""), 10);
  return isNaN(num) ? 0 : num;
}

function calculateComparison(targetPrice: number, lowestPrice: number): TargetPriceComparison {
  const difference = targetPrice - lowestPrice;
  const differencePercent = lowestPrice > 0 ? (difference / lowestPrice) * 100 : 0;

  let status: "higher" | "lower" | "equal";
  let statusText: string;

  if (difference > 0) {
    status = "higher";
    statusText = "목표가가 최저가보다 높습니다";
  } else if (difference < 0) {
    status = "lower";
    statusText = "목표가가 최저가보다 낮습니다";
  } else {
    status = "equal";
    statusText = "목표가와 최저가가 동일합니다";
  }

  return {
    targetPrice,
    lowestPrice,
    difference,
    differencePercent,
    status,
    statusText,
  };
}

/** IQR 기반 이상치 필터 (클라이언트) */
function filterOutliers(items: Item[]): Item[] {
  if (items.length < 5) return items;
  
  const prices = items.map(item => item.lprice).sort((a, b) => a - b);
  const n = prices.length;
  const q1 = prices[Math.floor(n * 0.25)];
  const q3 = prices[Math.floor(n * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = Math.max(0, q1 - 2 * iqr);
  const upperBound = q3 + 2 * iqr;

  return items.filter(item => item.lprice >= lowerBound && item.lprice <= upperBound);
}

/** CSV 다운로드 */
function downloadCSV(items: Item[], filename: string) {
  const BOM = "\uFEFF";
  const headers = ["상품명", "판매처", "최저가", "링크"];
  const rows = items.map(item => [
    `"${item.titleText.replace(/"/g, '""')}"`,
    `"${item.mallName.replace(/"/g, '""')}"`,
    item.lprice,
    `"${item.link}"`,
  ]);
  
  const csvContent = BOM + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ==================== 컴포넌트 ====================

/** 가격 입력 (숫자만) */
function PriceInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  placeholder: string;
}) {
  const [inputValue, setInputValue] = useState(value > 0 ? formatPrice(value) : "");

  useEffect(() => {
    setInputValue(value > 0 ? formatPrice(value) : "");
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setInputValue(raw);
  };

  const handleInputBlur = () => {
    const parsed = parsePrice(inputValue);
    onChange(parsed);
    setInputValue(parsed > 0 ? formatPrice(parsed) : "");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  return (
    <div className="flex items-center gap-3">
      <label className="text-sm font-medium whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="price-input"
        />
        <span className="text-sm text-[var(--color-text-secondary)]">원</span>
      </div>
    </div>
  );
}

/** 제외 옵션 체크박스 */
function ExcludeOptions({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (selected: string[]) => void;
}) {
  const handleToggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">제외 옵션</label>
      <div className="flex flex-wrap gap-4">
        {EXCLUDE_OPTIONS.map((option) => (
          <label key={option.value} className="checkbox-wrapper">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => handleToggle(option.value)}
            />
            <span className="text-sm">{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** 페이지 수 선택 */
function PagesSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">검색 범위</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field"
      >
        {Array.from({ length: UI_CONFIG.MAX_PAGES }, (_, i) => i + 1).map(
          (num) => (
            <option key={num} value={num}>
              {num}페이지 ({num * 100}개)
            </option>
          )
        )}
      </select>
    </div>
  );
}

/** 토글 스위치 */
function ToggleSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`toggle-switch ${checked ? "active" : ""}`}
      />
      <span className="text-sm font-medium">{label}</span>
    </label>
  );
}

/** 상품 이미지 */
function ProductImage({ src, alt, size = "md" }: { src?: string; alt: string; size?: "sm" | "md" | "lg" | "xs" }) {
  const [hasError, setHasError] = useState(false);
  const sizeClass = size === "xs" ? "w-10 h-10" : size === "sm" ? "w-12 h-12" : size === "lg" ? "w-full" : "w-16 h-16";

  if (!src || hasError) {
    return (
      <div className={`${sizeClass} flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg flex-shrink-0`}>
        <span className={size === "lg" ? "text-4xl" : size === "xs" ? "text-lg" : "text-2xl"}>📦</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size === "lg" ? 200 : size === "md" ? 64 : size === "xs" ? 40 : 48}
      height={size === "lg" ? 200 : size === "md" ? 64 : size === "xs" ? 40 : 48}
      className={`${sizeClass} object-cover rounded-lg flex-shrink-0`}
      onError={() => setHasError(true)}
      unoptimized
    />
  );
}

/** Top1 카드 */
function Top1Card({ item }: { item: Item }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="card top1-card p-5 block fade-in"
    >
      <div className="flex flex-col md:flex-row gap-5">
        <div className="w-full md:w-40 flex-shrink-0">
          <ProductImage src={item.image} alt={item.titleText} size="lg" />
        </div>
        <div className="flex-1 space-y-2">
          <div>
            <h3
              className="text-base font-bold line-clamp-2"
              dangerouslySetInnerHTML={{ __html: item.title }}
            />
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {item.mallName}
              {item.brand && <span className="ml-2">| {item.brand}</span>}
            </p>
          </div>
          <div>
            <span className="price text-2xl">{formatPrice(item.lprice)}</span>
            <span className="text-base ml-1">원</span>
          </div>
        </div>
      </div>
    </a>
  );
}

/** 가격 밴드 요약 (컴팩트) */
function PriceBandSummaryCard({ band }: { band: PriceBandSummary }) {
  return (
    <div className="price-band-compact">
      <div className="price-band-item-compact">
        <span className="price-band-label-compact">최저</span>
        <span className="price-band-value-compact">{formatPrice(band.minPrice)}원</span>
      </div>
      <div className="price-band-item-compact">
        <span className="price-band-label-compact">최고</span>
        <span className="price-band-value-compact">{formatPrice(band.maxPrice)}원</span>
      </div>
      <div className="price-band-item-compact">
        <span className="price-band-label-compact">평균</span>
        <span className="price-band-value-compact">{formatPrice(band.avgPrice)}원</span>
      </div>
      <div className="price-band-item-compact">
        <span className="price-band-label-compact">중앙</span>
        <span className="price-band-value-compact">{formatPrice(band.medianPrice)}원</span>
      </div>
    </div>
  );
}

/** 목표가 비교 결과 (컴팩트) */
function TargetPriceComparisonCard({ comparison }: { comparison: TargetPriceComparison }) {
  const statusEmoji = comparison.status === "higher" ? "⚠️" : comparison.status === "lower" ? "✅" : "📍";
  const diffSign = comparison.difference > 0 ? "+" : "";

  return (
    <div className="comparison-card-compact">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-[var(--color-text-secondary)]">목표가</div>
          <div className="text-lg font-bold">{formatPrice(comparison.targetPrice)}원</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-[var(--color-text-secondary)]">차이</div>
          <div className="font-bold">
            {diffSign}{formatPrice(comparison.difference)}원
          </div>
        </div>
      </div>
      <div className={`comparison-status-compact ${comparison.status}`}>
        <span>{statusEmoji}</span>
        <span className="text-xs">{comparison.statusText}</span>
      </div>
    </div>
  );
}

/** 완화 단계 알림 배너 */
function RelaxationBanner({
  appliedRelaxation,
  appliedFilters,
}: {
  appliedRelaxation: RelaxationStep[];
  appliedFilters: AppliedFilters;
}) {
  if (appliedRelaxation.length === 0) return null;

  return (
    <div className="warning-banner flex-col !items-start gap-2">
      <div className="flex items-center gap-2">
        <span>ℹ️</span>
        <span className="font-medium">
          검색 결과를 찾기 위해 필터가 자동 완화되었습니다
        </span>
      </div>
      <div className="ml-6 text-sm space-y-1">
        <div className="font-medium text-[var(--color-text-secondary)]">적용된 완화 단계:</div>
        <ul className="list-disc list-inside space-y-0.5">
          {appliedRelaxation.map((step) => (
            <li key={step}>{RELAXATION_STEP_LABELS[step]}</li>
          ))}
        </ul>
      </div>
      <div className="ml-6 mt-2 text-xs text-[var(--color-text-secondary)] space-y-1">
        <div>
          <span className="font-medium">최종 적용 필터: </span>
          최소가 {appliedFilters.minPrice !== null ? `${formatPrice(appliedFilters.minPrice)}원` : "없음"} /
          최대가 {appliedFilters.maxPrice !== null ? `${formatPrice(appliedFilters.maxPrice)}원` : "없음"} /
          노이즈필터 {appliedFilters.filterNoise ? "ON" : "OFF"}
        </div>
        <div>
          제외옵션 {appliedFilters.exclude !== null && appliedFilters.exclude.length > 0
            ? appliedFilters.exclude.join(", ")
            : "없음"} /
          키워드필터 {appliedFilters.excludeKeywordsEnabled ? "활성화" : "비활성화"}
        </div>
      </div>
    </div>
  );
}

/** Top10 사이드바 아이템 (컴팩트) */
function Top10SidebarItem({
  group,
  rank,
  onGroupClick,
}: {
  group: PriceGroup;
  rank: number;
  onGroupClick: (group: PriceGroup) => void;
}) {
  const isMulti = group.count > 1;
  const item = group.representative;

  const handleClick = (e: React.MouseEvent) => {
    if (isMulti) {
      e.preventDefault();
      onGroupClick(group);
    }
  };

  const content = (
    <div className="flex items-center gap-2">
      <span className={`rank-badge-xs ${rank <= 3 ? "top3" : ""}`}>{rank}</span>
      <ProductImage src={item.image} alt={item.titleText} size="xs" />
      <div className="flex-1 min-w-0">
        <p
          className="text-xs font-medium line-clamp-1"
          dangerouslySetInnerHTML={{ __html: item.title }}
        />
        <p className="text-xs text-[var(--color-text-secondary)]">
          {item.mallName}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-sm font-bold text-[var(--color-primary)]">
          {formatPrice(group.price)}
        </div>
        {isMulti && <span className="text-xs text-[var(--color-accent-dark)]">{group.count}건</span>}
      </div>
    </div>
  );

  if (isMulti) {
    return (
      <button
        onClick={handleClick}
        className="sidebar-item multi w-full text-left"
      >
        {content}
      </button>
    );
  }

  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="sidebar-item"
    >
      {content}
    </a>
  );
}

/** 가격 그룹 모달 */
function PriceGroupModal({
  group,
  onClose,
}: {
  group: PriceGroup;
  onClose: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content" ref={modalRef}>
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-bold">
              {formatPrice(group.price)}원 상품
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)]">
              총 {group.count}개 상품
            </p>
          </div>
          <button className="modal-close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="modal-body space-y-2">
          {group.items.map((item, index) => (
            <a
              key={item.link + index}
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              className="modal-item"
            >
              <ProductImage src={item.image} alt={item.titleText} size="sm" />
              <div className="flex-1 min-w-0">
                <h4
                  className="text-sm font-medium line-clamp-2"
                  dangerouslySetInnerHTML={{ __html: item.title }}
                />
                <p className="text-xs text-[var(--color-text-secondary)] mt-1">
                  {item.mallName}
                  {item.brand && <span className="ml-2">| {item.brand}</span>}
                </p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 리스트 뷰 아이템 */
function ListViewItem({ item, index }: { item: Item; index: number }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="list-item"
    >
      <span className="rank-badge-small">{index + 1}</span>
      <ProductImage src={item.image} alt={item.titleText} size="sm" />
      <div className="flex-1 min-w-0">
        <h4
          className="text-sm font-medium line-clamp-1"
          dangerouslySetInnerHTML={{ __html: item.title }}
        />
        <p className="text-xs text-[var(--color-text-secondary)] mt-0.5">
          {item.mallName}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <span className="price">{formatPrice(item.lprice)}</span>
        <span className="text-sm">원</span>
      </div>
    </a>
  );
}

/** 그리드 뷰 아이템 */
function GridViewItem({ item }: { item: Item }) {
  return (
    <a
      href={item.link}
      target="_blank"
      rel="noopener noreferrer"
      className="grid-item"
    >
      <div className="grid-item-image">
        <ProductImage src={item.image} alt={item.titleText} size="lg" />
      </div>
      <div className="p-3">
        <h4
          className="text-sm font-medium line-clamp-2 mb-1"
          dangerouslySetInnerHTML={{ __html: item.title }}
        />
        <p className="text-xs text-[var(--color-text-secondary)] mb-2 line-clamp-1">
          {item.mallName}
        </p>
        <div className="text-right">
          <span className="price">{formatPrice(item.lprice)}</span>
          <span className="text-sm">원</span>
        </div>
      </div>
    </a>
  );
}

/** 마켓 필터 (인라인 버전) */
function MallFilterInline({
  allMalls,
  selectedMalls,
  onChange,
}: {
  allMalls: string[];
  selectedMalls: string[];
  onChange: (malls: string[]) => void;
}) {
  if (allMalls.length === 0) return null;

  const handleToggle = (mall: string) => {
    if (selectedMalls.includes(mall)) {
      onChange(selectedMalls.filter((m) => m !== mall));
    } else {
      onChange([...selectedMalls, mall]);
    }
  };

  const handleSelectAll = () => {
    onChange(allMalls);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  return (
    <div className="mall-filter-inline">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <label className="text-sm font-medium">마켓:</label>
        <button
          type="button"
          onClick={handleSelectAll}
          className="text-xs text-[var(--color-primary)] hover:underline"
        >
          전체선택
        </button>
        <span className="text-xs text-[var(--color-text-secondary)]">|</span>
        <button
          type="button"
          onClick={handleClearAll}
          className="text-xs text-[var(--color-text-secondary)] hover:underline"
        >
          초기화
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 max-h-20 overflow-y-auto">
        {allMalls.map((mall) => (
          <button
            key={mall}
            type="button"
            onClick={() => handleToggle(mall)}
            className={`mall-tag ${selectedMalls.includes(mall) ? "active" : ""}`}
          >
            {mall}
          </button>
        ))}
      </div>
    </div>
  );
}

/** 뷰 모드 토글 */
function ViewModeToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="view-mode-toggle">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`view-mode-btn ${viewMode === "list" ? "active" : ""}`}
        title="리스트 뷰"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6"></line>
          <line x1="3" y1="12" x2="21" y2="12"></line>
          <line x1="3" y1="18" x2="21" y2="18"></line>
        </svg>
      </button>
      <button
        type="button"
        onClick={() => onChange("grid")}
        className={`view-mode-btn ${viewMode === "grid" ? "active" : ""}`}
        title="그리드 뷰"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
        </svg>
      </button>
    </div>
  );
}

/** 로딩 상태 */
function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <div className="spinner" />
      <p className="text-[var(--color-text-secondary)]">
        최저가 상품을 찾고 있어요...
      </p>
    </div>
  );
}

/** 에러 상태 */
function ErrorState({ message }: { message: string }) {
  return (
    <div className="card-static p-8 text-center">
      <div className="text-5xl mb-4">😢</div>
      <h3 className="text-lg font-bold mb-2">검색 중 오류가 발생했어요</h3>
      <p className="text-[var(--color-text-secondary)]">{message}</p>
    </div>
  );
}

/** 빈 결과 상태 */
function EmptyState() {
  return (
    <div className="card-static p-8 text-center">
      <div className="text-5xl mb-4">🔍</div>
      <h3 className="text-lg font-bold mb-2">검색 결과가 없어요</h3>
      <p className="text-[var(--color-text-secondary)]">
        모든 필터를 완화해도 결과가 없습니다.<br />
        다른 검색어를 시도해보세요.
      </p>
    </div>
  );
}

/** 초기 상태 안내 */
function IdleState() {
  return (
    <div className="card-static p-12 text-center">
      <div className="text-6xl mb-6">🛒💰</div>
      <h2 className="text-2xl font-bold mb-3">네이버 쇼핑 최저가 검색</h2>
      <p className="text-[var(--color-text-secondary)] max-w-md mx-auto mb-6">
        검색어를 입력하고 검색 버튼을 눌러주세요!<br />
        프로모션 가격 설계를 위한 시장 최저가를 확인할 수 있습니다.
      </p>
      <div className="info-banner max-w-md mx-auto">
        <span>💡</span>
        <span>목표가를 입력하면 최저가와 비교 분석을 제공합니다</span>
      </div>
    </div>
  );
}

/** API 정보 패널 */
function ApiInfoPanel({ searchCount }: { searchCount: number }) {
  const estimatedCalls = searchCount * API_CONFIG.CALLS_PER_SEARCH;
  const remaining = Math.max(0, API_CONFIG.DAILY_LIMIT - estimatedCalls);
  const percentage = Math.round((remaining / API_CONFIG.DAILY_LIMIT) * 100);

  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="text-sm">⚡</span>
        <span className="text-xs font-semibold">API 상태</span>
      </div>
      <div className="info-panel-content">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-[var(--color-text-secondary)]">일일 한도</span>
          <span className="font-medium">{formatPrice(API_CONFIG.DAILY_LIMIT)}회</span>
        </div>
        <div className="flex justify-between text-xs mb-2">
          <span className="text-[var(--color-text-secondary)]">잔여 (추정)</span>
          <span className="font-medium text-[var(--color-success)]">~{formatPrice(remaining)}회</span>
        </div>
        <div className="progress-bar">
          <div 
            className="progress-fill" 
            style={{ width: `${percentage}%` }}
          />
        </div>
        <p className="text-xs text-[var(--color-text-secondary)] mt-2">
          검색당 약 {API_CONFIG.CALLS_PER_SEARCH}회 호출
        </p>
      </div>
    </div>
  );
}

/** 검색 요약 패널 */
function SearchSummaryPanel({ 
  result, 
  appliedFilters 
}: { 
  result: SearchResult; 
  appliedFilters: AppliedFilters;
}) {
  return (
    <div className="info-panel">
      <div className="info-panel-header">
        <span className="text-sm">📊</span>
        <span className="text-xs font-semibold">검색 요약</span>
      </div>
      <div className="info-panel-content">
        <div className="text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-[var(--color-text-secondary)]">검색어</span>
            <span className="font-medium truncate ml-2">{result.query}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-secondary)]">API 결과</span>
            <span className="font-medium">{formatPrice(result.totalFromApi)}개</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--color-text-secondary)]">필터 후</span>
            <span className="font-medium text-[var(--color-primary)]">{formatPrice(result.totalCandidates)}개</span>
          </div>
          {result.excludedByKeywordsCount > 0 && (
            <div className="flex justify-between">
              <span className="text-[var(--color-text-secondary)]">키워드 제외</span>
              <span className="font-medium">{formatPrice(result.excludedByKeywordsCount)}개</span>
            </div>
          )}
        </div>
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
            <div>
              범위: {appliedFilters.pages}페이지
            </div>
            <div>
              노이즈필터: {appliedFilters.filterNoise ? "ON" : "OFF"}
            </div>
            <div>
              제외: {appliedFilters.exclude?.join(", ") || "없음"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top10 사이드바 */
function Top10Sidebar({
  groups,
  priceBand,
  onGroupClick,
}: {
  groups: PriceGroup[];
  priceBand: PriceBandSummary | null;
  onGroupClick: (group: PriceGroup) => void;
}) {
  if (groups.length === 0) return null;

  return (
    <div className="sidebar-card">
      <div className="sidebar-header">
        <span className="text-base">📋</span>
        <span className="text-sm font-bold">TOP 10 가격대</span>
      </div>
      
      {priceBand && (
        <div className="px-3 pb-2">
          <PriceBandSummaryCard band={priceBand} />
        </div>
      )}
      
      <div className="sidebar-list">
        {groups.map((group, index) => (
          <Top10SidebarItem
            key={group.price + "-" + index}
            group={group}
            rank={index + 1}
            onGroupClick={onGroupClick}
          />
        ))}
      </div>
      <div className="px-3 pb-3 text-xs text-center text-[var(--color-text-secondary)]">
        클릭하여 상세 보기
      </div>
    </div>
  );
}

/** 상단 검색 결과 헤더 (필터 바) */
function ResultsHeader({
  viewMode,
  displayCount,
  excludeOutliers,
  selectedMalls,
  clientSort,
  processedItemsCount,
  displayedItemsCount,
  allMalls,
  onViewModeChange,
  onDisplayCountChange,
  onExcludeOutliersChange,
  onSelectedMallsChange,
  onClientSortChange,
  onDownloadCSV,
}: {
  viewMode: ViewMode;
  displayCount: number;
  excludeOutliers: boolean;
  selectedMalls: string[];
  clientSort: SortOption;
  processedItemsCount: number;
  displayedItemsCount: number;
  allMalls: string[];
  onViewModeChange: (mode: ViewMode) => void;
  onDisplayCountChange: (count: number) => void;
  onExcludeOutliersChange: (value: boolean) => void;
  onSelectedMallsChange: (malls: string[]) => void;
  onClientSortChange: (sort: SortOption) => void;
  onDownloadCSV: () => void;
}) {
  return (
    <div className="results-header-bar">
      {/* 상단 행: 제목 + 액션 버튼 */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-bold flex items-center gap-2">
            <span className="text-lg">📦</span>
            전체 상품
          </h2>
          <span className="text-xs text-[var(--color-text-secondary)]">
            ({formatPrice(processedItemsCount)}개 중 {formatPrice(displayedItemsCount)}개)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onDownloadCSV}
            className="btn-icon"
            title="CSV 다운로드"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        </div>
      </div>

      {/* 필터 행 */}
      <div className="flex flex-wrap items-center gap-3 mt-3">
        {/* 정렬 */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium">정렬:</label>
          <select
            value={clientSort}
            onChange={(e) => onClientSortChange(e.target.value as SortOption)}
            className="input-field-xs"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* 표시 개수 */}
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium">표시:</label>
          <select
            value={displayCount}
            onChange={(e) => onDisplayCountChange(Number(e.target.value))}
            className="input-field-xs"
          >
            {DISPLAY_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>
                {count}개
              </option>
            ))}
          </select>
        </div>

        {/* 이상치 제외 */}
        <ToggleSwitch
          checked={excludeOutliers}
          onChange={onExcludeOutliersChange}
          label="이상치 제외"
        />
      </div>

      {/* 마켓 필터 */}
      {allMalls.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--color-border)]">
          <MallFilterInline
            allMalls={allMalls}
            selectedMalls={selectedMalls}
            onChange={onSelectedMallsChange}
          />
        </div>
      )}
    </div>
  );
}

/** 상품 리스트/그리드 영역 */
function ProductListArea({
  items,
  viewMode,
}: {
  items: Item[];
  viewMode: ViewMode;
}) {
  if (items.length === 0) {
    return (
      <div className="text-center py-8 text-[var(--color-text-secondary)]">
        필터 조건에 맞는 상품이 없습니다.
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="space-y-2">
        {items.map((item, index) => (
          <ListViewItem key={item.link + index} item={item} index={index} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid-container">
      {items.map((item, index) => (
        <GridViewItem key={item.link + index} item={item} />
      ))}
    </div>
  );
}

// ==================== 메인 페이지 ====================
export default function Home() {
  // 검색 상태
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [exclude, setExclude] = useState<string[]>(["used", "rental", "cbshop"]);
  const [pages, setPages] = useState<number>(UI_CONFIG.DEFAULT_PAGES);
  const [filterNoise, setFilterNoise] = useState(false);

  // 목표가 입력
  const [targetPrice, setTargetPrice] = useState<number>(0);

  // 결과 상태
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [searchCount, setSearchCount] = useState(0);

  // 결과 필터/뷰 상태
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [displayCount, setDisplayCount] = useState<number>(DEFAULT_DISPLAY_COUNT);
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [selectedMalls, setSelectedMalls] = useState<string[]>([]);
  const [clientSort, setClientSort] = useState<SortOption>("asc");
  const [selectedGroup, setSelectedGroup] = useState<PriceGroup | null>(null);

  // 전체 몰 목록 추출
  const allMalls = useMemo(() => {
    if (!result) return [];
    const mallSet = new Set(result.allItems.map((item) => item.mallName).filter(Boolean));
    return Array.from(mallSet).sort();
  }, [result]);

  // 클라이언트 필터링 및 정렬
  const processedItems = useMemo(() => {
    if (!result) return [];
    let items = [...result.allItems];

    if (selectedMalls.length > 0) {
      items = items.filter((item) => selectedMalls.includes(item.mallName));
    }

    if (excludeOutliers) {
      items = filterOutliers(items);
    }

    switch (clientSort) {
      case "asc":
        items.sort((a, b) => a.lprice - b.lprice);
        break;
      case "dsc":
        items.sort((a, b) => b.lprice - a.lprice);
        break;
      default:
        break;
    }

    return items;
  }, [result, selectedMalls, excludeOutliers, clientSort]);

  const displayedItems = processedItems.slice(0, displayCount);

  // 필터된 결과 기반 Top1/Top10 재계산
  const { effectiveTop1, effectiveTop10Groups, effectivePriceBand } = useMemo(() => {
    if (!result) {
      return { effectiveTop1: null, effectiveTop10Groups: [], effectivePriceBand: null };
    }

    if (selectedMalls.length === 0 && !excludeOutliers) {
      return {
        effectiveTop1: result.top1,
        effectiveTop10Groups: result.top10Groups,
        effectivePriceBand: result.priceBand,
      };
    }

    let filteredItems = result.allItems;
    if (selectedMalls.length > 0) {
      filteredItems = filteredItems.filter((item) => selectedMalls.includes(item.mallName));
    }
    if (excludeOutliers) {
      filteredItems = filterOutliers(filteredItems);
    }

    const sorted = [...filteredItems].sort((a, b) => a.lprice - b.lprice);
    const top1 = sorted.length > 0 ? sorted[0] : null;

    const groupMap = new Map<number, Item[]>();
    for (const item of sorted) {
      const existing = groupMap.get(item.lprice) || [];
      if (existing.length < 20) {
        existing.push(item);
        groupMap.set(item.lprice, existing);
      }
    }

    const groups = Array.from(groupMap.entries())
      .sort((a, b) => a[0] - b[0])
      .slice(0, 10)
      .map(([price, groupItems]) => ({
        price,
        count: groupItems.length,
        items: groupItems,
        representative: groupItems[0],
      }));

    let priceBand: PriceBandSummary | null = null;
    if (groups.length > 0) {
      const prices = groups.map((g) => g.price);
      const totalItems = groups.reduce((sum, g) => sum + g.count, 0);
      const weightedSum = groups.reduce((sum, g) => sum + g.price * g.count, 0);
      const allPrices: number[] = [];
      for (const group of groups) {
        for (let i = 0; i < group.count; i++) {
          allPrices.push(group.price);
        }
      }
      allPrices.sort((a, b) => a - b);
      const mid = Math.floor(allPrices.length / 2);
      priceBand = {
        minPrice: Math.min(...prices),
        maxPrice: Math.max(...prices),
        avgPrice: Math.round(weightedSum / totalItems),
        medianPrice: allPrices.length % 2 === 0
          ? Math.round((allPrices[mid - 1] + allPrices[mid]) / 2)
          : allPrices[mid],
      };
    }

    return {
      effectiveTop1: top1,
      effectiveTop10Groups: groups,
      effectivePriceBand: priceBand,
    };
  }, [result, selectedMalls, excludeOutliers]);

  const comparison = useMemo(() => {
    if (targetPrice > 0 && effectiveTop1) {
      return calculateComparison(targetPrice, effectiveTop1.lprice);
    }
    return null;
  }, [targetPrice, effectiveTop1]);

  const handleDownloadCSV = useCallback(() => {
    if (!result) return;
    const items = processedItems.slice(0, displayCount);
    const date = new Date().toISOString().slice(0, 10);
    downloadCSV(items, `salermoon_${result.query}_${date}.csv`);
  }, [processedItems, displayCount, result]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setErrorMessage("검색어를 입력해주세요");
      setLoadingState("error");
      return;
    }

    setLoadingState("loading");
    setErrorMessage("");
    setSelectedMalls([]);
    setExcludeOutliers(false);

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        pages: String(pages),
        filterNoise: String(filterNoise),
      });

      if (minPrice > 0) params.set("minPrice", String(minPrice));
      if (maxPrice > 0) params.set("maxPrice", String(maxPrice));
      if (exclude.length > 0) params.set("exclude", exclude.join(":"));

      const response = await fetch(`/api/lowest?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "검색에 실패했습니다");
      }

      setResult(data);
      setLoadingState("success");
      setSearchCount((prev) => prev + 1);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다"
      );
      setLoadingState("error");
    }
  }, [query, minPrice, maxPrice, exclude, pages, filterNoise]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      handleSearch();
    }
  };

  const hasResults = loadingState === "success" && result && result.totalCandidates > 0;

  return (
    <main className="min-h-screen bg-pattern">
      <div className="max-w-screen-2xl mx-auto px-3 md:px-6 py-4 md:py-8">
        {/* 헤더 */}
        <header className="text-center mb-5">
          <h1 className="text-2xl md:text-3xl font-black mb-1">
            <span className="bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-secondary)] to-[var(--color-accent)] bg-clip-text text-transparent">
              🌙 세일러문
            </span>
          </h1>
          <p className="text-sm text-[var(--color-text-secondary)]">
            프로모션 가격 설계를 위한 시장 최저가 검색
          </p>
        </header>

        {/* 검색 폼 */}
        <div className="card-static p-4 md:p-5 mb-4 space-y-4">
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색어를 입력하세요 (예: 바나나, 아이폰)"
              className="input-field flex-1"
              disabled={loadingState === "loading"}
            />
            <button
              onClick={handleSearch}
              disabled={loadingState === "loading"}
              className="btn-primary whitespace-nowrap"
            >
              {loadingState === "loading" ? "검색 중..." : "검색"}
            </button>
          </div>

          <div className="grid md:grid-cols-3 gap-4 items-end">
            <PriceInput label="최소 가격" value={minPrice} onChange={setMinPrice} placeholder="미입력시 제한없음" />
            <PriceInput label="최대 가격" value={maxPrice} onChange={setMaxPrice} placeholder="미입력시 제한없음" />
            <PriceInput label="목표가" value={targetPrice} onChange={setTargetPrice} placeholder="행사가/납품가" />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <ExcludeOptions selected={exclude} onChange={setExclude} />
            <PagesSelect value={pages} onChange={setPages} />
          </div>

          <div className="pt-2 border-t border-[var(--color-border)]">
            <ToggleSwitch checked={filterNoise} onChange={setFilterNoise} label="노이즈 키워드 제외" />
          </div>
        </div>

        {/* 결과 영역 - 2열 레이아웃 */}
        {loadingState === "idle" && <IdleState />}
        {loadingState === "loading" && <LoadingState />}
        {loadingState === "error" && <ErrorState message={errorMessage} />}
        {loadingState === "success" && result && result.totalCandidates === 0 && <EmptyState />}

        {hasResults && (
          <div className="main-layout">
            {/* 좌측: 메인 컨텐츠 */}
            <div className="main-content">
              {/* 필터 완화 알림 */}
              {result.filterRelaxed && (
                <RelaxationBanner
                  appliedRelaxation={result.appliedRelaxation}
                  appliedFilters={result.appliedFilters}
                />
              )}

              {/* 목표가 비교 */}
              {comparison && (
                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    목표가 비교
                  </h2>
                  <TargetPriceComparisonCard comparison={comparison} />
                </section>
              )}

              {/* Top1 */}
              {effectiveTop1 && (
                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <span className="text-xl">🏆</span>
                    최저가 상품
                  </h2>
                  <Top1Card item={effectiveTop1} />
                </section>
              )}

              {/* 필터 헤더 */}
              <ResultsHeader
                viewMode={viewMode}
                displayCount={displayCount}
                excludeOutliers={excludeOutliers}
                selectedMalls={selectedMalls}
                clientSort={clientSort}
                processedItemsCount={processedItems.length}
                displayedItemsCount={displayedItems.length}
                allMalls={allMalls}
                onViewModeChange={setViewMode}
                onDisplayCountChange={setDisplayCount}
                onExcludeOutliersChange={setExcludeOutliers}
                onSelectedMallsChange={setSelectedMalls}
                onClientSortChange={setClientSort}
                onDownloadCSV={handleDownloadCSV}
              />

              {/* 상품 리스트/그리드 */}
              <section className="mt-4">
                <ProductListArea items={displayedItems} viewMode={viewMode} />
                
                {displayedItems.length < processedItems.length && (
                  <div className="text-center text-sm text-[var(--color-text-secondary)] mt-4">
                    {processedItems.length - displayedItems.length}개 상품이 더 있습니다.
                  </div>
                )}
              </section>
            </div>

            {/* 우측: 사이드바 */}
            <aside className="sidebar">
              {/* Top10 */}
              <Top10Sidebar
                groups={effectiveTop10Groups}
                priceBand={effectivePriceBand}
                onGroupClick={setSelectedGroup}
              />

              {/* 검색 요약 */}
              <SearchSummaryPanel 
                result={result} 
                appliedFilters={result.appliedFilters} 
              />

              {/* API 정보 */}
              <ApiInfoPanel searchCount={searchCount} />
            </aside>
          </div>
        )}

        {/* 가격 그룹 모달 */}
        {selectedGroup && (
          <PriceGroupModal
            group={selectedGroup}
            onClose={() => setSelectedGroup(null)}
          />
        )}

        {/* 푸터 */}
        <footer className="text-center mt-10 text-xs text-[var(--color-text-secondary)]">
          <p>
            <a
              href="https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[var(--color-primary)]"
            >
              네이버 쇼핑 API
            </a>
            를 활용한 최저가 검색 서비스
          </p>
        </footer>
      </div>
    </main>
  );
}
