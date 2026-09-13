/**
 * 상품 이미지 프록시
 * 결과 이미지 캡처(html-to-image) 시 CORS 문제를 피하기 위해 서버에서 이미지를 대신 받아온다.
 * SSRF 방지를 위해 수집 상품 이미지가 사용하는 네이버 이미지 CDN(*.pstatic.net)만 허용한다.
 */

import { NextRequest, NextResponse } from "next/server";

const MAX_IMAGE_BYTES = 5_000_000;
const TIMEOUT_MS = 8_000;

function allowedImageUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname;
  if (host !== "pstatic.net" && !host.endsWith(".pstatic.net")) return null;
  return url;
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");

  if (!raw) {
    return new NextResponse("Missing URL parameter", { status: 400 });
  }

  const url = allowedImageUrl(raw);
  if (!url) {
    return new NextResponse("URL not allowed", { status: 400 });
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      return new NextResponse(`Failed to fetch image: ${response.statusText}`, { status: response.status });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return new NextResponse("Not an image", { status: 415 });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new NextResponse("Image too large", { status: 413 });
    }

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (error) {
    console.error("Image proxy error:", error);
    return new NextResponse("Internal Server Error", { status: 500 });
  }
}
