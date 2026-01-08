"use client";

import { useState, useCallback, useEffect, useRef } from "react";
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

// ==================== 상수 ====================
const UI_CONFIG = {
  DEFAULT_PAGES: 3,
  MAX_PAGES: 10,
} as const;

const EXCLUDE_OPTIONS = [
  { value: "used", label: "중고" },
  { value: "rental", label: "렌탈" },
  { value: "cbshop", label: "해외직구/구매대행" },
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
function ProductImage({ src, alt, size = "md" }: { src?: string; alt: string; size?: "sm" | "md" | "lg" }) {
  const [hasError, setHasError] = useState(false);
  const sizeClass = size === "sm" ? "w-12 h-12" : size === "lg" ? "w-full" : "w-16 h-16";

  if (!src || hasError) {
    return (
      <div className={`${sizeClass} flex items-center justify-center bg-gray-100 dark:bg-gray-800 rounded-lg flex-shrink-0`}>
        <span className={size === "lg" ? "text-4xl" : "text-2xl"}>📦</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={size === "lg" ? 200 : size === "md" ? 64 : 48}
      height={size === "lg" ? 200 : size === "md" ? 64 : 48}
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
      className="card top1-card p-6 block fade-in"
    >
      <div className="flex flex-col md:flex-row gap-6">
        <div className="w-full md:w-48 flex-shrink-0">
          <ProductImage src={item.image} alt={item.titleText} size="lg" />
        </div>
        <div className="flex-1 space-y-3">
          <div>
            <h3
              className="text-lg font-bold line-clamp-2"
              dangerouslySetInnerHTML={{ __html: item.title }}
            />
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">
              {item.mallName}
              {item.brand && <span className="ml-2">| {item.brand}</span>}
            </p>
          </div>
          <div>
            <span className="price price-large">{formatPrice(item.lprice)}</span>
            <span className="text-lg ml-1">원</span>
          </div>
        </div>
      </div>
    </a>
  );
}

/** 가격 밴드 요약 */
function PriceBandSummaryCard({ band }: { band: PriceBandSummary }) {
  return (
    <div className="price-band">
      <div className="price-band-item">
        <div className="price-band-label">최저</div>
        <div className="price-band-value">{formatPrice(band.minPrice)}원</div>
      </div>
      <div className="price-band-item">
        <div className="price-band-label">최고</div>
        <div className="price-band-value">{formatPrice(band.maxPrice)}원</div>
      </div>
      <div className="price-band-item">
        <div className="price-band-label">평균</div>
        <div className="price-band-value">{formatPrice(band.avgPrice)}원</div>
      </div>
      <div className="price-band-item">
        <div className="price-band-label">중앙</div>
        <div className="price-band-value">{formatPrice(band.medianPrice)}원</div>
      </div>
    </div>
  );
}

/** 목표가 비교 결과 */
function TargetPriceComparisonCard({ comparison }: { comparison: TargetPriceComparison }) {
  const statusEmoji = comparison.status === "higher" ? "⚠️" : comparison.status === "lower" ? "✅" : "📍";
  const diffSign = comparison.difference > 0 ? "+" : "";

  return (
    <div className="comparison-card space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="text-sm text-[var(--color-text-secondary)] mb-1">목표가</div>
          <div className="text-2xl font-bold">{formatPrice(comparison.targetPrice)}원</div>
        </div>
        <div className="text-center">
          <div className="text-sm text-[var(--color-text-secondary)] mb-1">vs 최저가</div>
          <div className="text-xl font-bold">
            {diffSign}{formatPrice(comparison.difference)}원
            <span className="text-sm font-normal ml-2">
              ({diffSign}{comparison.differencePercent.toFixed(1)}%)
            </span>
          </div>
        </div>
      </div>
      <div className={`comparison-status ${comparison.status}`}>
        <span>{statusEmoji}</span>
        <span>{comparison.statusText}</span>
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

/** Top10 그룹 아이템 */
function Top10GroupItem({
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
    <>
      <span className={`rank-badge ${rank <= 3 ? "top3" : ""}`}>{rank}</span>
      <ProductImage src={item.image} alt={item.titleText} size="md" />
      <div className="flex-1 min-w-0">
        <h4
          className="text-sm font-medium line-clamp-2"
          dangerouslySetInnerHTML={{ __html: item.title }}
        />
        <p className="text-xs text-[var(--color-text-secondary)] mt-1">
          {item.mallName}
        </p>
      </div>
      <div className="text-right flex-shrink-0 flex items-center gap-3">
        <div>
          <span className="price text-lg">{formatPrice(group.price)}</span>
          <span className="text-sm">원</span>
        </div>
        {isMulti && <span className="count-badge">{group.count}건</span>}
      </div>
    </>
  );

  if (isMulti) {
    return (
      <button
        onClick={handleClick}
        className={`group-item multi w-full text-left fade-in fade-in-delay-${Math.min(rank, 3)}`}
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
      className={`group-item fade-in fade-in-delay-${Math.min(rank, 3)}`}
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

/** 검색 결과 */
function SearchResults({
  result,
  targetPrice,
}: {
  result: SearchResult;
  targetPrice: number;
}) {
  const [selectedGroup, setSelectedGroup] = useState<PriceGroup | null>(null);

  if (result.totalCandidates === 0) {
    return <EmptyState />;
  }

  const comparison =
    targetPrice > 0 && result.top1
      ? calculateComparison(targetPrice, result.top1.lprice)
      : null;

  return (
    <div className="space-y-8">
      {/* 필터 완화 알림 */}
      {result.filterRelaxed && (
        <RelaxationBanner
          appliedRelaxation={result.appliedRelaxation}
          appliedFilters={result.appliedFilters}
        />
      )}

      {/* 결과 요약 */}
      <div className="text-center text-sm text-[var(--color-text-secondary)]">
        네이버 쇼핑에서{" "}
        <span className="font-bold text-[var(--color-text)]">
          {formatPrice(result.totalFromApi)}개
        </span>
        의 상품 중{" "}
        <span className="font-bold text-[var(--color-primary)]">
          {formatPrice(result.totalCandidates)}개
        </span>
        를 필터링하여 최저가를 찾았어요
        {result.excludedByKeywordsCount > 0 && (
          <span className="block mt-1 text-xs">
            (제외 키워드로 {formatPrice(result.excludedByKeywordsCount)}개 제외됨)
          </span>
        )}
      </div>

      {/* 목표가 비교 */}
      {comparison && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="text-2xl">📊</span>
            목표가 비교 분석
          </h2>
          <TargetPriceComparisonCard comparison={comparison} />
        </section>
      )}

      {/* 가격 밴드 요약 */}
      {result.priceBand && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="text-2xl">📈</span>
            TOP10 가격 밴드
          </h2>
          <PriceBandSummaryCard band={result.priceBand} />
        </section>
      )}

      {/* Top1 */}
      {result.top1 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="text-2xl">🏆</span>
            최저가 상품
          </h2>
          <Top1Card item={result.top1} />
        </section>
      )}

      {/* Top10 그룹 */}
      {result.top10Groups.length > 0 && (
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            <span className="text-2xl">📋</span>
            TOP 10 가격대
            <span className="text-sm font-normal text-[var(--color-text-secondary)]">
              (동일 가격 그룹핑)
            </span>
          </h2>
          <div className="space-y-3">
            {result.top10Groups.map((group, index) => (
              <Top10GroupItem
                key={group.price + "-" + index}
                group={group}
                rank={index + 1}
                onGroupClick={setSelectedGroup}
              />
            ))}
          </div>
        </section>
      )}

      {/* 가격 그룹 모달 */}
      {selectedGroup && (
        <PriceGroupModal
          group={selectedGroup}
          onClose={() => setSelectedGroup(null)}
        />
      )}
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

  // 검색 실행
  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setErrorMessage("검색어를 입력해주세요");
      setLoadingState("error");
      return;
    }

    setLoadingState("loading");
    setErrorMessage("");

    try {
      const params = new URLSearchParams({
        query: query.trim(),
        pages: String(pages),
        filterNoise: String(filterNoise),
      });

      // minPrice/maxPrice는 0보다 클 때만 전송 (선택값)
      if (minPrice > 0) {
        params.set("minPrice", String(minPrice));
      }

      if (maxPrice > 0) {
        params.set("maxPrice", String(maxPrice));
      }

      if (exclude.length > 0) {
        params.set("exclude", exclude.join(":"));
      }

      const response = await fetch(`/api/lowest?${params.toString()}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "검색에 실패했습니다");
      }

      setResult(data);
      setLoadingState("success");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다"
      );
      setLoadingState("error");
    }
  }, [query, minPrice, maxPrice, exclude, pages, filterNoise]);

  // Enter 키 검색
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      handleSearch();
    }
  };

  return (
    <main className="min-h-screen bg-pattern">
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-12">
        {/* 헤더 */}
        <header className="text-center mb-8">
          <h1 className="text-3xl md:text-4xl font-black mb-2">
            <span className="bg-gradient-to-r from-[var(--color-primary)] via-[var(--color-secondary)] to-[var(--color-accent)] bg-clip-text text-transparent">
              🌙 세일러문
            </span>
          </h1>
          <p className="text-[var(--color-text-secondary)]">
            프로모션 가격 설계를 위한 시장 최저가 검색
          </p>
        </header>

        {/* 검색 폼 */}
        <div className="card-static p-6 mb-8 space-y-6">
          {/* 검색 입력 */}
          <div className="flex gap-3">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="검색어를 입력하세요 (예: 바나나, 아이폰, 운동화)"
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

          {/* 가격 필터 + 목표가 */}
          <div className="grid md:grid-cols-3 gap-4 items-end">
            <PriceInput
              label="최소 가격"
              value={minPrice}
              onChange={setMinPrice}
              placeholder="미입력시 제한없음"
            />
            <PriceInput
              label="최대 가격"
              value={maxPrice}
              onChange={setMaxPrice}
              placeholder="미입력시 제한없음"
            />
            <PriceInput
              label="목표가 (비교용)"
              value={targetPrice}
              onChange={setTargetPrice}
              placeholder="행사가/납품가"
            />
          </div>

          {/* 기타 필터 */}
          <div className="grid md:grid-cols-2 gap-6">
            <ExcludeOptions selected={exclude} onChange={setExclude} />
            <PagesSelect value={pages} onChange={setPages} />
          </div>

          {/* 노이즈 필터 토글 */}
          <div className="pt-2 border-t border-[var(--color-border)]">
            <ToggleSwitch
              checked={filterNoise}
              onChange={setFilterNoise}
              label="노이즈 키워드 제외 (견적, 상담권)"
            />
            <p className="text-xs text-[var(--color-text-secondary)] mt-2 ml-14">
              * 결과가 없을 경우 필터가 자동으로 완화됩니다
            </p>
          </div>
        </div>

        {/* 결과 영역 */}
        <div>
          {loadingState === "idle" && <IdleState />}
          {loadingState === "loading" && <LoadingState />}
          {loadingState === "error" && <ErrorState message={errorMessage} />}
          {loadingState === "success" && result && (
            <SearchResults result={result} targetPrice={targetPrice} />
          )}
        </div>

        {/* 푸터 */}
        <footer className="text-center mt-12 text-xs text-[var(--color-text-secondary)]">
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
          <p className="mt-1">검색 결과는 실시간 데이터와 다를 수 있습니다</p>
        </footer>
      </div>
    </main>
  );
}
