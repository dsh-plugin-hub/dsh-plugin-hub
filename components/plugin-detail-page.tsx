
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CategoryId, Language, PluginRecord } from "@/lib/plugin-data";
import { installCommandFor, npmInstallCommandFor } from "@/lib/plugin-screening.mjs";
import { PluginReadmePanel } from "@/components/plugin-readme-panel";

const PREFS_KEY = "dsh-plugin-hub-prefs-v2";
const NAV_ITEMS: Array<{ id: string; zh: string; en: string }> = [
  { id: "home", zh: "首页", en: "Home" },
  { id: "catalog", zh: "目录", en: "Catalog" },
  { id: "rank", zh: "排行榜", en: "Leaderboard" },
  { id: "submit", zh: "收录", en: "Get listed" },
  { id: "guide", zh: "开发指南", en: "Build one" },
];

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

function relativeDate(value: string | null, lang: Language) {
  if (!value) return "—";
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "—";
  const days = Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
  if (days === 0) return text(lang, "今天", "today");
  if (days < 30) return text(lang, `${days} 天前`, `${days}d ago`);
  if (days < 365) return text(lang, `${Math.floor(days / 30)} 个月前`, `${Math.floor(days / 30)}mo ago`);
  return text(lang, `${Math.floor(days / 365)} 年前`, `${Math.floor(days / 365)}y ago`);
}

function maintenanceLabel(plugin: PluginRecord, lang: Language) {
  const labels = {
    active: text(lang, "近 30 天活跃", "Active in 30d"),
    warm: text(lang, "近半年更新", "Updated in 6mo"),
    quiet: text(lang, "更新较少", "Quiet"),
    archived: text(lang, "已归档", "Archived"),
    unknown: text(lang, "活跃度未知", "Activity unknown"),
  };
  return labels[plugin.maintenance];
}

function manifestSummary(plugin: PluginRecord, lang: Language) {
  if (plugin.manifest.state === "verified") {
    const kinds = plugin.manifest.kinds.length ? plugin.manifest.kinds.join(" · ") : "dsh";
    return plugin.manifest.packageName ? `${kinds} · ${plugin.manifest.packageName}` : kinds;
  }
  if (plugin.manifest.state === "package-only") {
    return text(lang, "有 package.json，无 dsh 声明", "package.json found, no dsh declaration");
  }
  return plugin.manifest.state;
}

function sourceLabel(plugin: PluginRecord) {
  if (!plugin.curated) return "AUTO";
  return plugin.topic ? "TOPIC + LIST" : "LIST";
}

function InstallCommand({
  command,
  copiedId,
  id,
  lang,
  onCopy,
}: {
  command: string;
  copiedId: string | null;
  id: string;
  lang: Language;
  onCopy: (value: string, id: string) => void;
}) {
  return (
    <div className="ds-terminal ds-terminal--wrap">
      <span className="ds-terminal__prompt" aria-hidden="true">$</span>
      <code translate="no">{command}</code>
      <button className="ds-terminal__copy" type="button" onClick={() => onCopy(command, id)}>
        {copiedId === id ? text(lang, "已复制", "Copied") : text(lang, "复制", "Copy")}
      </button>
    </div>
  );
}

