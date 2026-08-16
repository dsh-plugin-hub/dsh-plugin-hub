
import type { PluginRecord } from "@/lib/plugin-data";

/** 按 GitHub 常用优先级探测根目录 README；默认分支失败时再试 main/master。 */
export const README_CANDIDATES = [
  "README.md",
  "readme.md",
  "README",
  "README.markdown",
  "README.txt",
] as const;

export const README_MAX_CHARS = 2_000_000;

export function readmeBranchesFor(plugin: PluginRecord): string[] {
  return [...new Set([
    plugin.defaultBranch,
    plugin.manifest?.branch,
    "main",
    "master",
  ].filter((value): value is string => typeof value === "string" && value.length > 0))];
}

export function rawReadmeUrls(plugin: PluginRecord): string[] {
  return readmeBranchesFor(plugin).flatMap((branch) =>
    README_CANDIDATES.map((name) =>
      `https://raw.githubusercontent.com/${plugin.repo}/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`,
    ),
  );
}

function encodeRepoPath(path: string): string {
  const suffixIndex = path.search(/[?#]/u);
  const cleanPath = suffixIndex === -1 ? path : path.slice(0, suffixIndex);
  const suffix = suffixIndex === -1 ? "" : path.slice(suffixIndex);
  return cleanPath.split("/").map((segment) => encodeURIComponent(segment)).join("/") + suffix;
}

export function readmeBlobUrl(plugin: PluginRecord, branch: string, path: string): string {
  return `https://github.com/${plugin.repo}/blob/${encodeURIComponent(branch)}/${encodeRepoPath(path)}`;
}

export function readmeRawUrl(plugin: PluginRecord, branch: string, path: string): string {
  return `https://raw.githubusercontent.com/${plugin.repo}/${encodeURIComponent(branch)}/${encodeRepoPath(path)}`;
}

function isExternalReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:)?\/\//iu.test(value)
    || /^(?:https?|mailto|data|tel):/iu.test(value)
    || value.startsWith("#");
}

function cleanRelativePath(value: string): string {
  return value.replace(/^\.\/+/u, "").replace(/^\/+/u, "");
}

/** README 内相对链接 -> GitHub blob 链接（外部协议与页内锚点保持原样）。 */
export function resolveReadmeHref(
  href: string | undefined,
  plugin: PluginRecord,
  branch: string,
): string | undefined {
  if (!href) return href;
  const trimmed = href.trim();
  if (!trimmed || isExternalReference(trimmed)) return trimmed;
  const path = cleanRelativePath(trimmed);
  if (!path) return readmeBlobUrl(plugin, branch, "");
  return readmeBlobUrl(plugin, branch, path);
}

/** README 内相对图片 -> raw.githubusercontent 链接（外部协议与 data URI 保持原样）。 */
export function resolveReadmeImageSrc(
  src: string | undefined,
  plugin: PluginRecord,
  branch: string,
): string | undefined {
  if (!src) return src;
  const trimmed = src.trim();
  if (!trimmed || isExternalReference(trimmed)) return trimmed;
  const path = cleanRelativePath(trimmed);
  if (!path) return readmeRawUrl(plugin, branch, "");
  return readmeRawUrl(plugin, branch, path);
}
