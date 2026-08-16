
import type { Metadata } from "next";
import { PluginDetailLoader } from "@/components/plugin-detail-loader";
import { previewSnapshot } from "@/lib/plugin-data";
import type { PluginRecord } from "@/lib/plugin-data";

interface PluginRouteProps {
  params: Promise<{ owner: string; repo: string }>;
}

function previewPlugins(): PluginRecord[] {
  return [
    ...previewSnapshot.plugins,
    ...(previewSnapshot.topStars ?? []),
    ...(previewSnapshot.topFresh ?? []),
  ];
}

function findPreviewPlugin(owner: string, repo: string) {
  const id = `${owner}/${repo}`.toLowerCase();
  return previewPlugins().find((plugin) => plugin.id.toLowerCase() === id) ?? null;
}

export async function generateMetadata({ params }: PluginRouteProps): Promise<Metadata> {
  const { owner, repo } = await params;
  const plugin = findPreviewPlugin(owner, repo);
  // plugin.repo 已是全名 "owner/repo"（不再叠加 plugin.owner，避免标题双重前缀）
  const title = plugin
    ? `${plugin.repo} — ${plugin.name}`
    : `${owner}/${repo}`;
  const description = plugin
    ? plugin.description?.zh || plugin.description?.en || plugin.name
    : "DeepSeek Harness 社区插件详情：README、安装命令与仓库事实。";

  return {
    title,
    description,
    alternates: {
      canonical: `/p/${owner}/${repo}`,
    },
    openGraph: {
      type: "website",
      title,
      description,
      url: `/p/${owner}/${repo}`,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default async function PluginRoute({ params }: PluginRouteProps) {
  const { owner, repo } = await params;
  const plugin = findPreviewPlugin(owner, repo);

  return (
    <PluginDetailLoader
      owner={owner}
      repo={repo}
      initialPlugin={plugin}
      categories={previewSnapshot.categories}
    />
  );
}

