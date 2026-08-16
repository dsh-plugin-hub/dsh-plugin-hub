import type { Metadata } from "next";
import { pluginRegistry } from "@/lib/plugin-data";
import { PluginHub } from "./plugin-hub";

export const metadata: Metadata = {
  // 与 layout 的站点名保持一致（移除旧的 "DSH 插件资源站" absolute 覆盖）
  title: { absolute: "dsh-plugin · DSH 插件目录" },
  description: "基于 GitHub 真实数据的 DeepSeek Harness 社区插件目录与安装证据索引。",
};

export default function Home() {
  return <PluginHub data={pluginRegistry} />;
}
