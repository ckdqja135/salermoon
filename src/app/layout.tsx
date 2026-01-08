import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "세일러문 - 네이버 쇼핑 최저가 검색",
  description: "네이버 쇼핑에서 최저가 상품과 TOP10을 빠르게 검색하세요.",
  keywords: ["네이버 쇼핑", "최저가", "가격 비교", "쇼핑", "TOP10"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
