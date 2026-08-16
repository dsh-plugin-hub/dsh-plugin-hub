"use client";

import type {
  CategoryId,
  Language,
  PluginFacts,
  PluginRecord,
  PluginRegistryData,
} from "@/lib/plugin-data";
import { installCommandFor } from "@/lib/plugin-screening.mjs";
import { buildGrowthSeries, type GrowthPoint } from "@/lib/growth";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AuroraBackground from "@/components/aurora-background";

type PageId = "home" | "catalog" | "rank" | "submit" | "guide";
type SortId = "curated" | "stars" | "updated" | "added" | "name";
type EvidenceFilter = "all" | "curated" | "topic" | "manifest" | "favorites";
type ViewId = "list" | "cards";
type VisitStats = {
  available: boolean;
  displayCount: number | null;
  realCount: number | null;
  multiplier: number;
  historicalCount: number | null;
};

const PAGES: Array<{ id: PageId; zh: string; en: string }> = [
  { id: "home", zh: "首页", en: "Home" },
  { id: "catalog", zh: "目录", en: "Catalog" },
  { id: "rank", zh: "排行榜", en: "Leaderboard" },
  { id: "submit", zh: "收录", en: "Get listed" },
  { id: "guide", zh: "开发指南", en: "Build one" },
];

/** 12 类齐全（awesome-dsh-plugin 实际分类） */
const CATEGORY_ORDER: CategoryId[] = [
  "ui",
  "theme",
  "model",
  "session",
  "memory",
  "tools",
  "skill",
  "workflow",
  "notify",
  "dev",
  "market",
  "fun",
];

const CATEGORY_HINTS: Record<CategoryId, Record<Language, string>> = {
  ui: { zh: "侧栏、面板、交互体验", en: "Panels, navigation, interaction" },
  theme: { zh: "主题、配色与外观", en: "Themes, colors, appearance" },
  model: { zh: "模型与账号接入", en: "Models & providers" },
  session: { zh: "会话、消息与历史", en: "Sessions & messages" },
  memory: { zh: "记忆与知识库", en: "Memory & knowledge" },
  tools: { zh: "工具与能力扩展", en: "Tools & capabilities" },
  skill: { zh: "技能包与提示词", en: "Skills & prompts" },
  workflow: { zh: "工作流与自动化", en: "Workflow & automation" },
  notify: { zh: "通知与消息推送", en: "Notifications & bridges" },
  dev: { zh: "开发、沙箱与体检", en: "Dev, sandbox, audits" },
  market: { zh: "市场与安装器", en: "Markets & installers" },
  fun: { zh: "桌宠、游戏与趣味", en: "Pets, games, fun" },
};

const PREFS_KEY = "dsh-plugin-hub-prefs-v2";

/** 防御性默认：旧结构数据没有 facts 字段时全部视为 false（P1-T4 重生成前兼容） */
const EMPTY_FACTS: PluginFacts = {
  hasManifest: false,
  hasLockfile: false,
  hasLicense: false,
  hasReadme: false,
  lifecycleScripts: [],
};

/** 目录分页页大小（与 /api/plugins 服务端契约一致；Worker 侧上限 100） */
const PAGE_SIZE = 60;

/** /api/plugins 分页响应（P1-T5 服务端契约：{schemaVersion, generatedAt, total, page, pageSize, items, categories, summary}） */
interface CatalogPageResponse {
  schemaVersion?: number;
  generatedAt?: string | null;
  total: number;
  page: number;
  pageSize: number;
  items: PluginRecord[];
  categories?: PluginRegistryData["categories"];
  summary?: PluginRegistryData["summary"];
}

function factsOf(plugin: PluginRecord): PluginFacts {
  const raw = (plugin as { facts?: PluginFacts }).facts;
  if (!raw || typeof raw !== "object") return EMPTY_FACTS;
  return {
    hasManifest: raw.hasManifest === true,
    hasLockfile: raw.hasLockfile === true,
    hasLicense: raw.hasLicense === true,
    hasReadme: raw.hasReadme === true,
    lifecycleScripts: Array.isArray(raw.lifecycleScripts)
      ? raw.lifecycleScripts.filter((name): name is string => typeof name === "string")
      : [],
  };
}

/**
 * 快照/收藏视图的客户端过滤 + 排序（字段与 /api/plugins 的 q 参数一致；
 * 仅用于首屏 SSR 预览与「只看收藏」本地视图，live 分页数据由服务端过滤）。
 */
