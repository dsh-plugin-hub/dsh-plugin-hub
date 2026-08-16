import type { Metadata } from "next";
import "./globals.css";

// P1-T1：字体改为本地 @font-face 自托管（见 globals.css），不再依赖 next/font/google（消除构建期 Google Fonts 请求）。
// 主题：默认深色（html data-theme="dark"），--ds-* token 由 globals.css 的 :root / html[data-theme="dark"] 两层定义。
// SEO：canonical 域 = https://dsh-plugin.store（www 与 workers.dev 均指向这里）。

export const SITE_URL = "https://dsh-plugin.store";
export const SITE_NAME = "dsh-plugin";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "dsh-plugin · DeepSeek Harness 插件目录",
    template: "%s · dsh-plugin",
  },
  description:
    "全网最全的 DeepSeek Harness（DSH）社区插件目录：基于 GitHub 真实数据收录插件、manifest 证据、维护信号与安装命令，安装前先看来源。",
  keywords: [
    "DeepSeek Harness",
    "DeepSeek Harness 插件",
    "DSH 插件",
    "DSH 插件市场",
    "dsh-plugin",
    "dsh plugin",
    "AI 插件目录",
    "AI Agent 插件",
    "插件安装",
    "Awesome DSH",
  ],
  authors: [{ name: "dsh-plugin" }],
  category: "technology",
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    locale: "zh_CN",
    alternateLocale: "en_US",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: "dsh-plugin · DeepSeek Harness 插件目录",
    description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录：先看来源、清单和维护信号，再决定装不装。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "dsh-plugin — DeepSeek Harness 插件目录" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "dsh-plugin · DeepSeek Harness 插件目录",
    description: "真实 GitHub 数据、manifest 证据与安装边界，全网最全的 DSH 插件目录。",
    images: ["/og.png"],
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml", sizes: "any" }],
    shortcut: "/favicon.svg",
    apple: [{ url: "/apple-touch-icon.png", type: "image/png", sizes: "512x512" }],
  },
};

// JSON-LD：WebSite + Organization（站点级结构化数据，帮助搜索引擎理解站点实体）。
const webSiteLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  alternateName: ["dsh-plugin · DeepSeek Harness 插件目录", "DSH 插件目录"],
  url: SITE_URL,
  description: "基于 GitHub 真实数据的 DeepSeek Harness（DSH）社区插件目录与安装证据索引。",
  inLanguage: ["zh-CN", "en-US"],
  publisher: { "@id": SITE_URL + "/#organization" },
};

const organizationLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": SITE_URL + "/#organization",
  name: SITE_NAME,
  url: SITE_URL,
  logo: {
    "@type": "ImageObject",
    url: SITE_URL + "/dsh-plugin-icon.png",
    width: 512,
    height: 512,
  },
  sameAs: ["https://github.com/dsh-plugin-hub/dsh-plugin-hub"],
};

function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" data-theme="dark" suppressHydrationWarning>
      <body className="ds-font-sans antialiased">
        <JsonLd data={webSiteLd} />
        <JsonLd data={organizationLd} />
        {children}
      </body>
    </html>
  );
}
