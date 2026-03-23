"use client";

import { useMemo, useState } from "react";
import { Item } from "@/types/naver";
import { formatPrice } from "@/utils/text";

interface PriceHistogramProps {
  items: Item[];
  onSelectRange: (min: number, max: number) => void;
  selectedRange: { min: number; max: number } | null;
}

interface Bucket {
  min: number;
  max: number;
  count: number;
}

const BUCKET_COUNT = 20;

export default function PriceHistogram({
  items,
  onSelectRange,
  selectedRange,
}: PriceHistogramProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const { buckets, maxCount, overallMin, overallMax, totalCount } =
    useMemo(() => {
      if (items.length === 0) {
        return {
          buckets: [],
          maxCount: 0,
          overallMin: 0,
          overallMax: 0,
          totalCount: 0,
        };
      }

      const prices = items.map((item) => item.lprice);
      const min = Math.min(...prices);
      const max = Math.max(...prices);

      if (min === max) {
        return {
          buckets: [{ min, max, count: items.length }],
          maxCount: items.length,
          overallMin: min,
          overallMax: max,
          totalCount: items.length,
        };
      }

      const range = max - min;
      const bucketSize = range / BUCKET_COUNT;

      const newBuckets: Bucket[] = Array.from(
        { length: BUCKET_COUNT },
        (_, i) => {
          const bucketMin = min + i * bucketSize;
          const bucketMax =
            i === BUCKET_COUNT - 1 ? max : min + (i + 1) * bucketSize;
          return {
            min: Math.floor(bucketMin),
            max: Math.floor(bucketMax),
            count: 0,
          };
        }
      );

      items.forEach((item) => {
        const price = item.lprice;
        if (price === max) {
          newBuckets[BUCKET_COUNT - 1].count++;
        } else {
          const index = Math.min(
            Math.floor((price - min) / bucketSize),
            BUCKET_COUNT - 1
          );
          newBuckets[index].count++;
        }
      });

      // Merge empty buckets into adjacent non-empty ones
      const merged: Bucket[] = [];
      let pending: Bucket | null = null;

      for (const b of newBuckets) {
        if (b.count === 0) {
          if (pending) {
            pending.max = b.max;
          } else {
            pending = { ...b };
          }
        } else {
          if (pending) {
            // Attach empty range to this non-empty bucket
            merged.push({
              min: pending.min,
              max: b.max,
              count: b.count,
            });
            pending = null;
          } else {
            merged.push({ ...b });
          }
        }
      }
      // If trailing empties exist, merge into last non-empty
      if (pending && merged.length > 0) {
        merged[merged.length - 1].max = pending.max;
      }

      const maxCount = Math.max(...merged.map((b) => b.count));

      return {
        buckets: merged,
        maxCount,
        overallMin: min,
        overallMax: max,
        totalCount: items.length,
      };
    }, [items]);

  if (items.length === 0) {
    return (
      <div className="bg-[var(--color-surface)] border border-[var(--color-border)]/50 rounded-2xl p-5 mb-4 text-center">
        <p className="text-xs text-[var(--color-text-secondary)]">
          가격 분포를 표시할 데이터가 없습니다.
        </p>
      </div>
    );
  }

  return (
    <div
      className="bg-[var(--color-surface)] border border-[var(--color-border)]/50 rounded-2xl p-5 pb-4 mb-4"
      role="region"
      aria-label="가격 분포 차트"
    >
      {/* Header */}
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-semibold text-[var(--color-text)]">
            가격 분포
          </h3>
          <span className="text-[10px] text-[var(--color-text-secondary)] bg-[var(--color-border)]/25 px-1.5 py-0.5 rounded-md font-medium">
            {totalCount}개
          </span>
        </div>
        {selectedRange && (
          <button
            onClick={() => onSelectRange(0, 0)}
            className="text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text)] transition-colors duration-150"
            aria-label="가격 필터 초기화"
          >
            초기화
          </button>
        )}
      </div>

      {/* Chart */}
      <div className="relative h-[100px] flex items-end gap-[3px]" role="group" aria-label="가격 분포 막대 차트">
        {buckets.map((bucket, index) => {
          const isSelected =
            selectedRange &&
            bucket.min >= selectedRange.min &&
            bucket.max <= selectedRange.max;
          const isHovered = hoveredIndex === index;
          const heightPercent =
            maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;

          return (
            <div
              key={index}
              className="relative flex-1 flex items-end justify-center"
              style={{ height: "100%" }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={() => onSelectRange(bucket.min, bucket.max)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRange(bucket.min, bucket.max);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`${formatPrice(bucket.min)}~${formatPrice(bucket.max)}원: ${bucket.count}개${isSelected ? " (선택됨)" : ""}`}
            >
              <div
                className={`
                  w-[60%] max-w-[10px] cursor-pointer transition-all duration-200 ease-out rounded-full
                  ${isSelected
                    ? "bg-[var(--color-accent)]"
                    : isHovered
                      ? "bg-[var(--color-primary)]"
                      : "bg-[var(--color-primary)]/35"
                  }
                `}
                style={{
                  height: `${Math.max(heightPercent, 2)}%`,
                }}
              />

              {/* Tooltip */}
              {isHovered && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-20 pointer-events-none">
                  <div className="bg-[var(--color-text)] text-[var(--color-surface)] text-[10px] leading-tight px-2.5 py-1.5 rounded-md whitespace-nowrap shadow-sm">
                    <span className="font-semibold">{bucket.count}개</span>
                    <span className="opacity-60 ml-1.5">
                      {formatPrice(bucket.min)}~{formatPrice(bucket.max)}원
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* X-axis */}
      <div className="flex justify-between mt-2.5 text-[10px] text-[var(--color-text-secondary)] opacity-70 tabular-nums">
        <span>{formatPrice(overallMin)}원</span>
        <span>{formatPrice(overallMax)}원</span>
      </div>

      {/* Help */}
      <p className="text-[10px] text-[var(--color-text-secondary)] opacity-50 mt-2 text-center">
        클릭하여 가격대 필터링
      </p>
    </div>
  );
}
