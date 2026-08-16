
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PluginDetailPage } from "@/components/plugin-detail-page";
import type { CategoryId, Language, PluginRecord } from "@/lib/plugin-data";

interface PluginDetailResponse {
  plugin: PluginRecord;
  categories: Record<CategoryId, Record<Language, string>>;
  generatedAt?: string | null;
}

type LoaderState =
  | { status: "ready"; plugin: PluginRecord; categories: Record<CategoryId, Record<Language, string>> }
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; message: string | null };

function pluginDetailApiUrl(owner: string, repo: string) {
  return `/api/plugins/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

async function readStaticSnapshotPlugin(
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<{ plugin: PluginRecord; categories: Record<CategoryId, Record<Language, string>> } | null> {
  const response = await fetch("/plugins.json", {
    cache: "force-cache",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) throw new Error(`Static registry request failed: ${response.status}`);
  const payload = await response.json() as {
    plugins?: PluginRecord[];
    categories?: Record<CategoryId, Record<Language, string>>;
  };
  const id = `${owner}/${repo}`.toLowerCase();
  const plugin = payload.plugins?.find((candidate) => candidate.id.toLowerCase() === id) ?? null;
  if (!plugin || !payload.categories) return null;
  return { plugin, categories: payload.categories };
}

export function PluginDetailLoader({
  owner,
  repo,
  initialPlugin,
  categories,
}: {
  owner: string;
  repo: string;
  initialPlugin: PluginRecord | null;
  categories: Record<CategoryId, Record<Language, string>>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<LoaderState>(() =>
    initialPlugin
      ? { status: "ready", plugin: initialPlugin, categories }
      : { status: "loading" },
  );
  const initialId = initialPlugin?.id ?? null;

  useEffect(() => {
    if (initialId) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8_000);

    async function load() {
      setState({ status: "loading" });
      let detail: { plugin: PluginRecord; categories: Record<CategoryId, Record<Language, string>> } | null = null;

      try {
        const response = await fetch(pluginDetailApiUrl(owner, repo), {
          cache: "no-store",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        if (response.ok) {
          const payload = await response.json() as Partial<PluginDetailResponse>;
          if (payload.plugin && typeof payload.plugin.id === "string" && payload.categories) {
            detail = { plugin: payload.plugin, categories: payload.categories };
          }
        }
      } catch {
        if (controller.signal.aborted) return;
        // 单插件 API 不可用时回退到全量静态快照（/plugins.json）。
        detail = null;
      }

      if (!detail) {
        try {
          detail = await readStaticSnapshotPlugin(owner, repo, controller.signal);
        } catch (error) {
          if (controller.signal.aborted) return;
          setState({
            status: "error",
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
      }

      if (controller.signal.aborted) return;
      if (!detail) {
        setState({ status: "not-found" });
        return;
      }
      setState({ status: "ready", plugin: detail.plugin, categories: detail.categories });
    }

    void load();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, initialId, owner, repo]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);

  if (state.status === "ready") {
    return <PluginDetailPage plugin={state.plugin} categories={state.categories} />;
  }

  return (
    <div className="ds-page">
      <header className="ds-header">
        <div className="ds-header__bar">
          <Link className="ds-brand" href="/" aria-label="dsh-plugin">
            <span className="ds-brand__mark">dsh</span>
            <span className="ds-brand__name">dsh-plugin</span>
          </Link>
          <nav className="ds-nav ds-nav--desktop" aria-label="主导航">
            <Link className="ds-nav__link" href="/#/catalog">目录</Link>
            <Link className="ds-nav__link" href="/#/rank">排行榜</Link>
            <Link className="ds-nav__link" href="/#/submit">收录</Link>
          </nav>
        </div>
      </header>
      <main className="ds-main--page">
        <div className="ds-container ds-detail-state">
          {state.status === "loading" && (
            <div className="ds-readme-skeleton" aria-busy="true" aria-label="加载插件详情">
              <span style={{ width: "30%" }} />
              <span style={{ width: "72%" }} />
              <span style={{ width: "90%" }} />
              <span style={{ width: "80%" }} />
            </div>
          )}
          {state.status === "not-found" && (
            <div className="ds-readme-empty">
              <strong>插件不存在或已从目录移除</strong>
              <p>请检查地址中的 owner/repo 是否正确。</p>
              <Link className="ds-btn ds-btn--ghost ds-btn--s" href="/#/catalog">
                返回插件目录
              </Link>
            </div>
          )}
          {state.status === "error" && (
            <div className="ds-readme-empty">
              <strong>插件详情加载失败</strong>
              <p>可能是网络或 API 暂时不可用，请稍后重试。</p>
              <button className="ds-btn ds-btn--ghost ds-btn--s" type="button" onClick={retry}>
                重新加载
              </button>
              {state.message && <code>{state.message}</code>}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
