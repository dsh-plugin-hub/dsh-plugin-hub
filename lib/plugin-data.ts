import rawPreview from "@/data/preview.generated.json";
import { sanitizeRegistryInstallEvidence } from "@/lib/plugin-screening.mjs";

export type Language = "zh" | "en";

/** 插件分类，对齐 awesome-dsh-plugin 实际分类（12 类）。 */
export type CategoryId =
  | "ui"
  | "theme"
  | "model"
  | "session"
  | "memory"
  | "tools"
  | "skill"
  | "workflow"
  | "notify"
  | "dev"
  | "market"
  | "fun";

export interface PluginManifest {
  state: "verified" | "package-only" | "missing" | "invalid" | "error";
  branch: string | null;
  kinds: string[];
  packageName: string | null;
  version: string | null;
  lifecycleScripts: string[];
  runtimeDependencies: number;
  declaredPaths: string[];
  invalidDeclaredPaths: string[];
}

/**
 * 纯事实字段（无判定），由 lib/plugin-screening.mjs 的 deriveFacts(manifest, meta)
 * best-effort 计算：Package.json 客观可读、不带安全结论。
 */
export interface PluginFacts {
  /** package.json 含 dsh.* 声明（manifest.state === "verified"） */
  hasManifest: boolean;
  hasLockfile: boolean;
  hasLicense: boolean;
  hasReadme: boolean;
  /** preinstall/install/postinstall/prepare 原样列出，不评判 */
  lifecycleScripts: string[];
}

export interface PluginRecord {
  id: string;
  order: number;
  name: string;
  owner: string;
  repo: string;
  url: string;
  category: CategoryId;
  description: Record<Language, string>;
  added: string | null;
  curated: boolean;
  topic: boolean;
  stars: number | null;
  forks: number | null;
  openIssues: number | null;
  watchers: number | null;
  pushedAt: string | null;
  updatedAt: string | null;
  createdAt: string | null;
  license: string | null;
  language: string | null;
  homepage: string | null;
  archived: boolean;
  defaultBranch: string | null;
  maintenance: "active" | "warm" | "quiet" | "archived" | "unknown";
  manifest: PluginManifest;
  facts: PluginFacts;
  /** 退出 topic / 仓库被删除标记 */
  removed?: boolean;
  discovery: {
    source: "curated" | "topic";
    firstSeenAt: string;
    lastSeenAt: string;
  };
}

export interface PluginRegistryData {
  schemaVersion: number;
  generatedAt: string;
  automation: {
    enabled: boolean;
    schedule: string;
    state: "bundled" | "live" | "degraded";
    scanVersion: number;
    lastRunAt: string | null;
    lastSuccessfulRunAt: string | null;
    checkedThisRun: number;
    discoveredThisRun: number;
    admittedThisRun: number;
    rejectedTotal: number;
    error: string | null;
  };
  sources: {
    curated: {
      url: string;
      repository: string;
      state: "live" | "snapshot";
      updated: string;
      count: number;
    };
    topic: {
      url: string;
      query: string;
      state: "live" | "partial" | "snapshot";
      total: number;
      scanned: number;
      matched: number;
      error: string | null;
    };
  };
  summary: {
    curated: number;
    listed: number;
    autoDiscovered: number;
    topicTotal: number;
    metadataMatches: number;
    manifestMatches: number;
    owners: number;
    stars: number;
  };
  categories: Record<CategoryId, Record<Language, string>>;
  plugins: PluginRecord[];
}

/**
 * SSR 预览快照（~200KB 薄切片）：data:sync 从全量注册表派生，
 * 包含 summary/categories/首屏 60 条/star 榜/新鲜榜/增长序列/分类计数。
 * 全量数据不再进打包器（历史教训：vite-plugin-commonjs 在 ~6MB 的
 * plugins.generated.json 上 String.replace 栈溢出），改为静态资源
 * /plugins.json 运行时读取。
 */
export interface PreviewSnapshot extends PluginRegistryData {
  topStars: PluginRecord[];
  topFresh: PluginRecord[];
  growthSeries: Array<{ date: string; added: number; total: number }>;
  categoryCounts: Record<CategoryId, number>;
}

export const previewSnapshot = rawPreview as unknown as PreviewSnapshot;
