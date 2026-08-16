import type { Metadata } from "next";
import { pluginRegistry } from "@/lib/plugin-data";
import type { CategoryId } from "@/lib/plugin-data";
import { buildGrowthSeries } from "@/lib/growth";
import { PluginHub } from "./plugin-hub";

export const metadata: Metadata = {
  // 与 layout 的站点名保持一致（移除旧的 "DSH 插件资源站" absolute 覆盖）
  title: { absolute: "dsh-plugin · DSH 插件目录" },
  description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
};

/** SSR 载荷瘦身：页面只内嵌首屏薄切片，全量聚合与榜单在服务端预计算（见 DESIGN-SPEC/方案 4.2）。 */
const PREVIEW_PAGE_SIZE = 60;
const CATEGORY_ORDER: CategoryId[] = ["ui", "theme", "model", "session", "memory", "tools", "skill", "workflow", "notify", "dev", "market", "fun"];

export default function Home() {
  const active = pluginRegistry.plugins.filter((plugin) => plugin.removed !== true);

  const previewData = {
    ...pluginRegistry,
    plugins: active.slice(0, PREVIEW_PAGE_SIZE),
  };

  const categoryCounts = Object.fromEntries(CATEGORY_ORDER.map((id) => [id, 0])) as Record<CategoryId, number>;
  for (const plugin of active) categoryCounts[plugin.category] += 1;

  const preview = {
    growthSeries: buildGrowthSeries(active, pluginRegistry.generatedAt),
    topStars: [...active].filter((plugin) => plugin.stars !== null).sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 20),
    topFresh: [...active].filter((plugin) => plugin.pushedAt).sort((a, b) => Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0")).slice(0, 20),
    categoryCounts,
  };

  return <PluginHub data={previewData} preview={preview} />;
}