function clientFilter(
  list: PluginRecord[],
  opts: {
    query: string;
    category: "all" | CategoryId;
    sort: SortId;
    evidence: EvidenceFilter;
    favorites: string[];
    categories: PluginRegistryData["categories"];
  },
): PluginRecord[] {
  const { query, category, sort, evidence, favorites, categories } = opts;
  const normalized = query.trim().toLowerCase();
  const rows = list.filter((plugin) => {
    if (category !== "all" && plugin.category !== category) return false;
    if (evidence === "curated" && !plugin.curated) return false;
    if (evidence === "topic" && !plugin.topic) return false;
    if (evidence === "manifest" && !(factsOf(plugin).hasManifest || plugin.manifest?.state === "verified")) return false;
    if (evidence === "favorites" && !favorites.includes(plugin.id)) return false;
    if (!normalized) return true;
    return [
      plugin.name,
      plugin.owner,
      plugin.repo,
      plugin.description?.zh || "",
      plugin.description?.en || "",
      categories[plugin.category]?.zh || "",
      plugin.manifest?.packageName || "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalized);
  });

  return rows.sort((a, b) => {
    if (sort === "stars") return (b.stars ?? -1) - (a.stars ?? -1) || a.order - b.order;
    if (sort === "updated") return Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0");
    if (sort === "added") return (b.added || "").localeCompare(a.added || "") || a.order - b.order;
    if (sort === "name") return a.name.localeCompare(b.name);
    return a.order - b.order;
  });
}

function text(lang: Language, zh: string, en: string) {
  return lang === "zh" ? zh : en;
}

function formatNumber(value: number | null, lang: Language) {
  if (value === null) return "—";
  return new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en-US", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

function dayDistance(value: string | null) {
  if (!value) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function relativeDate(value: string | null, lang: Language) {
  const days = dayDistance(value);
  if (days === null) return "—";
  if (days === 0) return text(lang, "今天", "today");
  if (days < 30) return text(lang, `${days} 天前`, `${days}d ago`);
  if (days < 365) return text(lang, `${Math.floor(days / 30)} 个月前`, `${Math.floor(days / 30)}mo ago`);
  return text(lang, `${Math.floor(days / 365)} 年前`, `${Math.floor(days / 365)}y ago`);
}

function shortDate(value: string, lang: Language) {
  return new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function sourceLabel(plugin: PluginRecord) {
  if (!plugin.curated) return "AUTO";
  return plugin.topic ? "TOPIC + LIST" : "LIST";
}

function categoryLabelOf(data: PluginRegistryData, plugin: PluginRecord, lang: Language) {
  return data.categories[plugin.category]?.[lang] ?? plugin.category;
}

function growthChartGeometry(series: GrowthPoint[]) {
  const width = 760;
  const height = 250;
  const top = 20;
  const bottom = 214;
  const left = 18;
  const right = 18;
  const firstTime = Date.parse(`${series[0].date}T00:00:00Z`);
  const lastTime = Date.parse(`${series.at(-1)?.date || series[0].date}T00:00:00Z`);
  const duration = Math.max(86_400_000, lastTime - firstTime);
  const maxTotal = Math.max(1, ...series.map((point) => point.total));
  const points = series.map((point) => ({
    ...point,
    x: left + ((Date.parse(`${point.date}T00:00:00Z`) - firstTime) / duration) * (width - left - right),
    y: bottom - (point.total / maxTotal) * (bottom - top),
  }));
  let line = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const middle = (previous.x + current.x) / 2;
    line += ` C ${middle} ${previous.y}, ${middle} ${current.y}, ${current.x} ${current.y}`;
  }
  const first = points[0];
  const last = points.at(-1) || first;
  return {
    width,
    height,
    bottom,
    points,
    line,
    area: `${line} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`,
  };
}

function pageFromHash(): PageId {
  if (typeof window === "undefined") return "home";
  let value = window.location.hash;
  if (value.startsWith("#")) value = value.slice(1);
  if (value.startsWith("/")) value = value.slice(1);
  const separator = value.search(/[?/]/u);
  if (separator !== -1) value = value.slice(0, separator);
  return PAGES.some((page) => page.id === value) ? (value as PageId) : "home";
}

/* ------------------------------------------------------------------ *
 * 小部件
 * ------------------------------------------------------------------ */

function FactBadges({ plugin, lang }: { plugin: PluginRecord; lang: Language }) {
  const facts = factsOf(plugin);
  const badges: string[] = [];
  if (facts.hasManifest) badges.push(text(lang, "manifest 已核验", "manifest verified"));
  if (facts.lifecycleScripts.length) {
    const names = facts.lifecycleScripts.slice(0, 2).join(" · ");
    badges.push(text(lang, `安装时运行 ${names}`, `runs ${names} on install`));
  }
  if (facts.hasLicense) badges.push(text(lang, "有许可证", "licensed"));
  if (facts.hasLockfile) badges.push(text(lang, "有锁文件", "lockfile"));
  if (facts.hasReadme) badges.push(text(lang, "有 README", "README"));
  if (!badges.length) badges.push(text(lang, "事实待补全", "facts pending"));
  return (
    <span className="ds-card__badges">
      {badges.map((badge, index) => (
        <span
          className={index === 0 && facts.hasManifest ? "ds-badge ds-badge--brand" : "ds-badge"}
          key={index}
        >
          {badge}
        </span>
      ))}
    </span>
  );
}

function TerminalBlock({
  command,
  copiedId,
  id,
  lang,
  onCopy,
}: {
  command: string | null;
  copiedId: string | null;
  id: string;
  lang: Language;
  onCopy: (value: string, id: string) => void;
}) {
  if (!command) {
    return (
      <p className="ds-muted-note">
        {text(lang, "仓库地址无效，无法派生安装命令", "Invalid repository path; install command unavailable")}
      </p>
    );
  }
  return (
    <div className="ds-terminal">
      <span className="ds-terminal__prompt" aria-hidden="true">$</span>
      <code title={command}>{command}</code>
      <button className="ds-terminal__copy" type="button" onClick={() => onCopy(command, id)}>
        {copiedId === id ? text(lang, "已复制", "Copied") : text(lang, "复制", "Copy")}
      </button>
    </div>
  );
}

function PluginCard({
  plugin,
  lang,
  categoryLabel,
  favorite,
  onFavorite,
  view,
  copiedId,
  onCopy,
}: {
  plugin: PluginRecord;
  lang: Language;
  categoryLabel: string;
  favorite: boolean;
  onFavorite: () => void;
  view: ViewId;
  copiedId: string | null;
  onCopy: (value: string, id: string) => void;
}) {
  const command = installCommandFor(plugin.repo);
  const detailHref = `/p/${plugin.id}`;
  return (
    <article className={`ds-card ds-card--${view}`}>
      <div className="ds-card__head">
        <span className="ds-card__num">№ {String(plugin.order + 1).padStart(3, "0")}</span>
        <span className="ds-card__head-side">
          <span className="ds-source-badge">{sourceLabel(plugin)}</span>
          <button
            className={`ds-fav ${favorite ? "is-active" : ""}`}
            type="button"
            onClick={onFavorite}
            aria-label={text(lang, favorite ? "取消收藏" : "收藏", favorite ? "Remove favorite" : "Save favorite")}
            title={text(lang, favorite ? "取消收藏" : "收藏", favorite ? "Remove favorite" : "Save favorite")}
          >
            {favorite ? "★" : "☆"}
          </button>
        </span>
      </div>
      <a className="ds-card__title" href={detailHref}>
        <span className="ds-card__name">{plugin.name}</span>
      </a>
      <span className="ds-card__owner">{plugin.owner} · {categoryLabel}</span>
      <p className="ds-card__desc">{plugin.description[lang]}</p>
      <FactBadges plugin={plugin} lang={lang} />
      <span className="ds-card__meta">
        <span>★ <b>{formatNumber(plugin.stars, lang)}</b></span>
        <span>{relativeDate(plugin.pushedAt, lang)}</span>
        <span>{plugin.license || text(lang, "无许可证", "No license")}</span>
      </span>
      <TerminalBlock command={command} copiedId={copiedId} id={plugin.id} lang={lang} onCopy={onCopy} />
      <div className="ds-card__foot">
        <a className="ds-btn ds-btn--ghost ds-btn--xs" href={detailHref}>
          {text(lang, "详情", "Details")} <span aria-hidden="true">→</span>
        </a>
        <a className="ds-link" href={plugin.url} target="_blank" rel="noreferrer">
          {text(lang, "GitHub", "GitHub")} <span aria-hidden="true">↗</span>
        </a>
      </div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="ds-skeleton-grid" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="ds-skeleton ds-skeleton--card" key={index}>
          <div className="ds-skeleton ds-skeleton--line" style={{ width: "58%", margin: "24px 24px 0" }} />
          <div className="ds-skeleton ds-skeleton--line" style={{ width: "82%", margin: "14px 24px 0" }} />
          <div className="ds-skeleton ds-skeleton--line" style={{ width: "46%", margin: "14px 24px 0" }} />
        </div>
      ))}
    </div>
  );
}

function SearchGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function GitHubGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.093.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.455-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.031 1.531 1.031.892 1.529 2.341 1.087 2.91.831.091-.647.349-1.087.635-1.337-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.295 2.747-1.026 2.747-1.026.546 1.378.203 2.398.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.847-2.337 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.34-.012 2.421-.012 2.75 0 .268.18.58.688.481A10.025 10.025 0 0 0 22 12.021C22 6.484 17.523 2 12 2Z" />
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * 主组件
 * ------------------------------------------------------------------ */

