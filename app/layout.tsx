import type { Metadata } from "next";
import "./globals.css";

// P1-T1：字体改为本地 @font-face 自托管（见 globals.css），不再依赖 next/font/google（消除构建期 Google Fonts 请求）。
// 主题：默认深色（html data-theme="dark"），--ds-* token 由 globals.css 的 :root / html[data-theme="dark"] 两层定义。

export const metadata: Metadata = {
    metadataBase: new URL("https://dsh-plugin.store"),
    title: {
      default: "dsh-plugin · DeepSeek Harness 插件目录",
      template: "%s · dsh-plugin",
    },
    description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
    keywords: ["DeepSeek Harness", "DSH", "dsh-plugin", "插件目录", "AI Agent"],
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
      shortcut: "/favicon.svg",
      apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "512x512" }],
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      alternateLocale: "en_US",
      siteName: "dsh-plugin",
      title: "dsh-plugin · DeepSeek Harness 插件目录",
      description: "先看来源、清单和维护信号，再决定装不装。",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "dsh-plugin" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "dsh-plugin · DeepSeek Harness 插件目录",
      description: "真实 GitHub 数据、manifest 证据与安装边界。",
      images: ["/og.png"],
    },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <body className="ds-font-sans antialiased">{children}</body>
    </html>
  );
}
