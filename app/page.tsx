import type { Metadata } from "next";
import { previewSnapshot } from "@/lib/plugin-data";
import { PluginHub } from "./plugin-hub";

export const metadata: Metadata = {
  // 与 layout 的站点名保持一致（移除旧的 "DSH 插件资源站" absolute 覆盖）
  title: { absolute: "dsh-plugin · DSH 插件目录" },
  description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
};

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

  return <PluginHub data={previewData} preview={preview} />;
}
