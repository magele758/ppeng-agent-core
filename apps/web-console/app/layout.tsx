import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

/** 设为 `0` / `false` 可跳过加载（如 e2e/无外网 环境） */
const reactGrabDisabled =
  process.env.NEXT_PUBLIC_REACT_GRAB === '0' || process.env.NEXT_PUBLIC_REACT_GRAB === 'false';
const loadReactGrab =
  process.env.NODE_ENV === 'development' && !reactGrabDisabled;

export const metadata: Metadata = {
  title: 'Agent Lab · Debug Console',
  description: 'Raw Agent SDK 全能力调试台'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {loadReactGrab ? (
          <Script
            src="https://unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        ) : null}
        <meta name="color-scheme" content="dark" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
