/**
 * 환경 변수 검증 유틸리티
 * 개발 환경에서 환경 변수가 올바르게 설정되었는지 확인
 */

/**
 * 환경 변수 검증
 * @returns 환경 변수가 모두 설정되어 있으면 true, 아니면 false
 */
export function validateEnv(): { valid: boolean; missing: string[] } {
  const required = ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"];
  const missing: string[] = [];

  for (const key of required) {
    if (!process.env[key] || process.env[key] === "") {
      missing.push(key);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

/**
 * 환경 변수 검증 결과를 콘솔에 출력
 */
export function logEnvStatus(): void {
  if (process.env.NODE_ENV === "development") {
    const { valid, missing } = validateEnv();
    
    if (valid) {
      console.log("✅ 환경 변수가 올바르게 설정되었습니다.");
    } else {
      console.error("❌ 환경 변수가 설정되지 않았습니다:");
      missing.forEach((key) => {
        console.error(`   - ${key}`);
      });
      console.error("\n💡 .env.local 파일을 생성하고 다음 변수들을 설정하세요:");
      console.error("   NAVER_CLIENT_ID=your_client_id_here");
      console.error("   NAVER_CLIENT_SECRET=your_client_secret_here");
    }
  }
}

