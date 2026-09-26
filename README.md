<p align="center">
  <img src="./public/favicon.svg" width="88" height="88" alt="DSH Plugin Hub logo" />
</p>

<h1 align="center">DSH Plugin Hub</h1>

<p align="center">
  面向 DeepSeek Harness 社区的插件目录与安装证据索引 —— 全量收录，不做安全筛查。
  <br />
  Discover community plugins with real GitHub metadata and manifest evidence — full coverage, no screening.
</p>

<p align="center">
  <a href="https://dsh-plugin.store/"><img alt="Live site" src="https://img.shields.io/website?url=https%3A%2F%2Fdsh-plugin.store&amp;label=site&amp;up_message=online&amp;down_message=offline&amp;style=flat-square" /></a>
  <a href="https://dsh-plugin.store/api/registry/status"><img alt="Listed plugins" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fdsh-plugin.store%2Fapi%2Fregistry%2Fstatus&amp;query=%24.summary.listed&amp;label=plugins&amp;color=0f766e&amp;cacheSeconds=300&amp;style=flat-square" /></a>
  <a href="https://github.com/dsh-plugin-hub/dsh-plugin-hub/actions/workflows/deploy.yml"><img alt="CI" src="https://github.com/dsh-plugin-hub/dsh-plugin-hub/actions/workflows/deploy.yml/badge.svg" /></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-22c55e?style=flat-square" /></a>
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%3E%3D22.13-339933?logo=nodedotjs&amp;logoColor=white&amp;style=flat-square" />
  <img alt="Cloudflare Workers" src="https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&amp;logoColor=white&amp;style=flat-square" />
  <a href="https://github.com/deepseek-ai/deepseek-harness"><img alt="DeepSeek Harness community project" src="https://img.shields.io/badge/DeepSeek_Harness-community_project-4f46e5?style=flat-square" /></a>
</p>

<p align="center">
  <a href="https://dsh-plugin.store/">在线访问</a>
  ·
  <a href="https://dsh-plugin.store/api/plugins">JSON API</a>
  ·
  <a href="https://dsh-plugin.store/plugins.json">静态快照</a>
  ·
  <a href="https://github.com/topics/dsh-plugin">GitHub Topic</a>
</p>

![DSH Plugin Hub preview](./public/og.png)

## 项目简介

DeepSeek Harness 的插件生态增长很快，但仓库描述、安装命令和真实权限边界经常散落在不同位置。DSH Plugin Hub 将这些公开证据汇总成一个可搜索目录，帮助用户在安装前先确认：

- 项目是否真的声明了 `dsh.bundle`、`dsh.plugin`、`dsh.profile` 或 `dsh.client`；
- 推荐安装命令（`dsh plugin --profile web add github:owner/repo`）与仓库当前状态；
- 仓库是否活跃、是否有许可证和锁文件；
- 是否存在生命周期脚本、网络访问、文件写入、凭据读取或动态代码执行信号；
- 当前结果来自自动发现、社区精选，还是离线快照。

本站是独立社区项目，与 DeepSeek 官方没有隶属关系。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 真实插件数据 | 合并社区精选列表、GitHub `topic:dsh-plugin` 元数据和仓库根目录 manifest。 |
| 自动收录 | Cloudflare Cron 每 30 分钟发现新仓库，增量检查后写入 KV 分片。 |
| 安装命令 | 为每个仓库生成 `dsh plugin --profile web add github:owner/repo` 推荐命令，不锁定 commit。 |
| 公开事实 | 展示 manifest、许可证、锁文件与生命周期脚本等 GitHub 公开事实，不筛查、不背书，用户自行判断。 |
| 插件浏览 | 支持搜索、分类、证据筛选、排序、卡片/列表视图和本地收藏。 |
| 双语与主题 | 支持中文、English、浅色和深色界面。 |
| 开放数据 | 提供动态 JSON API、运行状态接口和构建时静态快照。 |
| 访问热度 | D1 只保存真实根页面访问总数，页面按可配置倍率展示；历史基线和上线后计数独立保存。 |

## 数据链路

