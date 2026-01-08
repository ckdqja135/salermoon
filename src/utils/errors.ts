/**
 * 에러 처리 유틸리티
 * 에러 타입 구분 및 안전한 에러 메시지 생성
 */

/** 커스텀 API 에러 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public originalError?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 네이버 API 관련 에러 */
export class NaverApiError extends ApiError {
  constructor(message: string, originalError?: unknown) {
    super(message, 502, originalError);
    this.name = "NaverApiError";
  }
}

/** 검증 에러 */
export class ValidationError extends ApiError {
  constructor(message: string) {
    super(message, 400);
    this.name = "ValidationError";
  }
}

/** 타임아웃 에러 */
export class TimeoutError extends NaverApiError {
  constructor(originalError?: unknown) {
    super("네이버 API 요청 시간이 초과되었습니다", originalError);
    this.name = "TimeoutError";
  }
}

/**
 * 에러를 안전한 메시지로 변환 (외부 노출용)
 * 내부 구현 세부사항을 숨기고 사용자 친화적 메시지 반환
 */
export function toSafeErrorMessage(error: unknown): string {
  if (error instanceof ValidationError) {
    return error.message;
  }
  if (error instanceof TimeoutError) {
    return "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요.";
  }
  if (error instanceof NaverApiError) {
    return "외부 서비스 연결에 실패했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  return "서버 오류가 발생했습니다.";
}

/**
 * 에러에서 HTTP 상태 코드 추출
 */
export function getErrorStatusCode(error: unknown): number {
  if (error instanceof ApiError) {
    return error.statusCode;
  }
  return 500;
}

/**
 * 내부 로깅용 에러 상세 정보 추출
 */
export function getErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  originalError?: unknown;
} {
  if (error instanceof ApiError) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      originalError: error.originalError,
    };
  }
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    name: "UnknownError",
    message: String(error),
  };
}

