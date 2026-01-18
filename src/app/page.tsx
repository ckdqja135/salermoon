"use client";

import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { useSearchHistory, SearchHistoryParams, SearchHistoryItem } from "@/hooks/useSearchHistory";
import html2canvas from "html2canvas";

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
  | "reducePages"
  | "increasePages";

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
type ThemeMode = "light" | "dark";

// ==================== 상수 ====================
const UI_CONFIG = {
  DEFAULT_PAGES: 3,
  MAX_PAGES: 10,
} as const;

const API_CONFIG = {
  DAILY_LIMIT: 25000,
  CALLS_PER_SEARCH: 3,
} as const;

const DISPLAY_COUNT_OPTIONS = [10, 20, 30, 50, 100] as const;
const DEFAULT_DISPLAY_COUNT = 20;

const EXCLUDE_OPTIONS = [
  { value: "used", label: "중고" },
  { value: "rental", label: "렌탈" },
  { value: "cbshop", label: "직구" },
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
  increasePages: "검색 범위 확대",
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

// ==================== 테마 훅 ====================
function useTheme() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const stored = localStorage.getItem("theme") as ThemeMode | null;
    if (stored) {
      setTheme(stored);
      document.documentElement.setAttribute("data-theme", stored);
    } else {
      document.documentElement.setAttribute("data-theme", "light");
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.setAttribute("data-theme", next);
  }, [theme]);

  return { theme, toggleTheme, mounted };
}

// ==================== 컴포넌트 ====================

/** 1개 단가 계산 카드 */
function UnitPriceCard({ item }: { item: Item }) {
  const [qty, setQty] = useState(1);
  const unitPrice = Math.floor(item.lprice / qty);

  const handleQtyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    setQty(isNaN(val) || val < 1 ? 1 : val);
  };

  return (
    <div className="sidebar-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xl">🧮</span>
        <h3 className="text-sm font-bold">1개 단가 계산기</h3>
      </div>
      
      <div className="flex items-center justify-between gap-2 mb-3">
        <label className="text-xs text-[var(--color-text-secondary)]">묶음 수량</label>
        <div className="flex items-center gap-1">
          <input 
            type="number" 
            min="1"
            value={qty} 
            onChange={handleQtyChange} 
            className="input-field-sm w-16 text-right"
          />
          <span className="text-xs">개</span>
        </div>
      </div>

      <div className="pt-3 border-t border-[var(--color-border)]">
        <div className="flex justify-between items-end">
          <span className="text-xs text-[var(--color-text-secondary)]">개당 단가</span>
          <div>
            <span className="text-xl font-bold text-[var(--color-accent-dark)]">
              {formatPrice(unitPrice)}
            </span>
            <span className="text-sm ml-1">원</span>
          </div>
        </div>
      </div>
      
      <p className="text-[10px] text-[var(--color-text-secondary)] mt-2 text-right">
        * 배송비 제외 기준
      </p>
    </div>
  );
}

/** 테마 토글 버튼 */
function ThemeToggle({ theme, onToggle }: { theme: ThemeMode; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="theme-toggle-btn"
      title={theme === "light" ? "다크 모드로 전환" : "라이트 모드로 전환"}
    >
      {theme === "light" ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="5"></circle>
          <line x1="12" y1="1" x2="12" y2="3"></line>
          <line x1="12" y1="21" x2="12" y2="23"></line>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
          <line x1="1" y1="12" x2="3" y2="12"></line>
          <line x1="21" y1="12" x2="23" y2="12"></line>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
        </svg>
      )}
    </button>
  );
}

/** 컴팩트 가격 입력 (실시간 콤마 포맷) */
function PriceInputCompact({
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
    const numbersOnly = raw.replace(/[^\d]/g, "");
    if (numbersOnly === "") {
      setInputValue("");
      return;
    }
    const num = parseInt(numbersOnly, 10);
    if (!isNaN(num)) {
      setInputValue(formatPrice(num));
    }
  };

  const handleInputBlur = () => {
    const parsed = parsePrice(inputValue);
    onChange(parsed);
    setInputValue(parsed > 0 ? formatPrice(parsed) : "");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleInputBlur();
  };

  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium whitespace-nowrap">{label}</label>
        <input
          type="text"
          inputMode="numeric"
          dir="ltr"
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleInputBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="price-input-compact"
        />
    </div>
  );
}