```text
awesome-dsh-plugin ─┐
                    ├─> 元数据归一化 ─> manifest / 仓库事实采集 ─> 插件注册表
GitHub dsh-plugin ──┘                                          │
                                                               ├─> Web UI
Cloudflare Cron (30 min) ─> 增量复查 ─> Cloudflare KV 分片 ────┼─> JSON API
                                                               └─> 状态接口

Cloudflare 历史请求 ─> historical_root_views ─┐
                                               ├─> D1 真实总数 ─> × 展示倍率 ─> 访问热度
根页面实时请求 ─────> tracked_root_views ─────┘
```

数据源：

- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)：社区精选列表；
- [GitHub `dsh-plugin` topic](https://github.com/topics/dsh-plugin)：自动发现入口；
- 各候选仓库的公开 README、`package.json`、manifest 声明、锁文件与有限源码文件；
- `data/curated.snapshot.json`：GitHub 暂时不可用时的离线回退。

### 收录原则

本站全量收录所有可发现的 DSH 插件（社区精选列表 + GitHub `dsh-plugin` topic 全量扫描），**不做安全筛查、不做筛选、不为任何插件背书**——是否安装由用户自行判断。

公开事实只覆盖 GitHub 公开元数据，不能替代完整代码审计、依赖审计或运行时沙箱验证。站点不会安装、构建或执行被收录插件。

## 公开 API

| 接口 | 用途 |
| --- | --- |
| [`GET /api/plugins`](https://dsh-plugin.store/api/plugins) | 当前动态注册表，优先读取 Cloudflare KV。 |
| [`GET /api/registry/status`](https://dsh-plugin.store/api/registry/status) | 最近同步时间与收录数量汇总。 |
| [`GET /api/visits`](https://dsh-plugin.store/api/visits) | 真实访问、历史基线、展示倍率和访问热度。响应禁止缓存。 |
| [`GET /plugins.json`](https://dsh-plugin.store/plugins.json) | 向后兼容的完整注册表快照；底层由多个静态/KV 分片组装，D1 不可用时用于回退。 |

快照按插件 ID 稳定分桶存储：`data/plugins.generated.json` 与 `public/plugins.json` 都是小型清单，完整记录分别位于对应的 `*-snapshot-v1/` 分片目录。Worker 校验分片后再组装；单个分片不一致时会回退，不会返回混合版本。同步器仍可读取旧版完整 JSON，并在 `npm run data:artifacts` 时迁移为分片。

```bash
curl -sS https://dsh-plugin.store/api/registry/status
```

`/api/plugins` 允许跨域读取，并带有短时公共缓存头，适合做社区机器人、插件推荐器或二次目录的数据源。

访问计数只记录成功返回的根页面 HTML 请求，不保存 IP、User-Agent、Cookie 或访客明细。D1 中的 `historical_root_views` 与 `tracked_root_views` 都是未放大的真实值；`VISIT_DISPLAY_MULTIPLIER` 只影响公开展示，因此以后将倍率改回 `1` 时，历史真实总数仍然完整。

## 本地开发

要求：

- Node.js `>=22.13.0`
- npm（使用仓库内的 `package-lock.json`）

```bash
git clone https://github.com/dsh-plugin-hub/dsh-plugin-hub.git
cd dsh-plugin-hub
npm ci
npm run data:sync
npm run dev
```

默认开发环境使用打包快照。`data:sync` 会读取 GitHub 公共接口；匿名请求有限流，可选配置 Token：

```bash
GITHUB_TOKEN=github_pat_xxx npm run data:sync
```

Token 只需要读取公开仓库的权限，请勿提交到 Git。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动本地 vinext / Cloudflare Workers 开发环境。 |
| `npm run data:sync` | 只读同步精选列表、Topic 元数据和 manifest，更新本地快照。 |
| `npm run data:artifacts` | 从现有完整工作快照重建静态分片和 SEO 工件，不请求 GitHub。 |
| `npm run build` | 生成 Cloudflare Workers 与前端静态资源。 |
| `npm run lint` | 执行 ESLint。 |
| `npm run typecheck` | 执行 TypeScript 静态检查。 |
| `npm run types:generate` | 按构建后的 Wrangler 配置刷新 Worker binding 类型。 |
| `npm test` | 生产构建后执行筛查规则、SSR、API 和数据一致性测试。 |

## 部署到 Cloudflare

项目使用 vinext、Cloudflare Vite Plugin、Workers Cron、KV 和 D1。部署参数集中在 [`vite.config.ts`](./vite.config.ts)：

- Worker：`dsh-plugin-hub`
- KV binding：`PLUGIN_REGISTRY`
- D1 binding：`VISIT_METRICS`
- Cron：`*/30 * * * *`
- 默认自定义域名：`dsh-plugin.store`（含 `www.dsh-plugin.store`）

Fork 后请先替换自定义域名，并创建自己的 D1 数据库，将返回的 `database_id` 写入 `vite.config.ts`：

```bash
npm ci
npx wrangler d1 create dsh-plugin-hub-visits
npm run build
npx wrangler d1 migrations apply dsh-plugin-hub-visits --remote --config dist/server/wrangler.json
npx wrangler deploy --config dist/server/wrangler.json
```

首次启用计数时，可在 Cloudflare GraphQL Analytics 中按自定义域名、路径 `/`、`requestSource: eyeball` 查询切换时刻之前的根页面请求数，再将结果写入 `historical_root_views`。切换之后的新请求只增加 `tracked_root_views`，两段不会相互覆盖。

生产环境可选配置 GitHub Token，以提高 API 限额：

```bash
npx wrangler secret put GITHUB_TOKEN --config dist/server/wrangler.json
```

部署前可用 `npm test` 完成与 CI 相同的主要验证。

## 项目结构

```text
app/                       页面、交互和 Next 风格 API route
worker/                    Cloudflare Worker 入口与增量插件注册表
lib/                       数据类型和插件静态筛查逻辑
migrations/                D1 访问计数表迁移
scripts/sync-plugins.mjs   本地只读数据同步
data/                      精选回退与构建时注册表清单/分片
public/plugins.json        对外快照清单
public/plugins-snapshot-v1/ 对外静态注册表分片
tests/                     筛查规则、SSR、API 与一致性测试
prototype/                 最初的设计原型，保留作视觉对照
```

## 参与贡献

欢迎提交以下类型的改进：

- 修正插件元数据、分类或安装命令；
- 补充可解释、低误报的仓库事实采集规则；
- 改善移动端、无障碍、双语文案和数据可视化；
- 为自动同步、API 和 Cloudflare 运行链路补测试。

提交 Pull Request 前请运行：

```bash
npm run lint
npm test
```

涉及事实采集规则的改动，请同时增加最小正例和反例测试。请勿在 Issue、日志或测试夹具中提交真实 Token、私有仓库内容或用户配置。

## 安全与责任边界

- 自动检查不会运行第三方插件，也不会代表项目作者为插件背书；
- 推荐安装命令不锁定 commit，安装前请自行查看目标仓库当前状态；本站不做安全审计与背书；
- README 声明与静态信号可能过期，安装前仍应查看目标仓库源码和发布记录；
- 发现本站漏洞时，请优先使用 GitHub Private Vulnerability Reporting，避免公开敏感复现细节。

## 致谢

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
- 所有公开插件、文档和安全边界的社区维护者

## 许可证

本项目采用 [MIT License](./LICENSE)。

## 自动部署

push 到 `main` 分支后，[.github/workflows/deploy.yml](.github/workflows/deploy.yml) 会使用仓库内已跟踪的快照完成测试（含 lint + typecheck + build），然后部署 Worker、应用 D1 migrations 并通知搜索引擎。每日 UTC 2:17 只运行构建检查，不部署；线上插件目录由 Worker Cron 每 30 分钟增量同步，并定期全量扫描。也可通过 `workflow_dispatch` 手动部署。

### 仓库 Secrets 配置

在仓库 **Settings → Secrets and variables → Actions** 中配置以下 Secrets：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API Token，创建时权限模板选择 **Edit Cloudflare Workers**（含 Workers Scripts 编辑/部署权限） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账号 ID（Dashboard 右下角查看，或 `npx wrangler whoami`） |

`GITHUB_TOKEN` 无需配置为部署 Secret。手动运行 `npm run data:sync` 时，可在本地设置它以提高 GitHub Search API 限额；部署 workflow 使用已跟踪的回退快照，不执行全量数据同步。

### 首次部署前（一次性手工步骤）

1. 创建 D1 数据库并记下返回的 `database_id`：
```bash
npx wrangler d1 create dsh-plugin-hub-visits
```
2. 将 `database_id` 写入 `vite.config.ts` 中 `d1_databases` 下 `VISIT_METRICS` 绑定的 `database_id` 字段。
3. 配置好上述 Secrets 后推送 `main` 即可触发首次自动部署；Workers cron（数据增量扫描）随部署自动生效。
