import type { Metadata } from "next";
import { previewSnapshot } from "@/lib/plugin-data";
import { PluginHub } from "./plugin-hub";
import { SITE_NAME, SITE_URL } from "./layout";

// SEO：从预览快照读取实时收录数量，让标题/描述随数据同步刷新（每次部署重建）。
// detailRoutes 由 data:sync 按仓库中 app/p 目录是否存在写入预览快照，
// 保证 JSON-LD 与 sitemap 指向的详情页 URL 与当次部署一致，避免 404。
const summary = previewSnapshot.summary ?? { listed: 0, curated: 0, stars: 0 };
const listed = Number(summary.listed ?? 0);
const curated = Number(summary.curated ?? 0);
const totalStars = Number(summary.stars ?? 0);
const detailRoutes =
  (previewSnapshot as unknown as { detailRoutes?: boolean }).detailRoutes === true;
const categoriesById = (previewSnapshot.categories ?? {}) as Record<
  string,
  { en: string; zh: string }
>;

export const metadata: Metadata = {
  // 与 layout 的站点名保持一致（移除旧的 "DSH 插件资源站" absolute 覆盖）
  title: {
    absolute:
      "dsh-plugin · DeepSeek Harness 插件目录｜收录 " +
      listed +
      " 个 GitHub 真实插件",
  },
  description:
    "全网最全的 DeepSeek Harness（DSH）插件目录：收录 " +
    listed +
    " 个 GitHub 真实插件（" +
    curated +
    " 个精选），累计 " +
    totalStars +
    " 星。可查 manifest 证据、维护信号、安装命令与分类榜单。",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL + "/",
    title: "dsh-plugin · DeepSeek Harness 插件目录｜收录 " + listed + " 个插件",
    description:
      "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录：先看来源、清单和维护信号，再决定装不装。",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "dsh-plugin" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "dsh-plugin · DeepSeek Harness 插件目录｜收录 " + listed + " 个插件",
    description: "真实 GitHub 数据、manifest 证据与安装边界。",
    images: ["/og.png"],
  },
};

// JSON-LD ItemList：首页精选插件榜单（SoftwareApplication 条目，含分类/作者/星标）。
function pluginDetailUrl(plugin: { id: string }) {
  return detailRoutes ? SITE_URL + "/p/" + plugin.id : null;
}

function buildItemListLd() {
  const source =
    previewSnapshot.topStars?.length
      ? previewSnapshot.topStars
      : previewSnapshot.plugins;
  const items = (source ?? []).slice(0, 50).map((plugin, index) => {
    const category = categoriesById[plugin.category];
    const description =
      plugin.description?.zh || plugin.description?.en || plugin.name;
    return {
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "SoftwareApplication",
        name: plugin.name,
        description,
        url: pluginDetailUrl(plugin) || plugin.url,
        applicationCategory:
          category?.zh || category?.en || plugin.category || "DeveloperApplication",
        operatingSystem: "Any",
        author: {
          "@type": "Organization",
          name: plugin.owner,
          url: "https://github.com/" + plugin.owner,
        },
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        interactionStatistic:
          plugin.stars === null || plugin.stars === undefined
            ? undefined
            : {
                "@type": "InteractionCounter",
                interactionType: "https://schema.org/LikeAction",
                userInteractionCount: plugin.stars,
              },
      },
    };
  });
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: SITE_NAME + " 星标插件榜",
    description: "DeepSeek Harness 社区插件目录首页星标榜（按 GitHub stars 排序）。",
    numberOfItems: items.length,
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    itemListElement: items,
  };
}

function ItemListJsonLd() {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(buildItemListLd()) }}
    />
  );
}

/**
 * SSR 载荷瘦身：data:sync 生成的 preview.generated.json（薄切片，~200KB）
 * 已含首屏 60 条、榜单、增长序列与分类计数——这里直接透传，不再计算，
 * 全量注册表（~6MB）只作为静态资源 /plugins.json 在运行时读取。
 */
export default function Home() {
  const previewData = {
    schemaVersion: previewSnapshot.schemaVersion,
    generatedAt: previewSnapshot.generatedAt,
    automation: previewSnapshot.automation,
    sources: previewSnapshot.sources,
    summary: previewSnapshot.summary,
    categories: previewSnapshot.categories,
    plugins: previewSnapshot.plugins,
  };

  const preview = {
    growthSeries: previewSnapshot.growthSeries,
    topStars: previewSnapshot.topStars,
    topFresh: previewSnapshot.topFresh,
    categoryCounts: previewSnapshot.categoryCounts,
  };

  return (
    <>
      <ItemListJsonLd />
      <PluginHub data={previewData} preview={preview} />
    </>
  );
}