/** 제외 옵션 (컴팩트) */
function ExcludeOptionsCompact({
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
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-xs font-medium">제외:</span>
        {EXCLUDE_OPTIONS.map((option) => (
        <label key={option.value} className="checkbox-wrapper-compact">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => handleToggle(option.value)}
            />
          <span className="text-xs">{option.label}</span>
          </label>
        ))}
    </div>
  );
}

/** 페이지 수 선택 (컴팩트) */
function PagesSelectCompact({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-xs font-medium whitespace-nowrap">수집:</label>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-field-xs"
      >
        {Array.from({ length: UI_CONFIG.MAX_PAGES }, (_, i) => i + 1).map(
          (num) => (
            <option key={num} value={num}>
              {num}페이지 (최대 {num * 100}개)
            </option>
          )
        )}
      </select>
    </div>
  );
}

/** 토글 스위치 (컴팩트) */
function ToggleSwitchCompact({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`toggle-switch-sm ${checked ? "active" : ""}`}
      />
      <span className="text-xs font-medium">{label}</span>
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
  return null;
}

/** 히스토리 필터 요약 텍스트 생성 */
function formatHistorySummary(params: SearchHistoryParams): string {
  const parts: string[] = [];
  
  if (params.minPrice > 0 || params.maxPrice > 0) {
    const min = params.minPrice > 0 ? formatPrice(params.minPrice) : "0";
    const max = params.maxPrice > 0 ? formatPrice(params.maxPrice) : "∞";
    parts.push(`${min}~${max}원`);
  }
  
  if (params.exclude.length > 0) {
    const excludeLabels: Record<string, string> = {
      used: "중고",
      rental: "렌탈",
      cbshop: "직구",
    };
    const excluded = params.exclude
      .map((e) => excludeLabels[e] || e)
      .join("/");
    parts.push(`-${excluded}`);
  }
  
  if (params.filterNoise) {
    parts.push("노이즈제외");
  }
  
  parts.push(`${params.pages}페이지`);
  
  return parts.join(" · ");
}

/** 상대 시간 포맷 */
function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  if (hours < 24) return `${hours}시간 전`;
  if (days < 7) return `${days}일 전`;
  
  return new Date(timestamp).toLocaleDateString("ko-KR", {
    month: "short",
    day: "numeric",
  });
}

