"use client";

import { useMemo } from "react";
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
  const { buckets, maxCount, overallMin, overallMax } = useMemo(() => {
    if (items.length === 0) {
      return { buckets: [], maxCount: 0, overallMin: 0, overallMax: 0 };
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
      };
    }

    const range = max - min;
    const bucketSize = range / BUCKET_COUNT;

    const newBuckets: Bucket[] = Array.from({ length: BUCKET_COUNT }, (_, i) => {
      const bucketMin = min + i * bucketSize;
      const bucketMax = i === BUCKET_COUNT - 1 ? max : min + (i + 1) * bucketSize;
      return {
        min: Math.floor(bucketMin),
        max: Math.floor(bucketMax),
        count: 0,
      };
    });

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

    const maxCount = Math.max(...newBuckets.map((b) => b.count));

    return { buckets: newBuckets, maxCount, overallMin: min, overallMax: max };
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-5 mb-4 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-bold flex items-center gap-2">
          <span>📊</span>
          가격 분포
        </h3>
        {selectedRange && (
          <button
            onClick={() => onSelectRange(0, 0)}
            className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1"
          >
            <span>↺</span>
            필터 초기화
          </button>
        )}
      </div>

      <div className="relative h-32 flex items-end gap-1 mt-2">
        {buckets.map((bucket, index) => {
          const isSelected =
            selectedRange &&
            bucket.min >= selectedRange.min &&
            bucket.max <= selectedRange.max;

          const heightPercent =
            maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;

          const tooltipText = `${formatPrice(bucket.min)} ~ ${formatPrice(bucket.max)}\n${bucket.count}개 상품`;

          return (
            <div
              key={index}
              className={`group relative flex-1 min-w-[5px] rounded-t-sm transition-all duration-200 cursor-pointer hover:opacity-85
                ${
                  isSelected
                    ? "bg-[var(--color-accent)]"
                    : bucket.count > 0
                      ? "bg-[var(--color-primary)]/45 hover:bg-[var(--color-primary)]/65"
                      : "bg-transparent hover:bg-[var(--color-border)]"
                }
              `}
              style={{ height: `${Math.max(heightPercent, 4)}%` }}
              onClick={() => {
                if (bucket.count > 0) {
                  onSelectRange(bucket.min, bucket.max);
                }
              }}
              title={tooltipText}
            >
              {bucket.count === 0 && (
                <div className="absolute bottom-0 w-full h-full bg-[var(--color-border)]/20 rounded-t-sm opacity-0 group-hover:opacity-100" />
              )}

              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[160px] bg-black/85 text-white text-[10px] p-2 rounded pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-10 text-center leading-tight">
                <div className="font-bold mb-1">{bucket.count}개 상품</div>
                <div className="text-gray-300">
                  {formatPrice(bucket.min)} ~ {formatPrice(bucket.max)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-between mt-2 text-[10px] text-[var(--color-text-secondary)] font-medium">
        <span>{formatPrice(overallMin)}원</span>
        <span>{formatPrice(overallMax)}원</span>
      </div>

      <p className="text-[10px] text-[var(--color-text-secondary)] mt-2 text-center bg-[var(--color-primary)]/5 py-1.5 rounded">
        막대를 클릭하면 해당 가격대 상품만 필터링합니다. (왼쪽에 몰린 비정상적으로 싼 상품을 쉽게 거를 수 있어요)
      </p>
    </div>
  );
}
