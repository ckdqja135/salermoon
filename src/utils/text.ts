/**
 * 텍스트 처리 유틸리티
 * 순수 함수로 구성되어 테스트 용이
 */

/**
 * HTML 태그 제거 (특히 <b> 태그)
 * @param html - HTML 문자열
 * @returns 태그가 제거된 순수 텍스트
 */
export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/**
 * 제목에서 특정 키워드 포함 여부 확인
 * @param text - 검사할 텍스트
 * @param keywords - 키워드 배열
 * @returns 하나라도 포함되면 true
 */
export function containsAnyKeyword(text: string, keywords: readonly string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((keyword) => lowerText.includes(keyword.toLowerCase()));
}

/**
 * 숫자를 천단위 콤마 형식으로 변환
 * @param num - 변환할 숫자
 * @returns 콤마가 포함된 문자열
 */
export function formatPrice(num: number): string {
  return num.toLocaleString("ko-KR");
}

/**
 * 문자열을 숫자로 안전하게 변환
 * @param value - 변환할 문자열
 * @param defaultValue - 변환 실패 시 기본값
 * @returns 변환된 숫자
 */
export function safeParseInt(value: string, defaultValue: number = 0): number {
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