/** 검색 히스토리 패널 */
function SearchHistoryPanel({
  history,
  isOpen,
  onToggle,
  onSelect,
  onRemove,
  onClear,
}: {
  history: SearchHistoryItem[];
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (params: SearchHistoryParams) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (history.length === 0) return null;

  return (
    <div className="search-history-panel">
      <button
        type="button"
        onClick={onToggle}
        className="search-history-toggle"
      >
        <span className="flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12,6 12,12 16,14" />
          </svg>
          <span className="text-xs font-medium">최근 검색</span>
          <span className="history-count">{history.length}</span>
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`transition-transform ${isOpen ? "rotate-180" : ""}`}
        >
          <polyline points="6,9 12,15 18,9" />
        </svg>
      </button>

      {isOpen && (
        <div className="search-history-list">
          <div className="search-history-header">
            <span className="text-xs text-[var(--color-text-secondary)]">
              최근 {history.length}개 검색
            </span>
            <button
              type="button"
              onClick={onClear}
              className="text-xs text-[var(--color-error)] hover:underline"
            >
              전체 삭제
            </button>
          </div>
          
          {history.map((item) => (
            <div key={item.id} className="search-history-item">
              <button
                type="button"
                onClick={() => onSelect(item.params)}
                className="search-history-item-content"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium truncate">
                    {item.params.query}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--color-text-secondary)] truncate max-w-[180px]">
                    {formatHistorySummary(item.params)}
                  </span>
                  <span className="text-xs text-[var(--color-text-tertiary)] whitespace-nowrap">
                    {formatRelativeTime(item.savedAt)}
                  </span>
                </div>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemove(item.id);
                }}
                className="search-history-delete"
                title="삭제"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
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

  const handleSelectAll = () => onChange(allMalls);
  const handleClearAll = () => onChange([]);

  return (
    <div className="mall-filter-inline">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <label className="text-sm font-medium">마켓:</label>
        <button type="button" onClick={handleSelectAll} className="text-xs text-[var(--color-primary)] hover:underline">
          전체선택
        </button>
        <span className="text-xs text-[var(--color-text-secondary)]">|</span>
        <button type="button" onClick={handleClearAll} className="text-xs text-[var(--color-text-secondary)] hover:underline">
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

/** 검색 요약 패널 */
function SearchSummaryPanel({
  result,
  appliedFilters
}: {
  result: SearchResult;
  appliedFilters: AppliedFilters;
}) {
  const isLimitReached = result.totalFromApi >= 1000;

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
            <span className="font-medium">
              {formatPrice(result.totalFromApi)}개
              {isLimitReached && " (MAX)"}
            </span>
          </div>
          {isLimitReached && (
            <div className="text-[10px] text-[var(--color-warning)] bg-[rgba(245,158,11,0.1)] p-1.5 rounded mt-1">
              ⚠️ 네이버 API 제한으로 1000개까지만 수집되었습니다.
              {result.allItems.length < 1000 && " 더 많은 결과를 위해 가격대별 검색을 권장합니다."}
            </div>
          )}
          <div className="flex justify-between mt-2">
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
            <div>범위: {appliedFilters.pages}페이지</div>
            <div>노이즈필터: {appliedFilters.filterNoise ? "ON" : "OFF"}</div>
            <div>제외: {appliedFilters.exclude?.join(", ") || "없음"}</div>
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

/** 전체 결과 통계 타입 */
interface AllItemsStats {
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  medianPrice: number;
  count: number;
}

/** 전체 결과 통계 카드 (컴팩트) */
function AllItemsStatsCard({ stats }: { stats: AllItemsStats }) {
  return (
    <div className="all-stats-band">
      <div className="all-stats-header">
        <span className="text-xs">📊</span>
        <span className="text-xs font-semibold">전체 가격 분포</span>
        <span className="text-xs text-[var(--color-text-secondary)]">({formatPrice(stats.count)}개)</span>
      </div>
      <div className="all-stats-grid">
        <div className="all-stats-item">
          <span className="all-stats-label">최저</span>
          <span className="all-stats-value min">{formatPrice(stats.minPrice)}원</span>
        </div>
        <div className="all-stats-item">
          <span className="all-stats-label">최고</span>
          <span className="all-stats-value max">{formatPrice(stats.maxPrice)}원</span>
        </div>
        <div className="all-stats-item">
          <span className="all-stats-label">평균</span>
          <span className="all-stats-value">{formatPrice(stats.avgPrice)}원</span>
        </div>
        <div className="all-stats-item">
          <span className="all-stats-label">중앙</span>
          <span className="all-stats-value">{formatPrice(stats.medianPrice)}원</span>
        </div>
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
  allItemsStats,
  onViewModeChange,
  onDisplayCountChange,
  onExcludeOutliersChange,
  onSelectedMallsChange,
  onClientSortChange,
  onDownloadCSV,
  onCapture,
  onCopy,
}: {
  viewMode: ViewMode;
  displayCount: number;
  excludeOutliers: boolean;
  selectedMalls: string[];
  clientSort: SortOption;
  processedItemsCount: number;
  displayedItemsCount: number;
  allMalls: string[];
  allItemsStats: AllItemsStats | null;
  onViewModeChange: (mode: ViewMode) => void;
  onDisplayCountChange: (count: number) => void;
  onExcludeOutliersChange: (value: boolean) => void;
  onSelectedMallsChange: (malls: string[]) => void;
  onClientSortChange: (sort: SortOption) => void;
  onDownloadCSV: () => void;
  onCapture: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="results-header-bar">
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
          <button type="button" onClick={onCopy} className="btn-icon" title="결과 클립보드 복사">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <button type="button" onClick={onCapture} className="btn-icon" title="결과 이미지 저장">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
          </button>
          <button type="button" onClick={onDownloadCSV} className="btn-icon" title="CSV 다운로드">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <ViewModeToggle viewMode={viewMode} onChange={onViewModeChange} />
        </div>
      </div>

      {/* 전체 결과 통계 */}
      {allItemsStats && (
        <div className="mt-3">
          <AllItemsStatsCard stats={allItemsStats} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mt-3">
        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium">정렬:</label>
          <select
            value={clientSort}
            onChange={(e) => onClientSortChange(e.target.value as SortOption)}
            className="input-field-xs"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-1.5">
          <label className="text-xs font-medium">표시:</label>
          <select
            value={displayCount}
            onChange={(e) => onDisplayCountChange(Number(e.target.value))}
            className="input-field-xs"
          >
            {DISPLAY_COUNT_OPTIONS.map((count) => (
              <option key={count} value={count}>{count}개</option>
            ))}
          </select>
        </div>

        <ToggleSwitchCompact
          checked={excludeOutliers}
          onChange={onExcludeOutliersChange}
          label="이상치 제외"
        />
      </div>

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
function ProductListArea({ items, viewMode }: { items: Item[]; viewMode: ViewMode }) {
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
  const { theme, toggleTheme, mounted } = useTheme();

  // 검색 상태
  const [query, setQuery] = useState("");
  const [minPrice, setMinPrice] = useState<number>(0);
  const [maxPrice, setMaxPrice] = useState<number>(0);
  const [exclude, setExclude] = useState<string[]>(["used", "rental", "cbshop"]);
  const [pages, setPages] = useState<number>(UI_CONFIG.DEFAULT_PAGES);
  const [filterNoise, setFilterNoise] = useState(false);
  const [targetPrice, setTargetPrice] = useState<number>(0);

  // 결과 상태
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  // 결과 필터/뷰 상태
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [displayCount, setDisplayCount] = useState<number>(DEFAULT_DISPLAY_COUNT);
  const [excludeOutliers, setExcludeOutliers] = useState(false);
  const [selectedMalls, setSelectedMalls] = useState<string[]>([]);
  const [clientSort, setClientSort] = useState<SortOption>("asc");
  const [selectedGroup, setSelectedGroup] = useState<PriceGroup | null>(null);

  // 검색 히스토리
  const { history, isAvailable: historyAvailable, addHistory, removeHistory, clearHistory } = useSearchHistory();
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // 캡쳐 참조
  const resultAreaRef = useRef<HTMLDivElement>(null);

  const allMalls = useMemo(() => {
    if (!result) return [];
    const mallSet = new Set(result.allItems.map((item) => item.mallName).filter(Boolean));
    return Array.from(mallSet).sort();
  }, [result]);

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

  // 전체 결과 통계 계산
  const allItemsStats = useMemo(() => {
    if (processedItems.length === 0) return null;
    
    const prices = processedItems.map((item) => item.lprice);
    const sortedPrices = [...prices].sort((a, b) => a - b);
    const sum = prices.reduce((acc, p) => acc + p, 0);
    const mid = Math.floor(sortedPrices.length / 2);
    
    return {
      minPrice: sortedPrices[0],
      maxPrice: sortedPrices[sortedPrices.length - 1],
      avgPrice: Math.round(sum / prices.length),
      medianPrice: sortedPrices.length % 2 === 0
        ? Math.round((sortedPrices[mid - 1] + sortedPrices[mid]) / 2)
        : sortedPrices[mid],
      count: processedItems.length,
    };
  }, [processedItems]);

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

    return { effectiveTop1: top1, effectiveTop10Groups: groups, effectivePriceBand: priceBand };
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

  // 캡쳐 기능
  const handleCapture = useCallback(async () => {
    if (!resultAreaRef.current) return;
    try {
      const canvas = await html2canvas(resultAreaRef.current, {
        useCORS: true,
        scale: 2, // 고해상도
        backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc',
      } as any);
      const url = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = url;
      link.download = `salermoon_capture_${new Date().getTime()}.png`;
      link.click();
    } catch (err) {
      console.error(err);
      alert('이미지 저장에 실패했습니다.');
    }
  }, [theme]);

  // 클립보드 복사
  const handleCopyClipboard = useCallback(async () => {
    if (!resultAreaRef.current) return;
    try {
      const canvas = await html2canvas(resultAreaRef.current, {
        useCORS: true,
        scale: 2,
        backgroundColor: theme === 'dark' ? '#0f172a' : '#f8fafc',
      } as any);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([ 
            new ClipboardItem({ 'image/png': blob })
          ]);
          alert('클립보드에 복사되었습니다!');
        } catch (err) {
          console.error(err);
          alert('클립보드 복사에 실패했습니다. 브라우저 설정을 확인해주세요.');
        }
      });
    } catch (err) {
      console.error(err);
      alert('이미지 생성에 실패했습니다.');
    }
  }, [theme]);

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

      // 검색 성공 시 히스토리에 저장
      addHistory({
        query: query.trim(),
        sort: "sim", // 기본 정렬
        minPrice,
        maxPrice,
        pages,
        filterNoise,
        exclude,
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다"
      );
      setLoadingState("error");
    }
  }, [query, minPrice, maxPrice, exclude, pages, filterNoise, addHistory]);

  /** 히스토리 항목 선택 시 폼 세팅 후 재검색 */
  const handleHistorySelect = useCallback((params: SearchHistoryParams) => {
    // 폼 상태 설정
    setQuery(params.query);
    setMinPrice(params.minPrice);
    setMaxPrice(params.maxPrice);
    setExclude(params.exclude);
    setPages(params.pages);
    setFilterNoise(params.filterNoise);
    
    // 클라이언트 필터 복원 (있는 경우)
    if (params.displayCount) setDisplayCount(params.displayCount);
    if (params.clientSort) setClientSort(params.clientSort as SortOption);
    
    // 히스토리 패널 닫기
    setIsHistoryOpen(false);
    
    // 자동 재검색을 위해 setTimeout 사용 (상태 업데이트 후 실행)
    setTimeout(async () => {
      setLoadingState("loading");
      setErrorMessage("");
      setSelectedMalls([]);
      setExcludeOutliers(false);

      try {
        const searchParams = new URLSearchParams({
          query: params.query,
          pages: String(params.pages),
          filterNoise: String(params.filterNoise),
        });

        if (params.minPrice > 0) searchParams.set("minPrice", String(params.minPrice));
        if (params.maxPrice > 0) searchParams.set("maxPrice", String(params.maxPrice));
        if (params.exclude.length > 0) searchParams.set("exclude", params.exclude.join(":"));

        const response = await fetch(`/api/lowest?${searchParams.toString()}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "검색에 실패했습니다");
        }

        setResult(data);
        setLoadingState("success");

        // 재검색 성공 시 히스토리 갱신
        addHistory(params);
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다"
        );
        setLoadingState("error");
      }
    }, 0);
  }, [addHistory]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      handleSearch();
    }
  };

  const hasResults = loadingState === "success" && result && result.totalCandidates > 0;

  return (
    <main className="min-h-screen bg-pattern">
      <div className="max-w-screen-2xl mx-auto px-3 md:px-6 py-3 md:py-6">
        {/* 헤더 */}
        <header className="flex items-center justify-between mb-4">
          <div className="flex-1" />
          <div className="text-center">
            <h1 className="text-xl md:text-2xl font-black">
            <span className="bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-secondary)] to-[var(--color-accent)] bg-clip-text text-transparent">
              🌙 세일러문
            </span>
          </h1>
            <p className="text-xs text-[var(--color-text-secondary)]">
              시장 최저가 검색
          </p>
          </div>
          <div className="flex-1 flex justify-end">
            {mounted && <ThemeToggle theme={theme} onToggle={toggleTheme} />}
          </div>
        </header>

        {/* 검색 폼 (컴팩트) */}
        <div className="search-form-compact">
          {/* 1행: 검색어 + 버튼 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색어 입력"
              className="input-field-compact flex-1"
              disabled={loadingState === "loading"}
            />
            <button
              onClick={handleSearch}
              disabled={loadingState === "loading"}
              className="btn-primary-compact"
            >
              {loadingState === "loading" ? "검색중" : "검색"}
            </button>
          </div>

          {/* 2행: 가격 필터 + 제외 옵션 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2">
            <PriceInputCompact label="최소" value={minPrice} onChange={setMinPrice} placeholder="제한없음" />
            <PriceInputCompact label="최대" value={maxPrice} onChange={setMaxPrice} placeholder="제한없음" />
            <PriceInputCompact label="목표가" value={targetPrice} onChange={setTargetPrice} placeholder="비교용" />
            <div className="h-4 w-px bg-[var(--color-border)] hidden md:block" />
            <ExcludeOptionsCompact selected={exclude} onChange={setExclude} />
          </div>

          {/* 3행: 수집 범위 + 노이즈 필터 */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-2 pt-2 border-t border-[var(--color-border)]">
            <PagesSelectCompact value={pages} onChange={setPages} />
            <ToggleSwitchCompact checked={filterNoise} onChange={setFilterNoise} label="노이즈 제외" />
          </div>

          {/* 검색 히스토리 */}
          {historyAvailable && history.length > 0 && (
            <SearchHistoryPanel
              history={history}
              isOpen={isHistoryOpen}
              onToggle={() => setIsHistoryOpen(!isHistoryOpen)}
              onSelect={handleHistorySelect}
              onRemove={removeHistory}
              onClear={clearHistory}
            />
          )}
        </div>

        {/* 결과 영역 */}
          {loadingState === "idle" && <IdleState />}
          {loadingState === "loading" && <LoadingState />}
          {loadingState === "error" && <ErrorState message={errorMessage} />}
        {loadingState === "success" && result && result.totalCandidates === 0 && <EmptyState />}

        {hasResults && (
          <div className="main-layout">
            <div className="main-content" ref={resultAreaRef}>
              {result.filterRelaxed && (
                <RelaxationBanner
                  appliedRelaxation={result.appliedRelaxation}
                  appliedFilters={result.appliedFilters}
                />
              )}

              {comparison && (
                <section className="mb-6">
                  <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <span className="text-xl">📊</span>
                    목표가 비교
                  </h2>
                  <TargetPriceComparisonCard comparison={comparison} />
                </section>
              )}

              <ResultsHeader
                viewMode={viewMode}
                displayCount={displayCount}
                excludeOutliers={excludeOutliers}
                selectedMalls={selectedMalls}
                clientSort={clientSort}
                processedItemsCount={processedItems.length}
                displayedItemsCount={displayedItems.length}
                allMalls={allMalls}
                allItemsStats={allItemsStats}
                onViewModeChange={setViewMode}
                onDisplayCountChange={setDisplayCount}
                onExcludeOutliersChange={setExcludeOutliers}
                onSelectedMallsChange={setSelectedMalls}
                onClientSortChange={setClientSort}
                onDownloadCSV={handleDownloadCSV}
                onCapture={handleCapture}
                onCopy={handleCopyClipboard}
              />

              {effectiveTop1 && (
                <section className="mb-6 mt-4">
                  <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
                    <span className="text-xl">🏆</span>
                    최저가 상품
                  </h2>
                  <Top1Card item={effectiveTop1} />
                </section>
              )}

              <section className="mt-4">
                <ProductListArea items={displayedItems} viewMode={viewMode} />
                
                {displayedItems.length < processedItems.length && (
                  <div className="text-center text-sm text-[var(--color-text-secondary)] mt-4">
                    {processedItems.length - displayedItems.length}개 상품이 더 있습니다.
                  </div>
                )}
              </section>
        </div>

            <aside className="sidebar">
              {effectiveTop1 && <UnitPriceCard item={effectiveTop1} />}
              <Top10Sidebar
                groups={effectiveTop10Groups}
                priceBand={effectivePriceBand}
                onGroupClick={setSelectedGroup}
              />
              <SearchSummaryPanel result={result} appliedFilters={result.appliedFilters} />
            </aside>
          </div>
        )}

        {selectedGroup && (
          <PriceGroupModal group={selectedGroup} onClose={() => setSelectedGroup(null)} />
        )}

        <footer className="text-center mt-8 text-xs text-[var(--color-text-secondary)]">
            <a
              href="https://developers.naver.com/docs/serviceapi/search/shopping/shopping.md"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-[var(--color-primary)]"
            >
              네이버 쇼핑 API
            </a>
            를 활용한 최저가 검색 서비스
        </footer>
      </div>
    </main>
  );
}