export function PluginDetailPage({
  plugin,
  categories,
}: {
  plugin: PluginRecord;
  categories: Record<CategoryId, Record<Language, string>>;
}) {
  const [lang, setLang] = useState<Language>("zh");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as {
          lang?: Language;
          theme?: "dark" | "light";
        };
        if (saved.lang === "zh" || saved.lang === "en") setLang(saved.lang);
        if (saved.theme === "dark" || saved.theme === "light") setTheme(saved.theme);
      } catch {
        // Keep defaults when preferences are malformed.
      } finally {
        setPreferencesReady(true);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    if (!preferencesReady) return;
    try {
      const previous = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") as Record<string, unknown>;
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...previous, lang, theme }));
    } catch {
      // Preferences are optional.
    }
  }, [lang, preferencesReady, theme]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const copy = useCallback(async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      setCopiedId(null);
    }
  }, []);

  const categoryLabel = categories[plugin.category]?.[lang] ?? plugin.category;
  const packageName = plugin.manifest.packageName;
  const npmCommand = npmInstallCommandFor(packageName);
  const githubCommand = installCommandFor(plugin.repo);
  const firstSeen = plugin.discovery?.firstSeenAt || plugin.added;
  const hasLifecycleScripts = plugin.facts?.lifecycleScripts?.length > 0;
  const facts = plugin.facts;

  return (
    <div className="ds-page" data-lang={lang} data-page="detail">
      <header className={`ds-header${scrolled ? " is-scrolled" : ""}`}>
        <div className="ds-header__bar">
          <Link className="ds-brand" href="/" aria-label="dsh-plugin">
            <span className="ds-brand__mark">dsh</span>
            <span className="ds-brand__name">dsh-plugin</span>
          </Link>
          <nav className="ds-nav ds-nav--desktop" aria-label={text(lang, "主导航", "Main navigation")}>
            {NAV_ITEMS.map((item) => (
              <Link className="ds-nav__link" key={item.id} href={`/#/${item.id}`}>
                {item[lang]}
              </Link>
            ))}
          </nav>
          <div className="ds-header__actions">
            <div className="ds-locale-toggle" role="group" aria-label={text(lang, "语言", "Language")}>
              <button className={lang === "zh" ? "is-active" : ""} type="button" onClick={() => setLang("zh")} aria-pressed={lang === "zh"}>
                中文
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
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <a
              className="ds-icon-btn"
              href="https://github.com/dsh-plugin-hub/dsh-plugin-hub"
              target="_blank"
              rel="noreferrer"
              aria-label={text(lang, "在 GitHub 查看开源代码", "View source on GitHub")}
              title={text(lang, "GitHub 开源仓库", "GitHub repository")}
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.477 2 2 6.484 2 12.021c0 4.428 2.865 8.184 6.839 9.504.5.093.682-.217.682-.483 0-.237-.009-.868-.014-1.703-2.782.605-3.369-1.343-3.369-1.343-.455-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.071 1.531 1.031 1.531 1.031.892 1.529 2.341 1.087 2.91.831.091-.647.349-1.087.635-1.337-2.221-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.269 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.295 2.747-1.026 2.747-1.026.546 1.378.203 2.398.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.847-2.337 4.695-4.566 4.943.359.31.678.921.678 1.856 0 1.34-.012 2.421-.012 2.75 0 .268.18.58.688.481A10.025 10.025 0 0 0 22 12.021C22 6.484 17.523 2 12 2Z" />
              </svg>
            </a>
          </div>
        </div>
      </header>

      <main className="ds-main--page">
        <div className="ds-container ds-detail">
          <nav className="ds-detail__crumbs" aria-label={text(lang, "面包屑", "Breadcrumb")}>
            <Link href="/#/catalog">{text(lang, "全部插件", "All plugins")}</Link>
            <span aria-hidden="true">/</span>
            <Link href="/#/catalog">{categoryLabel}</Link>
            <span aria-hidden="true">/</span>
            <span translate="no">{plugin.name}</span>
          </nav>

          <header className="ds-panel ds-detail__plate">
            <p className="ds-kicker">DEEPSEEK HARNESS PLUGIN</p>
            <h1 translate="no">
              <span className="ds-detail__owner">{plugin.owner}/</span>
              <wbr />
              <span className="ds-detail__name">{plugin.name}</span>
            </h1>
            <div className="ds-detail__specrow">
              <span>{text(lang, "Star 数", "Stars")} <b>★ {formatNumber(plugin.stars, lang)}</b></span>
              <span>{text(lang, "分类", "Category")} <Link href="/#/catalog">{categoryLabel}</Link></span>
              <span>{text(lang, "收录于", "Listed")} <b>{firstSeen?.slice(0, 10) || "—"}</b></span>
              {npmCommand && (
                <span>npm{" "}<a href={`https://www.npmjs.com/package/${encodeURIComponent(packageName ?? "")}`} target="_blank" rel="noreferrer" translate="no">{packageName}</a></span>
              )}
            </div>
            <div className="ds-card__badges">
              <span className="ds-source-badge">{sourceLabel(plugin)}</span>
              {facts?.hasManifest && <span className="ds-badge ds-badge--brand">{text(lang, "manifest 已核验", "manifest verified")}</span>}
              {hasLifecycleScripts && (
                <span className="ds-badge">
                  {text(lang, `安装时运行 ${facts.lifecycleScripts.slice(0, 2).join(" · ")}`, `runs ${facts.lifecycleScripts.slice(0, 2).join(" · ")} on install`)}
                </span>
              )}
              {facts?.hasLicense && <span className="ds-badge">{text(lang, "有许可证", "licensed")}</span>}
              {facts?.hasLockfile && <span className="ds-badge">{text(lang, "有锁文件", "lockfile")}</span>}
              {facts?.hasReadme && <span className="ds-badge">README</span>}
            </div>
          </header>

          <p className="ds-detail__desc">{plugin.description[lang]}</p>

          <section className="ds-panel ds-detail__panel" aria-label={text(lang, "安装", "Install")}>
            <div className="ds-detail__panel-head">
              <h2>{text(lang, "安装", "Install")}</h2>
            </div>

            {npmCommand && (
              <>
                <p className="ds-detail__install-note"># npm {text(lang, "包（预构建）", "package (prebuilt)")}</p>
                <InstallCommand command={npmCommand} copiedId={copiedId} id={`${plugin.id}:npm`} lang={lang} onCopy={copy} />
              </>
            )}

            {githubCommand && (
              <>
                <p className="ds-detail__install-note"># GitHub {text(lang, "源码（安装时可能执行构建脚本）", "source (build scripts may run during install)")}</p>
                <InstallCommand command={githubCommand} copiedId={copiedId} id={`${plugin.id}:github`} lang={lang} onCopy={copy} />
              </>
            )}

            {!npmCommand && !githubCommand && (
              <p className="ds-muted-note">
                {text(lang, "仓库地址无效，无法派生安装命令。", "Invalid repository path; install command unavailable.")}
              </p>
            )}

            {!npmCommand && githubCommand && (
              <p className="ds-detail__install-note">
                {packageName
                  ? text(lang, "检测到的 package name 不符合 npm 包名格式，仅提供 GitHub 源码安装命令。", "The detected package name is not a valid npm name; only the GitHub source command is shown.")
                  : text(lang, "未检测到 npm 包名，仅提供 GitHub 源码安装命令。", "No npm package name detected; only the GitHub source command is shown.")}
              </p>
            )}

            <p className="ds-detail__install-warning">
              {text(
                lang,
                "安装插件等于在本机运行第三方代码，权限与当前用户相同；GitHub 来源还可能执行构建脚本。请只安装可信来源，并尽量锁定 commit：",
                "Installing a plugin runs third-party code with your current user's permissions; GitHub sources may also run build scripts. Install trusted sources only and pin a commit when possible:",
              )}
              {" "}
              <code translate="no">dsh plugin --profile web add github:owner/repo#sha</code>
            </p>
          </section>

          <PluginReadmePanel plugin={plugin} lang={lang} />

          <section className="ds-panel ds-detail__panel" aria-label={text(lang, "仓库事实", "Repository facts")}>
            <div className="ds-detail__panel-head">
              <h2>{text(lang, "仓库事实", "Repository facts")}</h2>
            </div>
            <dl className="ds-evidence-list">
              <div><dt>{text(lang, "Manifest 状态", "Manifest")}</dt><dd>{manifestSummary(plugin, lang)}</dd></div>
              <div><dt>{text(lang, "分类", "Category")}</dt><dd>{categoryLabel}</dd></div>
              <div><dt>{text(lang, "版本", "Version")}</dt><dd>{plugin.manifest.version || "—"}</dd></div>
              <div><dt>{text(lang, "运行依赖", "Runtime deps")}</dt><dd>{plugin.manifest.runtimeDependencies}</dd></div>
              <div><dt>{text(lang, "生命周期脚本", "Lifecycle scripts")}</dt><dd>{hasLifecycleScripts ? facts.lifecycleScripts.join(" · ") : text(lang, "未发现", "None found")}</dd></div>
              <div><dt>{text(lang, "声明入口", "Declared entrypoints")}</dt><dd>{plugin.manifest.declaredPaths.length ? plugin.manifest.declaredPaths.join(" · ") : "—"}</dd></div>
              <div><dt>{text(lang, "许可证", "License")}</dt><dd>{plugin.license || text(lang, "未声明", "Not declared")}</dd></div>
              <div><dt>{text(lang, "锁文件", "Lockfile")}</dt><dd>{facts?.hasLockfile ? text(lang, "存在", "Present") : text(lang, "未发现", "None found")}</dd></div>
              <div><dt>README</dt><dd>{facts?.hasReadme ? text(lang, "存在", "Present") : text(lang, "运行时探测", "Probed at runtime")}</dd></div>
              <div><dt>{text(lang, "维护状态", "Maintenance")}</dt><dd>{maintenanceLabel(plugin, lang)}</dd></div>
              <div><dt>{text(lang, "默认分支", "Default branch")}</dt><dd>{plugin.defaultBranch || "—"}</dd></div>
              <div><dt>{text(lang, "最近推送", "Last push")}</dt><dd>{relativeDate(plugin.pushedAt, lang)}</dd></div>
              <div><dt>{text(lang, "数据源", "Source")}</dt><dd>{plugin.curated ? text(lang, "社区精选名单", "Curated list") : text(lang, "GitHub 话题发现", "GitHub topic")}</dd></div>
            </dl>
          </section>

          <div className="ds-detail__actions">
            <a className="ds-btn ds-btn--primary ds-btn--s" href={plugin.url} target="_blank" rel="noreferrer">
              GitHub ↗
            </a>
            {npmCommand && (
              <a className="ds-btn ds-btn--secondary ds-btn--s" href={`https://www.npmjs.com/package/${encodeURIComponent(packageName ?? "")}`} target="_blank" rel="noreferrer">
                npm ↗
              </a>
            )}
            <Link className="ds-btn ds-btn--ghost ds-btn--s" href="/#/catalog">
              {text(lang, "返回插件目录", "Back to catalog")}
            </Link>
          </div>

          <p className="ds-detail__disclaimer">
            {text(
              lang,
              "本站只展示 GitHub 公开元数据与仓库事实，不构成安全背书。安装插件会在你的机器上执行第三方代码；高权限项目请放进独立 profile 与临时工作区验证。",
              "This hub shows public GitHub metadata and repository facts only — no security endorsement. Installing a plugin executes third-party code on your machine; test high-authority projects in an isolated profile and disposable workspace.",
            )}
          </p>
        </div>
      </main>

      <footer className="ds-footer">
        <div className="ds-container ds-footer__inner">
          <span className="ds-footer__brand">dsh-plugin</span>
          <nav className="ds-footer__links" aria-label={text(lang, "页脚链接", "Footer links")}>
            <a href="/api/plugins">JSON API</a>
            <a href={`https://github.com/${plugin.repo}`} target="_blank" rel="noreferrer">{text(lang, "插件仓库", "Plugin repository")} ↗</a>
            <a href="https://github.com/dsh-plugin-hub/dsh-plugin-hub" target="_blank" rel="noreferrer">{text(lang, "本站源码", "Site source")} ↗</a>
          </nav>
          <p className="ds-footer__meta ds-muted-note">
            {text(lang, "社区索引 · 仅展示 GitHub 公开事实，不构成安全背书 · 与 DeepSeek AI 无隶属关系", "Community index · public GitHub facts only, no security endorsement · not affiliated with DeepSeek AI")}
          </p>
        </div>
      </footer>
    </div>
  );
}
