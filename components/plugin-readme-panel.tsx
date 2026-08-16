
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Language, PluginRecord } from "@/lib/plugin-data";
import {
  readmeBlobUrl,
  resolveReadmeHref,
  resolveReadmeImageSrc,
  README_CANDIDATES,
  README_MAX_CHARS,
} from "@/lib/plugin-readme";

type ReadmeState =
  | { status: "loading" }
  | { status: "ready"; text: string; branch: string; path: string }
  | { status: "empty" }
  | { status: "error"; message: string | null };

const README_TIMEOUT_MS = 12_000;

function text(lang: Language, zh: string, en: string) {
  return lang === "zh" ? zh : en;
}

export function PluginReadmePanel({
  plugin,
  lang,
}: {
  plugin: PluginRecord;
  lang: Language;
}) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ReadmeState>({ status: "loading" });
  const branchHint = plugin.defaultBranch ?? plugin.manifest?.branch ?? null;
  const repo = plugin.repo;

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), README_TIMEOUT_MS);
    const branches = [...new Set(
      [branchHint, "main", "master"].filter((value): value is string => Boolean(value)),
    )];

    async function load() {
      setState({ status: "loading" });
      let lastError: string | null = null;

      for (const branch of branches) {
        for (const name of README_CANDIDATES) {
          const url = `https://raw.githubusercontent.com/${repo}/${encodeURIComponent(branch)}/${encodeURIComponent(name)}`;
          try {
            const response = await fetch(url, {
              cache: "no-store",
              headers: { Accept: "text/plain; charset=utf-8" },
              signal: controller.signal,
            });
            if (response.status === 404 || response.status === 400) continue;
            if (!response.ok) {
              lastError = `GitHub raw ${response.status}`;
              continue;
            }
            const raw = await response.text();
            if (controller.signal.aborted) return;
            if (!raw.trim()) continue;
            if (raw.length > README_MAX_CHARS) {
              lastError = "too-large";
              continue;
            }
            setState({ status: "ready", text: raw, branch, path: name });
            return;
          } catch (error) {
            if (controller.signal.aborted) return;
            lastError = error instanceof Error ? error.message : String(error);
          }
        }
      }

      if (controller.signal.aborted) return;
      setState({ status: lastError ? "error" : "empty", message: lastError });
    }

    void load();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, branchHint, repo]);

  const components = useMemo<Components>(() => {
    const branch = state.status === "ready" ? state.branch : branchHint ?? "main";
    return {
      a: ({ node, href, children, ...props }) => {
        void node;
        const resolved = resolveReadmeHref(href, plugin, branch);
        const external = Boolean(resolved && !resolved.startsWith("#"));
        return (
          <a
            {...props}
            href={resolved}
            target={external ? "_blank" : undefined}
            rel={external ? "noreferrer noopener" : undefined}
          >
            {children}
          </a>
        );
      },
      img: ({ node, src, alt, ...props }) => {
        void node;
        return (
          /* eslint-disable-next-line @next/next/no-img-element -- README 远程图片无法走 next/image 优化 */
          <img
            {...props}
            src={typeof src === "string" ? resolveReadmeImageSrc(src, plugin, branch) : src}
            alt={alt ?? ""}
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        );
      },
    };
  }, [branchHint, plugin, state]);

  const retry = useCallback(() => setAttempt((current) => current + 1), []);
  const sourceUrl = state.status === "ready"
    ? readmeBlobUrl(plugin, state.branch, state.path)
    : `${plugin.url}`;
  const errorDetail = state.status === "error"
    ? state.message === "too-large"
      ? text(lang, "README 超过 2,000,000 字符，已跳过", "README exceeds 2,000,000 characters")
      : state.message
    : null;

  return (
    <section className="ds-panel ds-detail__panel" aria-label={text(lang, "项目 README", "Project README")}>
      <div className="ds-detail__panel-head">
        <h2>README</h2>
        {state.status === "ready" && (
          <a href={sourceUrl} target="_blank" rel="noreferrer">
            {text(lang, "在 GitHub 查看源文件", "View source on GitHub")} ↗
          </a>
        )}
      </div>

      {state.status === "loading" && (
        <div className="ds-readme-skeleton" aria-busy="true" aria-label={text(lang, "正在加载 README", "Loading README")}>
          <span style={{ width: "42%" }} />
          <span style={{ width: "88%" }} />
          <span style={{ width: "76%" }} />
          <span style={{ width: "92%" }} />
          <span style={{ width: "58%" }} />
        </div>
      )}

      {state.status === "ready" && (
        <div className="ds-markdown" translate="no">
          <ReactMarkdown
            components={components}
            remarkPlugins={[remarkGfm]}
            skipHtml
          >
            {state.text}
          </ReactMarkdown>
        </div>
      )}

      {state.status === "empty" && (
        <div className="ds-readme-empty">
          <strong>{text(lang, "未找到可渲染的 README", "No renderable README found")}</strong>
          <p>{text(lang, "项目默认分支下没有 README.md / README 等根目录说明文件。", "No README.md / README file was found in the repository root.")}</p>
        </div>
      )}

      {state.status === "error" && (
        <div className="ds-readme-empty">
          <strong>{text(lang, "README 加载失败", "README could not be loaded")}</strong>
          <p>{text(lang, "可能是网络或 GitHub raw 暂时不可用，请稍后重试。", "GitHub raw may be temporarily unavailable. Please retry in a moment.")}</p>
          <button className="ds-btn ds-btn--ghost ds-btn--s" type="button" onClick={retry}>
            {text(lang, "重新加载", "Retry")}
          </button>
          {errorDetail && <code>{errorDetail}</code>}
        </div>
      )}

      <p className="ds-detail__panel-note">
        {text(lang, "内容来自项目根目录 README（GitHub raw）。", "Content is fetched from the project README on GitHub raw.")}
        {" "}
        <a href={sourceUrl} target="_blank" rel="noreferrer">
          {text(lang, "查看仓库", "View repository")} ↗
        </a>
      </p>
    </section>
  );
}