export function PluginHub({
  data: initialData,
  preview,
}: {
  data: PluginRegistryData;
  /** 服务端基于全量注册表预计算的聚合与榜单预览（SSR 只内嵌首屏薄切片时使用） */
  preview?: {
    growthSeries: GrowthPoint[];
    topStars: PluginRecord[];
    topFresh: PluginRecord[];
    categoryCounts: Record<CategoryId, number>;
  };
}) {
  const [data, setData] = useState(initialData);
  const [registrySource, setRegistrySource] = useState<"bundled" | "live">("bundled");
  const [page, setPage] = useState<PageId>("home");
  const [lang, setLang] = useState<Language>("zh");
  // 主题默认深色（对齐 layout 的 data-theme="dark"；水合后由 effect 写回 documentElement）
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [heroVisible, setHeroVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | CategoryId>("all");
  const [sort, setSort] = useState<SortId>("curated");
  const [view, setView] = useState<ViewId>("cards");
  const [evidence, setEvidence] = useState<EvidenceFilter>("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [visitStats, setVisitStats] = useState<VisitStats | null>(null);

  // —— 目录分页状态（P1-T5）：首屏用 SSR 快照预览，水合后按需从 /api/plugins 分页拉取 ——
  // catalog 以「请求键」（q|category|sort）标记：键不匹配时展示层自动回落到快照预览，
  // 无需在 effect 里同步清空（派生式重置，避免级联渲染）。
  const [catalog, setCatalog] = useState<{
    key: string;
    items: PluginRecord[];
    total: number;
    nextPage: number;
    hasMore: boolean;
    loaded: boolean;
  }>({ key: "", items: [], total: 0, nextPage: 2, hasMore: false, loaded: false });
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const requestSeq = useRef(0);
  const loadingRef = useRef(false);
  const itemsRef = useRef<PluginRecord[]>([]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    const restoreTimer = window.setTimeout(() => {
      setPage(pageFromHash());
      try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
        if (saved.lang === "zh" || saved.lang === "en") setLang(saved.lang);
        if (saved.theme === "dark" || saved.theme === "light") setTheme(saved.theme);
        if (saved.view === "list" || saved.view === "cards") setView(saved.view);
        if (Array.isArray(saved.favorites)) setFavorites(saved.favorites);
      } catch {
        // Keep defaults when a browser contains malformed old preferences.
      } finally {
        setPreferencesReady(true);
      }
    }, 0);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("hashchange", onHash);
    };
  }, []);

  // 滚动后 header 玻璃化（is-scrolled）
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // hero 背景淡入（opacity 0→1）
  useEffect(() => {
    const frame = requestAnimationFrame(() => setHeroVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // 搜索 300ms 防抖：query 输入实时更新 UI，防抖后触发目录分页重拉（page=1）
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    fetch("/api/visits", {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Visit metrics request failed: ${response.status}`);
        const next = await response.json() as VisitStats;
        if (typeof next.multiplier !== "number" || typeof next.available !== "boolean") {
          throw new Error("Visit metrics response has an invalid shape");
        }
        setVisitStats(next);
      })
      .catch(() => {
        // Traffic metrics are optional; the registry remains fully usable.
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, []);

  // 主题同步：水合后写回 html[data-theme]（与 layout 默认 dark 一致，无闪白）
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (!preferencesReady) return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ lang, theme, view, favorites }));
    } catch {
      // Preferences are optional when storage is unavailable.
    }
  }, [favorites, lang, preferencesReady, theme, view]);

  const go = useCallback((next: PageId) => {
    setPage(next);
    window.history.pushState(null, "", `#/${next}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, []);

  const copy = useCallback(async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(id);
      window.setTimeout(() => setCopied((current) => (current === id ? null : current)), 1500);
    } catch {
      setCopied(null);
    }
  }, []);

  const isFavoritesView = evidence === "favorites";

  /**
   * 证据筛选谓词：curated/topic/manifest 无服务端支持，客户端附加过滤。
   * manifest 同时认 facts.hasManifest 与 manifest.state==="verified"（T4 数据迁移期两字段可能不同步）。
   * 不依赖 favorites：收藏视图不请求服务端（clientFilter 内联处理），避免收藏切换触发目录重拉。
   */
  const matchesEvidence = useCallback((plugin: PluginRecord) => {
    if (evidence === "curated") return plugin.curated === true;
    if (evidence === "topic") return plugin.topic === true;
    if (evidence === "manifest") return factsOf(plugin).hasManifest || plugin.manifest?.state === "verified";
    return true;
  }, [evidence]);

  /** 目录当前请求键：q|category|sort（evidence 为客户端附加筛选，不参与键） */
  const catalogKey = `${debouncedQuery}${category}${sort}`;
  const catalogIsCurrent = catalog.key === catalogKey;
  /** 第一页拉取进行中（键不匹配即视为在途；收藏视图不请求服务端） */
  const page1Pending = !isFavoritesView && !catalogIsCurrent;

  /**
   * 拉取 /api/plugins 分页数据（P1-T5 服务端契约：?q=&category=&sort=&page=&pageSize=）。
   * key 标记这批数据属于哪个筛选组合；append=false 重置为第一页。
   * 稀疏证据筛选（curated/topic/manifest）会在同一次调用内连续补齐到一页（客户端过滤无
   * 服务端支持）。所有 setState 均在 await 之后的异步续段执行；并发由 loadingRef + requestSeq 防重。
   */
  const fetchPage = useCallback(async (key: string, page: number, append: boolean) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const seq = ++requestSeq.current;
    const timer = window.setTimeout(() => controller.abort(), 8_000);
    const sparseEvidence = evidence !== "all" && evidence !== "favorites";
    const accumulator = append ? [...itemsRef.current] : [];
    try {
      let currentPage = page;
      for (;;) {
        const params = new URLSearchParams();
        const trimmed = debouncedQuery.trim();
        if (trimmed) params.set("q", trimmed);
        if (category !== "all") params.set("category", category);
        params.set("sort", sort);
        params.set("page", String(currentPage));
        params.set("pageSize", String(PAGE_SIZE));
        const response = await fetch(`/api/plugins?${params.toString()}`, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`Registry request failed: ${response.status}`);
        const next = (await response.json()) as CatalogPageResponse;
        if (!next || !Array.isArray(next.items) || typeof next.total !== "number" || !next.summary || !next.categories) {
          throw new Error("Registry response has an invalid shape");
        }
        if (seq !== requestSeq.current) return; // 已被更新的筛选请求取代
        const pageSize = Math.max(1, next.pageSize || PAGE_SIZE);
        accumulator.push(...next.items);
        currentPage = next.page + 1;
        const hasMore = next.total > next.page * pageSize || next.items.length >= pageSize;
        itemsRef.current = accumulator;
        setCatalog({ key, items: [...accumulator], total: next.total, nextPage: currentPage, hasMore, loaded: true });
        // 用 live 响应的 summary/categories/generatedAt 覆盖快照（registrySource bundled→live）
        setData((prev) => ({
          ...prev,
          schemaVersion: next.schemaVersion ?? prev.schemaVersion,
          generatedAt: next.generatedAt ?? prev.generatedAt,
          categories: next.categories ?? prev.categories,
          summary: next.summary ?? prev.summary,
        }));
        const source = response.headers.get("x-registry-source");
        setRegistrySource(source === "cloudflare-d1" || source === "cloudflare-kv" ? "live" : "bundled");
        if (!sparseEvidence) break;
        const visibleCount = accumulator.filter((plugin) => matchesEvidence(plugin)).length;
        if (visibleCount >= PAGE_SIZE || !hasMore) break;
      }
    } catch (error) {
      // 网络/解析失败：静默保留 SSR 快照预览，站点仍可用
      if (seq === requestSeq.current && !(error instanceof Error && error.name === "AbortError")) {
        console.error(JSON.stringify({
          event: "catalog.fetch.error",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    } finally {
      window.clearTimeout(timer);
      if (seq === requestSeq.current) {
        loadingRef.current = false;
      }
    }
  }, [category, debouncedQuery, evidence, matchesEvidence, sort]);

  // 过滤条件（q/category/sort/evidence）变化 → 重拉第一页；收藏视图走本地快照
  useEffect(() => {
    if (evidence === "favorites") return;
    void fetchPage(catalogKey, 1, false);
    return () => {
      requestRef.current?.abort();
      requestSeq.current += 1;
      loadingRef.current = false;
    };
  }, [catalogKey, evidence, fetchPage]);

  /** 目录内可见插件：removed=true 默认隐藏（打「已下架」标记的只在详情出现） */
  const visiblePlugins = useMemo(
    () => data.plugins.filter((plugin) => plugin.removed !== true),
    [data.plugins],
  );

  const categoryCounts = useMemo(
    () => preview?.categoryCounts ?? (() => {
      const counts = Object.fromEntries(CATEGORY_ORDER.map((id) => [id, 0])) as Record<CategoryId, number>;
      for (const plugin of visiblePlugins) counts[plugin.category] += 1;
      return counts;
    })(),
    [preview?.categoryCounts, visiblePlugins],
  );

  /** 收藏对象池：SSR 快照优先，live 分页中出现的收藏插件也并入（覆盖快照外的新插件） */
  const favoriteObjects = useMemo(() => {
    const pool = new Map<string, PluginRecord>();
    for (const plugin of data.plugins) pool.set(plugin.id, plugin);
    for (const plugin of catalog.items) if (!pool.has(plugin.id)) pool.set(plugin.id, plugin);
    return favorites
      .map((id) => pool.get(id))
      .filter((plugin): plugin is PluginRecord => Boolean(plugin));
  }, [catalog.items, data.plugins, favorites]);

  const favoritesFiltered = useMemo(
    () => clientFilter(favoriteObjects, { query, category, sort, evidence: "favorites", favorites, categories: data.categories }),
    [category, data.categories, favoriteObjects, favorites, query, sort],
  );

  /** 首屏/兜底预览：SSR 快照客户端过滤（与服务端分页参数一致），live 数据到达前渲染 */
  const previewFiltered = useMemo(
    () => (isFavoritesView
      ? favoritesFiltered
      : clientFilter(visiblePlugins, { query, category, sort, evidence, favorites, categories: data.categories })),
    [category, data.categories, evidence, favorites, favoritesFiltered, isFavoritesView, query, sort, visiblePlugins],
  );
  const previewItems = previewFiltered.slice(0, PAGE_SIZE);

  /** 服务端分页累积项：按页序补展示序号（№），evidence 为客户端附加筛选 */
  const visibleItems = useMemo(() => {
    const numbered = catalog.items.map((plugin, index) => ({ ...plugin, order: index }));
    return numbered.filter((plugin) => matchesEvidence(plugin));
  }, [catalog.items, matchesEvidence]);

  /** 目录实际渲染列表：收藏视图 → 本地；live 已到达 → 分页项；否则 → SSR 快照预览 */
  const displayItems = useMemo(
    () => (isFavoritesView ? favoritesFiltered : catalogIsCurrent && catalog.loaded ? visibleItems : previewItems),
    [catalog.loaded, catalogIsCurrent, favoritesFiltered, isFavoritesView, previewItems, visibleItems],
  );

  /** 结果计数：live total 到达前用快照过滤数兜底（「共 N 个插件」） */
  const resultCount = isFavoritesView
    ? favoritesFiltered.length
    : catalogIsCurrent && catalog.loaded
      ? (evidence === "all" ? catalog.total : visibleItems.length)
      : previewFiltered.length;

  // 无限滚动：哨兵元素进入视口（提前 600px）自动加载下一页；「加载更多」按钮同效。
  // 稀疏证据筛选的自动补齐在 fetchPage 内部连续完成，这里只处理用户滚动触发的追加页。
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (catalogIsCurrent && catalog.hasMore && !loadingRef.current) {
            void fetchPage(catalogKey, catalog.nextPage, true);
          }
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [catalog.hasMore, catalog.nextPage, catalogIsCurrent, catalogKey, fetchPage]);

  const topStars = useMemo(
    () => preview?.topStars ?? [...visiblePlugins].filter((plugin) => plugin.stars !== null).sort((a, b) => (b.stars || 0) - (a.stars || 0)).slice(0, 20),
    [preview?.topStars, visiblePlugins],
  );
  const topFresh = useMemo(
    () => preview?.topFresh ?? [...visiblePlugins].filter((plugin) => plugin.pushedAt).sort((a, b) => Date.parse(b.pushedAt || "0") - Date.parse(a.pushedAt || "0")).slice(0, 20),
    [preview?.topFresh, visiblePlugins],
  );
  const featured = topStars.slice(0, 6);
  const growthSeries = useMemo(
    () => preview?.growthSeries ?? buildGrowthSeries(visiblePlugins, data.generatedAt),
    [data.generatedAt, preview?.growthSeries, visiblePlugins],
  );
  const growthChart = useMemo(() => growthChartGeometry(growthSeries), [growthSeries]);
  const currentGrowth = growthSeries.at(-1) || { date: data.generatedAt.slice(0, 10), added: 0, total: data.summary.listed };
  const latestGrowth = [...growthSeries].reverse().find((point) => point.added > 0) || currentGrowth;
  const firstGrowth = growthSeries.find((point) => point.total > 0) || currentGrowth;
  const generatedLabel = data.generatedAt.slice(0, 16).replace("T", " ") + " UTC";
  const automationLabel = data.automation.state === "live"
    ? text(lang, "云端巡检正常", "Cloud scan healthy")
    : data.automation.state === "degraded"
      ? text(lang, "巡检部分降级", "Scan partially degraded")
      : text(lang, "等待首次云端巡检", "Awaiting first cloud scan");
  const channelLabel = registrySource === "live"
    ? text(lang, "KV 实时目录", "Live KV registry")
    : text(lang, "内置数据兜底", "Bundled fallback");

  return (
    <div className="ds-page" data-lang={lang} data-page={page}>
      <header className={`ds-header${scrolled ? " is-scrolled" : ""}`}>
        <div className="ds-header__bar">
          <button className="ds-brand" type="button" onClick={() => go("home")} aria-label={text(lang, "返回首页", "Back home")}>
            <span className="ds-brand__mark">dsh</span>
            <span className="ds-brand__name">dsh-plugin</span>
          </button>
          <nav className="ds-nav ds-nav--desktop" aria-label={text(lang, "主导航", "Main navigation")}>
            {PAGES.map((item) => (
              <button
                className={`ds-nav__link${page === item.id ? " is-active" : ""}`}
                type="button"
                key={item.id}
                onClick={() => go(item.id)}
              >
                {item[lang]}
              </button>
            ))}
          </nav>
          <div className="ds-header__actions">
            <div
              className="ds-visit"
              title={visitStats?.available
                ? text(lang, "网站访问量", "Site views")
                : text(lang, "访问数据加载中", "Loading visit metrics")}
              aria-label={text(
                lang,
                `访问量 ${formatNumber(visitStats?.displayCount ?? null, lang)}`,
                `${formatNumber(visitStats?.displayCount ?? null, lang)} views`,
              )}
            >
              <span>{text(lang, "访问量", "Views")}</span>
              <strong>{formatNumber(visitStats?.displayCount ?? null, lang)}</strong>
            </div>
            <div className="ds-locale-toggle" role="group" aria-label={text(lang, "语言", "Language")}>
              <button className={lang === "zh" ? "is-active" : ""} type="button" onClick={() => setLang("zh")} aria-pressed={lang === "zh"}>
                {text(lang, "中文", "中文")}
              </button>
              <button className={lang === "en" ? "is-active" : ""} type="button" onClick={() => setLang("en")} aria-pressed={lang === "en"}>
                EN
              </button>
            </div>
            <button
              className="ds-icon-btn"
              type="button"
              onClick={() => setTheme((current) => (current === "dark" ? "light" : "dark"))}
              aria-label={text(lang, theme === "dark" ? "切换到浅色主题" : "切换到深色主题", theme === "dark" ? "Switch to light theme" : "Switch to dark theme")}
              title={text(lang, "切换主题", "Toggle theme")}
            >
              {theme === "dark" ? <SunGlyph /> : <MoonGlyph />}
            </button>
            <button
              className={`ds-fav-count${evidence === "favorites" ? " is-active" : ""}`}
              type="button"
              onClick={() => {
                setEvidence("favorites");
                go("catalog");
              }}
              title={text(lang, "查看收藏", "View favorites")}
              aria-label={text(lang, `查看收藏（${favorites.length}）`, `View favorites (${favorites.length})`)}
            >
              ★ <span>{favorites.length}</span>
            </button>
            <a
              className="ds-icon-btn ds-icon-btn--github"
              href="https://github.com/cclank/dsh-plugin-hub"
              target="_blank"
              rel="noreferrer"
              aria-label={text(lang, "在 GitHub 查看开源代码", "View source on GitHub")}
              title={text(lang, "GitHub 开源仓库", "GitHub repository")}
            >
              <GitHubGlyph />
            </a>
          </div>
        </div>
        <nav className="ds-header__navrow" aria-label={text(lang, "主导航（移动端）", "Main navigation (mobile)")}>
          {PAGES.map((item) => (
            <button
              className={`ds-nav__link${page === item.id ? " is-active" : ""}`}
              type="button"
              key={item.id}
              onClick={() => go(item.id)}
            >
              {item[lang]}
            </button>
          ))}
        </nav>
      </header>

      <main className={page === "home" ? "" : "ds-main--page"}>
        {page === "home" && (
          <>
            <section className="ds-hero">
              {/* 暗色 fluid shader + 局部点阵 + 底部渐隐；保留本站原有居中信息布局。 */}
              <div
                className="ds-hero__bg"
                aria-hidden="true"
                style={{
                  opacity: heroVisible ? 1 : 0,
                  transition: "opacity 1.4s ease",
                }}
              >
                <AuroraBackground
                  type="fluid"
                  colors={["#02060D", "#16386D", "#2869AE", "#9ABEFF", "#05070C"]}
                  glowColors={["#D9E8FF", "#5E9DF1", "#5347D9"]}
                  speed={28}
                  scale={1.77}
                  mouseRadius={0.09}
                  mouseStrength={1.8}
                  mouseSmoothing={0.1}
                  mouseVelocity={0.2}
                  decay={0.925}
                  distortBoost={2.2}
                  noiseBoost={0.3}
                  swirlBoost={0.8}
                  glowIntensity={0.13}
                  offset={[-1.24, -0.48]}
                  grain={0.005}
                  lightPos={[0.89, 0.46]}
                  lightCore={0.14}
                  lightHalo={0.2}
                  vignette={0.38}
                  bloomThreshold={0.61}
                  bloomRange={0.18}
                  bloomStrength={0.4}
                />
              </div>
              <div className="ds-hero__matrix" aria-hidden="true" />
              <div className="ds-hero__glow" aria-hidden="true" />
              <div className="ds-hero__shade" aria-hidden="true" />
              <div className="ds-hero__content">
                <div className="ds-container ds-hero__inner">
                  <p className="ds-eyebrow ds-hero-enter ds-hero-enter--label">
                    <span className="ds-hero__status-dot" aria-hidden="true" />
                    DSH PLUGIN DIRECTORY · {automationLabel} · {channelLabel} · 30 MIN
                  </p>
                  <h1 className="ds-text-hero ds-hero-enter ds-hero-enter--title">
                    {text(lang, "一切皆插件。\n先看证据，再决定装不装。", "Everything is a plugin.\nCheck the evidence before you install.")}
                  </h1>
                  <p className="ds-hero-enter ds-hero-enter--desc">
                    {text(
                      lang,
                      `当前展示 ${data.summary.listed} 个插件，其中 ${data.summary.autoDiscovered} 个由网站自动发现、${data.summary.curated} 个来自社区精选；${data.summary.manifestMatches} 个已核验 manifest。每 30 分钟巡检 GitHub 元数据与仓库事实。`,
                      `${data.summary.listed} plugins are listed — ${data.summary.autoDiscovered} auto-discovered and ${data.summary.curated} community-curated; ${data.summary.manifestMatches} have a verified manifest. GitHub metadata and repository facts are checked every 30 minutes.`,
                    )}
                  </p>
                  <form
                    className="ds-search ds-hero__search ds-hero-enter ds-hero-enter--actions"
                    role="search"
                    onSubmit={(event) => {
                      event.preventDefault();
                      go("catalog");
                    }}
                  >
                    <SearchGlyph />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={text(lang, "搜索插件名称、作者、能力或包名", "Search name, author, capability, package")}
                      aria-label={text(lang, "搜索插件", "Search plugins")}
                    />
                    {query && (
                      <button className="ds-search__clear" type="button" onClick={() => setQuery("")} aria-label={text(lang, "清空搜索", "Clear search")}>
                        ×
                      </button>
                    )}
                  </form>
                  <div className="ds-hero__actions ds-hero-enter ds-hero-enter--actions">
                    <button className="ds-btn ds-btn--primary ds-btn--m" type="button" onClick={() => go("catalog")}>
                      {text(lang, "浏览插件目录", "Browse catalog")} <span aria-hidden="true">→</span>
                    </button>
                    <a className="ds-btn ds-btn--secondary ds-btn--m" href={data.sources.curated.repository} target="_blank" rel="noreferrer">
                      {text(lang, "查看数据源", "Open data source")} <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                </div>
              </div>
            </section>

            <section className="ds-container ds-section ds-section--first" aria-label={text(lang, "数据概览", "Registry metrics")}>
              <div className="ds-metrics">
                <div className="ds-metric"><strong>{formatNumber(data.summary.listed, lang)}</strong><span>{text(lang, "目录插件", "Listed plugins")}</span></div>
                <div className="ds-metric"><strong>{formatNumber(data.summary.curated, lang)}</strong><span>{text(lang, "社区精选", "Curated")}</span></div>
                <div className="ds-metric"><strong>{formatNumber(data.summary.autoDiscovered, lang)}</strong><span>{text(lang, "自动发现", "Auto-discovered")}</span></div>
                <div className="ds-metric"><strong>{formatNumber(data.summary.topicTotal, lang)}</strong><span>{text(lang, "GitHub 话题仓库", "Topic repositories")}</span></div>
                <div className="ds-metric"><strong>{formatNumber(data.summary.manifestMatches, lang)}</strong><span>{text(lang, "manifest 已核验", "Manifests verified")}</span></div>
                <div className="ds-metric"><strong>{formatNumber(data.summary.stars, lang)}</strong><span>{text(lang, "累计星标", "Total stars")}</span></div>
              </div>
            </section>

            <section className="ds-container ds-section">
              <div className="ds-section-head">
                <div>
                  <span className="ds-kicker">REGISTRY GROWTH</span>
                  <h2 className="ds-text-heading1">{text(lang, "插件收录增长", "Plugin growth")}</h2>
                </div>
                <p className="ds-description ds-text-caption">{text(lang, "按插件首次进入本站目录的日期累计，随自动巡检持续更新。", "Cumulative first-listing dates, updated by the automated scan.")}</p>
              </div>
              <div className="ds-panel ds-growth">
                <div className="ds-growth__summary">
                  <span>{text(lang, "当前目录", "CURRENT TOTAL")}</span>
                  <strong>{formatNumber(currentGrowth.total, lang)}</strong>
                  <p>{text(lang, `从 ${shortDate(firstGrowth.date, lang)} 开始记录`, `Tracked since ${shortDate(firstGrowth.date, lang)}`)}</p>
                  <div className="ds-growth__delta">
                    <b>+{latestGrowth.added}</b>
                    <span>{text(lang, "最近一次新增", "Latest additions")} · {shortDate(latestGrowth.date, lang)}</span>
                  </div>
                </div>
                <figure className="ds-growth-chart">
                  <figcaption>
                    <span><i aria-hidden="true" />{text(lang, "累计插件数", "Cumulative plugins")}</span>
                    <em>{text(lang, "真实收录数据", "Registry data")}</em>
                  </figcaption>
                  <svg
                    viewBox={`0 0 ${growthChart.width} ${growthChart.height}`}
                    role="img"
                    aria-label={text(lang, `插件数量从 ${firstGrowth.total} 增长到 ${currentGrowth.total}`, `Plugin count grew from ${firstGrowth.total} to ${currentGrowth.total}`)}
                  >
                    <defs>
                      <linearGradient id="ds-growth-area" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="var(--ds-color-brand)" stopOpacity="0.28" />
                        <stop offset="100%" stopColor="var(--ds-color-brand)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[0.25, 0.5, 0.75, 1].map((ratio) => (
                      <line
                        className="ds-chart-grid"
                        key={ratio}
                        x1="0"
                        x2={growthChart.width}
                        y1={growthChart.bottom * ratio}
                        y2={growthChart.bottom * ratio}
                      />
                    ))}
                    <path className="ds-chart-area" d={growthChart.area} />
                    <path className="ds-chart-line" d={growthChart.line} />
                    {growthChart.points.map((point) => (
                      <circle
                        aria-label={`${shortDate(point.date, lang)} · ${point.total} · +${point.added}`}
                        className="ds-chart-point"
                        cx={point.x}
                        cy={point.y}
                        key={point.date}
                        r="4"
                      />
                    ))}
                  </svg>
                  <div className="ds-chart-axis" aria-hidden="true">
                    <span>{shortDate(growthSeries[0].date, lang)}</span>
                    <span>{shortDate(currentGrowth.date, lang)}</span>
                  </div>
                </figure>
              </div>
            </section>

            <section className="ds-container ds-section">
              <div className="ds-section-head">
                <div>
                  <span className="ds-kicker">COMMUNITY SIGNAL</span>
                  <h2 className="ds-text-heading1">{text(lang, "社区热度", "Community signal")}</h2>
                </div>
                <button className="ds-btn ds-btn--text" type="button" onClick={() => go("rank")}>
                  {text(lang, "完整排行榜", "Full leaderboard")} <span aria-hidden="true">→</span>
                </button>
              </div>
              <div className="ds-featured-grid">
                {featured.map((plugin, index) => (
                  <a className="ds-featured-card" key={plugin.id} href={`/p/${plugin.id}`}>
                    <span className="ds-featured-card__rank">{String(index + 1).padStart(2, "0")}</span>
                    <span className="ds-featured-card__head"><strong>{plugin.name}</strong><em>★ {formatNumber(plugin.stars, lang)}</em></span>
                    <span className="ds-featured-card__owner">{plugin.owner}</span>
                    <span className="ds-featured-card__desc">{plugin.description[lang]}</span>
                    <span className="ds-featured-card__foot">{categoryLabelOf(data, plugin, lang)} <span aria-hidden="true">→</span></span>
                  </a>
                ))}
              </div>
            </section>

            <section className="ds-container ds-section">
              <div className="ds-section-head">
                <div>
                  <span className="ds-kicker">BROWSE</span>
                  <h2 className="ds-text-heading1">{text(lang, "按分类逛", "Browse by category")}</h2>
                </div>
              </div>
              <div className="ds-category-grid">
                {CATEGORY_ORDER.map((id) => (
                  <button
                    className="ds-category-card"
                    type="button"
                    key={id}
                    onClick={() => {
                      setCategory(id);
                      go("catalog");
                    }}
                  >
                    <strong>{categoryCounts[id]}</strong>
                    <span>{data.categories[id]?.[lang] ?? id}</span>
                    <small>{CATEGORY_HINTS[id][lang]}</small>
                  </button>
                ))}
              </div>
            </section>

            <section className="ds-container ds-section ds-section--last">
              <div className="ds-callout">
                <div>
                  <span className="ds-kicker">FACTS, NOT ENDORSEMENT</span>
                  <h2 className="ds-text-heading1">{text(lang, "每张卡片都说明事实到哪一步", "Every card shows how far the facts go")}</h2>
                  <p className="ds-description ds-text-body">
                    {text(lang, "网站只读取公开元数据、manifest、锁文件、许可证与 README 等客观事实；不安装依赖、不运行生命周期脚本，也不对插件做安全性背书。", "The hub reads public metadata, manifests, lockfiles, licenses, and READMEs — objective facts only. It installs no dependencies, runs no lifecycle scripts, and makes no security endorsement.")}
                  </p>
                </div>
                <div className="ds-process-grid">
                  {[
                    ["01", "LIST", text(lang, "社区精选名单", "Community curation")],
                    ["02", "TOPIC", text(lang, "GitHub 实时元数据", "Live GitHub metadata")],
                    ["03", "MANIFEST", text(lang, "manifest 与锁文件", "Manifest & lockfile")],
                    ["04", "FACTS", text(lang, "事实展示，无安全判定", "Facts shown, no judgment")],
                  ].map(([no, title, body]) => (
                    <div className="ds-process-card" key={no}><b>{no}</b><strong>{title}</strong><p>{body}</p></div>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}

        {page === "catalog" && (
          <section className="ds-container ds-section">
            <div className="ds-page-heading">
              <span className="ds-kicker">CATALOG</span>
              <h1 className="ds-text-heading1">{text(lang, "插件目录", "Plugin catalog")}</h1>
              <p>{text(lang, `${resultCount} 个结果 · 数据生成于 ${generatedLabel}`, `${resultCount} results · generated ${generatedLabel}`)}</p>
            </div>
            <div className="ds-toolbar">
              <label className="ds-search">
                <SearchGlyph />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={text(lang, "搜索名称、作者、能力或包名", "Search name, author, capability, package")}
                  aria-label={text(lang, "搜索插件", "Search plugins")}
                />
                {query && (
                  <button className="ds-search__clear" type="button" onClick={() => setQuery("")} aria-label={text(lang, "清空搜索", "Clear search")}>
                    ×
                  </button>
                )}
              </label>
              <span className="ds-select-wrap">
                <select value={evidence} onChange={(event) => setEvidence(event.target.value as EvidenceFilter)} className="ds-select" aria-label={text(lang, "事实筛选", "Facts filter")}>
                  <option value="all">{text(lang, "全部事实状态", "All facts")}</option>
                  <option value="curated">{text(lang, "社区精选", "Curated list")}</option>
                  <option value="topic">{text(lang, "已匹配 GitHub 话题", "Matched GitHub topic")}</option>
                  <option value="manifest">{text(lang, "manifest 已核验", "Manifest verified")}</option>
                  <option value="favorites">{text(lang, "只看收藏", "Favorites only")}</option>
                </select>
              </span>
              <span className="ds-select-wrap">
                <select value={sort} onChange={(event) => setSort(event.target.value as SortId)} className="ds-select" aria-label={text(lang, "排序", "Sort")}>
                  <option value="curated">{text(lang, "精选顺序", "Curated order")}</option>
                  <option value="stars">{text(lang, "按星标", "By stars")}</option>
                  <option value="updated">{text(lang, "最近更新", "Recently pushed")}</option>
                  <option value="added">{text(lang, "最近收录", "Recently added")}</option>
                  <option value="name">{text(lang, "名称 A→Z", "Name A→Z")}</option>
                </select>
              </span>
              <div className="ds-view-switch" role="group" aria-label={text(lang, "视图", "View")}>
                <button className={view === "list" ? "is-active" : ""} type="button" onClick={() => setView("list")} aria-pressed={view === "list"} title={text(lang, "列表", "List")} aria-label={text(lang, "列表视图", "List view")}>☰</button>
                <button className={view === "cards" ? "is-active" : ""} type="button" onClick={() => setView("cards")} aria-pressed={view === "cards"} title={text(lang, "卡片", "Cards")} aria-label={text(lang, "卡片视图", "Card view")}>▦</button>
              </div>
            </div>
            <div className="ds-chips" role="group" aria-label={text(lang, "分类筛选", "Category filter")} style={{ marginTop: "var(--ds-space-4)" }}>
              <button className={category === "all" ? "ds-chip is-active" : "ds-chip"} type="button" onClick={() => setCategory("all")}>
                {text(lang, "全部", "All")} <small>{data.summary.listed}</small>
              </button>
              {CATEGORY_ORDER.map((id) => (
                <button className={category === id ? "ds-chip is-active" : "ds-chip"} type="button" key={id} onClick={() => setCategory(id)}>
                  {data.categories[id]?.[lang] ?? id} <small>{categoryCounts[id]}</small>
                </button>
              ))}
            </div>
            <div style={{ marginTop: "var(--ds-space-5)" }}>
              {page1Pending && !displayItems.length ? (
                <SkeletonGrid />
              ) : displayItems.length ? (
                <>
                  <div className={view === "list" ? "ds-card-grid ds-card-grid--list" : "ds-card-grid"}>
                    {displayItems.map((plugin) => (
                      <PluginCard
                        key={plugin.id}
                        plugin={plugin}
                        lang={lang}
                        categoryLabel={categoryLabelOf(data, plugin, lang)}
                        favorite={favorites.includes(plugin.id)}
                        onFavorite={() => toggleFavorite(plugin.id)}
                        view={view}
                        copiedId={copied}
                        onCopy={copy}
                      />
                    ))}
                  </div>
                  {!isFavoritesView && catalogIsCurrent && catalog.loaded && catalog.hasMore && (
                    <div
                      ref={sentinelRef}
                      style={{ display: "flex", justifyContent: "center", padding: "var(--ds-space-6) 0" }}
                    >
                      <button
                        className="ds-btn ds-btn--ghost ds-btn--s"
                        type="button"
                        onClick={() => void fetchPage(catalogKey, catalog.nextPage, true)}
                      >
                        {text(lang, "加载更多", "Load more")}
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="ds-empty">
                  <strong>{text(lang, "没有匹配的插件", "No matching plugins")}</strong>
                  <p>{text(lang, "换个关键词或清空筛选条件。", "Try another keyword or reset the filters.")}</p>
                  <button className="ds-btn ds-btn--ghost ds-btn--s" type="button" onClick={() => { setQuery(""); setCategory("all"); setEvidence("all"); }}>
                    {text(lang, "清空筛选", "Reset filters")}
                  </button>
                </div>
              )}
            </div>
          </section>
        )}

        {page === "rank" && (
          <section className="ds-container ds-section">
            <div className="ds-page-heading">
              <span className="ds-kicker">PUBLIC SIGNALS</span>
              <h1 className="ds-text-heading1">{text(lang, "排行榜", "Leaderboard")}</h1>
              <p>{text(lang, "星标与推送时间来自 GitHub。它们代表关注度和活跃度，不代表安全或质量。", "Stars and push times come from GitHub. They signal attention and activity, not safety or quality.")}</p>
            </div>
            <div className="ds-rank-grid">
              <div className="ds-rank-panel">
                <div className="ds-rank-panel__heading">
                  <span aria-hidden="true">★</span>
                  <div>
                    <h2>{text(lang, "按星标", "By stars")}</h2>
                    <p>{text(lang, "社区关注度", "Community attention")}</p>
                  </div>
                </div>
                <ol>
                  {topStars.map((plugin, index) => (
                    <li key={plugin.id}>
                      <a href={`/p/${plugin.id}`}>
                        <b className="ds-rank-num">{String(index + 1).padStart(2, "0")}</b>
                        <span><strong>{plugin.name}</strong><small>{plugin.owner}</small></span>
                        <em>★ {formatNumber(plugin.stars, lang)}</em>
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
              <div className="ds-rank-panel">
                <div className="ds-rank-panel__heading">
                  <span aria-hidden="true">↻</span>
                  <div>
                    <h2>{text(lang, "最近更新", "Recently pushed")}</h2>
                    <p>{text(lang, "维护活跃度", "Maintenance activity")}</p>
                  </div>
                </div>
                <ol>
                  {topFresh.map((plugin, index) => (
                    <li key={plugin.id}>
                      <a href={`/p/${plugin.id}`}>
                        <b className="ds-rank-num">{String(index + 1).padStart(2, "0")}</b>
                        <span><strong>{plugin.name}</strong><small>{plugin.owner}</small></span>
                        <em>{relativeDate(plugin.pushedAt, lang)}</em>
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </section>
        )}

        {page === "submit" && (
          <section className="ds-container ds-section">
            <div className="ds-page-heading">
              <span className="ds-kicker">OPEN REGISTRY</span>
              <h1 className="ds-text-heading1">{text(lang, "让你的插件被看见", "Get your plugin listed")}</h1>
              <p>{text(lang, "收录走公开仓库链路，站点不接收代码上传。", "Listing follows public repository workflows; this site accepts no code uploads.")}</p>
            </div>
            <div className="ds-process-grid" style={{ marginBottom: "var(--ds-space-8)" }}>
              {[
                ["01", "dsh-plugin", text(lang, "给 GitHub 仓库添加 dsh-plugin topic。", "Add the dsh-plugin topic to your GitHub repository.")],
                ["02", "README + LICENSE", text(lang, "写清功能、权限、关闭方式和许可证。", "Document behavior, permissions, removal, and license.")],
                ["03", "dsh manifest", text(lang, "在 package.json 声明 dsh.bundle / plugin / profile。", "Declare dsh.bundle / plugin / profile in package.json.")],
                ["04", "AUTO SCAN", text(lang, "网站每 30 分钟发现一次，并核对 manifest、锁文件与 README 等事实。", "The site discovers repositories every 30 minutes and verifies manifest, lockfile, and README facts.")],
              ].map(([no, title, body]) => (
                <div className="ds-process-card" key={no}><b>{no}</b><strong>{title}</strong><p>{body}</p></div>
              ))}
            </div>
            <div className="ds-callout">
              <div>
                <span className="ds-kicker">SUBMIT</span>
                <h2 className="ds-text-heading1">{text(lang, "公开链路", "Public paths")}</h2>
              </div>
              <div className="ds-callout__links">
                <a className="ds-btn ds-btn--secondary ds-btn--s" href="https://github.com/topics/dsh-plugin" target="_blank" rel="noreferrer">GitHub topic <span aria-hidden="true">↗</span></a>
                <a className="ds-btn ds-btn--secondary ds-btn--s" href={data.sources.curated.repository} target="_blank" rel="noreferrer">awesome-dsh-plugin <span aria-hidden="true">↗</span></a>
              </div>
            </div>
          </section>
        )}

        {page === "guide" && (
          <section className="ds-container ds-section">
            <div className="ds-page-heading">
              <span className="ds-kicker">BUILD WITH EVIDENCE</span>
              <h1 className="ds-text-heading1">{text(lang, "从一个可检查的插件开始", "Start with an inspectable plugin")}</h1>
              <p>{text(lang, "最短路径：模板、manifest、公开扩展点、静态体检、独立 profile 验证。", "The shortest path: template, manifest, public seams, static checks, isolated-profile verification.")}</p>
            </div>
            <div className="ds-guide-grid" style={{ marginBottom: "var(--ds-space-8)" }}>
              {[
                ["01", "模板", "Template", text(lang, "克隆最小骨架，先跑通加载与卸载。", "Clone a minimal skeleton and verify load/unload first.")],
                ["02", "清单", "Manifest", text(lang, "声明 bundle、入口、配置和客户端模块。", "Declare bundle, entrypoint, config, and client modules.")],
                ["03", "边界", "Boundaries", text(lang, "写清文件、网络、Shell、密钥和遥测。", "Document files, network, shell, secrets, and telemetry.")],
                ["04", "验证", "Verification", text(lang, "固定 dsh 版本，在独立 profile 和临时工作区测试。", "Pin dsh, then test in an isolated profile and disposable workspace.")],
                ["05", "发布", "Publish", text(lang, "提交许可证、锁文件、构建产物和可复现安装说明。", "Ship license, lockfile, build artifacts, and reproducible install steps.")],
              ].map(([no, zhTitle, enTitle, body]) => (
                <article key={no}>
                  <b>{no}</b>
                  <h2>{lang === "zh" ? zhTitle : enTitle}</h2>
                  <p>{body}</p>
                </article>
              ))}
            </div>
            <TerminalBlock
              command={installCommandFor("owner/repository")}
              copiedId={copied}
              id="guide"
              lang={lang}
              onCopy={copy}
            />
            <p className="ds-muted-note" style={{ marginTop: "var(--ds-space-3)" }}>
              {text(lang, "命令只是格式示例。发布前请确认包内已有可加载产物，Git 安装所需的 prepare 脚本也应明确披露。", "The command is a format example. Before publishing, confirm the package contains loadable artifacts and disclose any prepare script needed by Git installs.")}
            </p>
          </section>
        )}
      </main>

      <footer className="ds-footer">
        <div className="ds-container ds-footer__inner">
          <span className="ds-footer__brand">dsh-plugin · {data.summary.listed} LISTED · {data.summary.autoDiscovered} AUTO · {visitStats?.displayCount === null || visitStats?.displayCount === undefined ? "—" : formatNumber(visitStats.displayCount, lang)} HEAT</span>
          <nav className="ds-footer__links" aria-label={text(lang, "页脚链接", "Footer links")}>
            <a href="/api/plugins">JSON API</a>
            <a href="/api/visits">VISIT API</a>
            <a href={data.sources.curated.repository} target="_blank" rel="noreferrer">{text(lang, "数据源", "Data source")} ↗</a>
            <a href="https://github.com/topics/dsh-plugin" target="_blank" rel="noreferrer">topic:dsh-plugin ↗</a>
            <a href="https://github.com/cclank/dsh-plugin-hub" target="_blank" rel="noreferrer">GitHub ↗</a>
          </nav>
          <p className="ds-footer__meta ds-muted-note">
            {text(lang, "社区索引 · 仅展示 GitHub 公开事实，不构成安全背书 · 与 DeepSeek AI 无隶属关系", "Community index · public GitHub facts only, no security endorsement · not affiliated with DeepSeek AI")}
          </p>
        </div>
      </footer>
    </div>
  );
}
