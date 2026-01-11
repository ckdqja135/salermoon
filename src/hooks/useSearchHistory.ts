"use client";

import { useState, useCallback, useEffect } from "react";
import { SEARCH_HISTORY_CONFIG } from "@/config/naver";

/** 검색 히스토리 파라미터 */
export interface SearchHistoryParams {
  query: string;
  sort: string;
  minPrice: number;
  maxPrice: number;
  pages: number;
  filterNoise: boolean;
  exclude: string[];
  // 클라이언트 필터 (선택적)
  displayCount?: number;
  excludeOutliers?: boolean;
  selectedMalls?: string[];
  clientSort?: string;
}

/** 검색 히스토리 항목 */
export interface SearchHistoryItem {
  id: string;
  savedAt: number;
  params: SearchHistoryParams;
}

/** 검색 조건이 동일한지 비교 */
function isSameParams(a: SearchHistoryParams, b: SearchHistoryParams): boolean {
  return (
    a.query === b.query &&
    a.sort === b.sort &&
    a.minPrice === b.minPrice &&
    a.maxPrice === b.maxPrice &&
    a.pages === b.pages &&
    a.filterNoise === b.filterNoise &&
    a.exclude.length === b.exclude.length &&
    a.exclude.every((v, i) => b.exclude[i] === v)
  );
}

/** 고유 ID 생성 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/** localStorage 사용 가능 여부 확인 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = "__test__";
    localStorage.setItem(testKey, testKey);
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/** localStorage에서 히스토리 로드 */
function loadHistory(): SearchHistoryItem[] {
  if (!isLocalStorageAvailable()) return [];
  
  try {
    const stored = localStorage.getItem(SEARCH_HISTORY_CONFIG.STORAGE_KEY);
    if (!stored) return [];
    
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    
    // 유효한 항목만 필터링
    return parsed.filter(
      (item): item is SearchHistoryItem =>
        item &&
        typeof item.id === "string" &&
        typeof item.savedAt === "number" &&
        item.params &&
        typeof item.params.query === "string"
    );
  } catch {
    return [];
  }
}

/** localStorage에 히스토리 저장 */
function saveHistory(history: SearchHistoryItem[]): void {
  if (!isLocalStorageAvailable()) return;
  
  try {
    localStorage.setItem(
      SEARCH_HISTORY_CONFIG.STORAGE_KEY,
      JSON.stringify(history)
    );
  } catch {
    // 저장 실패 시 조용히 무시
  }
}

/**
 * 검색 히스토리 관리 훅
 */
export function useSearchHistory() {
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isAvailable, setIsAvailable] = useState(false);

  // 초기 로드
  useEffect(() => {
    const available = isLocalStorageAvailable();
    setIsAvailable(available);
    if (available) {
      setHistory(loadHistory());
    }
  }, []);

  /**
   * 히스토리에 검색 조건 추가
   * - 검색어가 비어있으면 저장하지 않음
   * - 동일 조건이 있으면 최신 시간으로 갱신
   */
  const addHistory = useCallback((params: SearchHistoryParams): void => {
    if (!isAvailable) return;
    if (!params.query.trim()) return;

    setHistory((prev) => {
      // 동일 조건 찾기
      const existingIndex = prev.findIndex((item) =>
        isSameParams(item.params, params)
      );

      let newHistory: SearchHistoryItem[];

      if (existingIndex !== -1) {
        // 기존 항목 업데이트 (최신 시간으로 갱신하고 맨 앞으로)
        const existing = prev[existingIndex];
        const updated: SearchHistoryItem = {
          ...existing,
          savedAt: Date.now(),
        };
        newHistory = [
          updated,
          ...prev.slice(0, existingIndex),
          ...prev.slice(existingIndex + 1),
        ];
      } else {
        // 새 항목 추가
        const newItem: SearchHistoryItem = {
          id: generateId(),
          savedAt: Date.now(),
          params,
        };
        newHistory = [newItem, ...prev];
      }

      // 최대 개수 제한
      if (newHistory.length > SEARCH_HISTORY_CONFIG.MAX_ITEMS) {
        newHistory = newHistory.slice(0, SEARCH_HISTORY_CONFIG.MAX_ITEMS);
      }

      saveHistory(newHistory);
      return newHistory;
    });
  }, [isAvailable]);

  /**
   * 개별 항목 삭제
   */
  const removeHistory = useCallback((id: string): void => {
    if (!isAvailable) return;

    setHistory((prev) => {
      const newHistory = prev.filter((item) => item.id !== id);
      saveHistory(newHistory);
      return newHistory;
    });
  }, [isAvailable]);

  /**
   * 전체 히스토리 삭제
   */
  const clearHistory = useCallback((): void => {
    if (!isAvailable) return;

    setHistory([]);
    saveHistory([]);
  }, [isAvailable]);

  return {
    history,
    isAvailable,
    addHistory,
    removeHistory,
    clearHistory,
  };
}
