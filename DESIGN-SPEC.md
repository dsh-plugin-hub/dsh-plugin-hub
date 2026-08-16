# DeepSeek Harness 官方样式对齐规范（Design Spec）

> 对齐目标：https://www.deepseek.com/harness/（DeepSeek Harness 开发者预览版官网）
> 数据来源：2026-08-16 抓取官网 CSS（/harness/_next/static/css/6f322bb0cffe2c36.css）、页面 HTML 与 JS chunk（app/[locale]/page）逐一提取，非猜测。
> 适用范围：DSH 插件目录站（本仓库）全部页面与组件。

**重要边界**：本规范对齐的是视觉语言（配色、字体、圆角、间距、动效气质），**不复制 DeepSeek 商标、logo 与官方文案**；站点名称、logo、图标保持独立。

---

## 目录

1. [官方设计语言总览](#1-官方设计语言总览)
2. [设计 Token 规范](#2-设计-token-规范)
3. [字体与排版](#3-字体与排版)
4. [主题机制](#4-主题机制)
5. [布局规范](#5-布局规范)
6. [组件规范](#6-组件规范)
7. [动效规范](#7-动效规范)
8. [动态背景专项规范](#8-动态背景专项规范)
9. [移植实施规范](#9-移植实施规范)
10. [验收清单](#10-验收清单)
11. [附录：GLSL 着色器源码](#11-附录glsl-着色器源码)

---

## 1. 官方设计语言总览

DeepSeek Harness 官网的视觉气质可以概括为：

- **深色优先**：harness 页面默认 `data-theme="dark"`（背景 #0a0a0a），亮色是次要主题；
- **克制的品牌蓝**：主品牌色 #4d6bfe（亮色）/ #6799fe（深色），大面积留白，蓝色只用于强调、链接、图标、shader 光斑；
- **玻璃拟态**：半透明 surface + `backdrop-filter: blur(12px)` 广泛用于 header、按钮、浮层；
- **大圆角**：卡片 24px、面板 16px、按钮/胶囊 100px，几何感强、无直角；
- **几何无衬线字体**：西文显示用 Montserrat / Host Grotesk，正文 DM Sans，代码 Fragment Mono，中文回退 Noto Sans SC / PingFang SC；
- **动态氛围背景**：WebGL 流动渐变 + 点阵 + 光斑，作为氛围层压在内容之下（详见第 8 章）；
- **微动效密集但克制**：入场淡入+位移+去模糊、按钮涟漪、滚动触发的上浮，时长 0.3-0.9s。

一句话：**暗色玻璃 + 蓝色渐变流体背景 + 大圆角 + 几何字体**。

---

## 2. 设计 Token 规范

以下 token 全部摘自官网 CSS 的 `--ds-*` 变量定义，**原样照抄到本项目**，不得改值。

### 2.1 颜色 — 浅色主题（:root）

| Token | 值 | 用途 |
|---|---|---|
| `--ds-color-brand` | `#4d6bfe` | 品牌蓝（链接/强调/图标） |
| `--ds-color-brand-deep` | `#3a65c2` | 深品牌蓝 |
| `--ds-color-brand-medium-reverse` | `#4176e6` | 深色背景上的品牌蓝 |
| `--ds-color-brand-light-reverse` | `#73a3d2` | 浅品牌蓝 |
| `--ds-color-text-primary` | `#1e232c` | 主文字（偏蓝黑） |
| `--ds-color-text-primary-bluish` | `#121c31` | 主文字（更蓝） |
| `--ds-color-text-secondary` | `rgba(0,0,0,.7)` | 次级文字 |
| `--ds-color-text-description` | `rgba(0,0,0,.65)` | 描述文字 |
| `--ds-color-text-placeholder` | `#8691a1` | 占位符 |
| `--ds-color-text-inverse` | `#fff` | 反色文字 |
| `--ds-color-text-link-blue` | `#234792` | 正文内链接蓝 |
| `--ds-color-static-white` | `#fff` | 固定白 |
| `--ds-color-static-black` | `#0f0f0f` | 固定黑 |
| `--ds-color-bg-page` | `#f9f8f8` | 页面背景（暖白） |
| `--ds-color-bg-surface-1` | `hsla(0,0%,100%,.3)` | 表面 1（半透明白） |
| `--ds-color-bg-surface-2` | `hsla(0,0%,100%,.2)` | 表面 2 |
| `--ds-color-bg-surface-3` | `rgba(0,0,0,.03)` | 表面 3（浅灰） |
| `--ds-color-bg-surface-4` | `rgba(0,0,0,.02)` | 表面 4 |
| `--ds-color-bg-surface-5` | `rgba(0,0,0,.05)` | 表面 5 |
| `--ds-color-bg-overlay` | `#fff` | 浮层底 |
| `--ds-color-bg-surface-raised` | `hsla(0,0%,100%,.45)` | 抬升表面（玻璃） |
| `--ds-color-bg-hero-cta` | `hsla(0,0%,100%,.38)` | hero CTA 底 |
| `--ds-color-bg-code` | `rgba(0,0,0,.05)` | 代码块底 |
| `--ds-color-bg-hover` | `rgba(0,0,0,.04)` | hover 底 |
| `--ds-color-bg-input` | `hsla(0,0%,100%,.2)` | 输入框底 |
| `--ds-color-bg-input-hover` | `hsla(0,0%,100%,.36)` | 输入框 hover |
| `--ds-color-bg-dark` | `#1a1615` | 深色块（暖黑，浅色主题下主按钮底色） |
| `--ds-color-border-subtle` | `rgba(0,0,0,.06)` | 最浅边框 |
| `--ds-color-border-default` | `rgba(0,0,0,.1)` | 默认边框 |
| `--ds-color-border-divider` | `rgba(0,0,0,.08)` | 分隔线 |
| `--ds-color-border-hover` | `hsla(20,1%,45%,.2)` | hover 边框 |
| `--ds-color-border-strong` | `rgba(0,0,0,.2)` | 强边框 |
| `--ds-color-border-secondary` | `rgba(9,45,78,.14)` | 次级边框（偏蓝） |
| `--ds-color-border-input` | `hsla(0,0%,100%,.2)` | 输入框边框 |
| `--ds-color-scrollbar` | `rgba(0,0,0,.15)` | 滚动条 |

### 2.2 颜色 — 深色主题（[data-theme=dark]，harness 页默认）

| Token | 值 |
|---|---|
| `--ds-color-brand` | `#6799fe` |
| `--ds-color-brand-deep` / `brand-medium-reverse` | `#fff` |
| `--ds-color-brand-light-reverse` | `#73a3d2` |
| `--ds-color-text-primary` / `-bluish` | `#fff` |
| `--ds-color-text-secondary` | `hsla(0,0%,100%,.8)` |
| `--ds-color-text-description` | `hsla(0,0%,100%,.5)` |
| `--ds-color-text-placeholder` | `hsla(0,0%,100%,.3)` |
| `--ds-color-bg-page` | `#0a0a0a` |
| `--ds-color-bg-surface-1..5` | `hsla(0,0%,100%,.06/.04/.02/.015/.12)` |
| `--ds-color-bg-overlay` | `#262626` |
| `--ds-color-bg-surface-raised` | `hsla(0,0%,100%,.25)` |
| `--ds-color-bg-code` | `rgba(0,0,0,.35)` |
| `--ds-color-bg-hover` | `hsla(0,0%,100%,.06)` |
| `--ds-color-bg-input` / hover | `hsla(0,0%,100%,.08)` / `.12` |
| `--ds-color-bg-dark` | `#fff` |
| `--ds-color-border-subtle/default/divider/hover/strong/secondary` | `hsla(0,0%,100%,.08/.06/.25/.2/.24/.2)` |
| `--ds-btn-primary-bg/text` | `#fff` / `#0a0a0a`（深色主题主按钮是白底黑字） |
| `--ds-btn-primary-hover-bg` | `rgba(0,0,0,.2)` |
| `--ds-btn-secondary-bg` | `var(--ds-color-bg-surface-1)`；text `#fff`；border `hsla(0,0%,100%,.15)` |
| `--ds-btn-ghost-text` | `#fff`；hover-bg `hsla(0,0%,100%,.08)` |
| `--ds-shadow-card` | `inset 0 1px 0 hsla(0,0%,100%,.12)`（深色卡片阴影为内描边） |

> 另有「高对比浅色」变体（部分页面用）：text-primary `#202124`、bg-page `#fff`、border `rgba(32,33,36,.14)`、surface-raised `hsla(0,0%,100%,.84)`。本项目默认深色 + 浅色两套即可。

### 2.3 按钮 token（两主题通用结构）

| Token | 浅色值 | 深色值 |
|---|---|---|
| `--ds-btn-primary-bg` | `#1a1615` | `#fff` |
| `--ds-btn-primary-text` | `#fff` | `#0a0a0a` |
| `--ds-btn-secondary-bg` | `hsla(0,0%,100%,.4)` | `var(--ds-color-bg-surface-1)` |
| `--ds-btn-secondary-text` | `#1e232c` | `#fff` |
| `--ds-btn-secondary-border` | `rgba(9,45,78,.18)` | `hsla(0,0%,100%,.15)` |
| `--ds-btn-ghost-text` | `#121c31` | `#fff` |
| `--ds-btn-ghost-hover-bg` | `rgba(0,0,0,.04)` | `hsla(0,0%,100%,.08)` |

### 2.4 间距（4px 基数）

| Token | 值 | | Token | 值 |
|---|---|---|---|---|
| `--ds-space-1` | 4px | | `--ds-space-7` | 40px |
| `--ds-space-2` | 8px | | `--ds-space-8` | 56px |
| `--ds-space-3` | 12px | | `--ds-space-9` | 80px |
| `--ds-space-4` | 16px | | `--ds-space-10` | 120px |
| `--ds-space-5` | 24px | | `--ds-space-11` | 160px |
| `--ds-space-6` | 32px | | `--ds-space-12` | 200px |
| `--ds-space-13` | 240px | | | |

### 2.5 圆角 / 阴影 / 模糊

| Token | 值 | 用途 |
|---|---|---|
| `--ds-radius-pill` | `100px` | 按钮、header、胶囊、chips |
| `--ds-radius-card` | `24px` | 大卡片 |
| `--ds-radius-panel` | `16px` | 面板、抽屉 |
| `--ds-radius-media` | `10px` | 图片、媒体 |
| `--ds-radius-input` | `10px` | 输入框、代码块 |
| `--ds-radius-sm` | `8px` | 小元素 |
| `--ds-blur-glass` | `12px` | 玻璃拟态 backdrop-filter |
| `--ds-shadow-card` | `0 0 0 1px #f1f5f9, 0 2px 4px rgba(0,0,0,.05), 0 12px 24px rgba(0,0,0,.05)` | 浅色卡片阴影（1px 描边 + 双层投影） |

---

## 3. 字体与排版

### 3.1 字体栈（官网原值）

```css
--ds-font-display: 'Host Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--ds-font-body: 'DM Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans SC', 'PingFang SC', sans-serif;
--ds-font-mono: 'Fragment Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', monospace;
--ds-font-sans: var(--ds-font-body);
```

**注意**：大标题实际用的不是 Host Grotesk 而是 **Montserrat**（官网 `.ds-text-hero` / `.ds-text-heading1` 写死 `'Montserrat', var(--ds-font-sans)`，中文字符自动回退 DM Sans → PingFang SC）。

### 3.2 字号标度（官网 .ds-text-* 精确值）

| 类名 | 字体 | 字号（移动→桌面） | 字重 | 行高 | 字距 |
|---|---|---|---|---|---|
| `.ds-text-hero` | Montserrat | 36px → 46px | 500 | 150% | -0.02em |
| `.ds-text-heading1` | Montserrat | 28px → 36px | 500 | 150% | -0.02em |
| `.ds-text-subtitle` | sans | 20px | 500 | 150% | -0.01em |
| `.ds-text-title` | sans | 18px | 500（中文 400） | 150% | -0.01em |
| `.ds-text-body` | sans | 16px | 400 | 160% | —（`text-wrap: pretty`） |
| `.ds-text-caption` | sans | 14px | 400 | 150% | — |
| hero 眉题（eyebrow） | sans | 16→17→18px | 500 | 1 | -0.01em |
| 代码 | mono | 14px | 400 | — | — |

**中文排印规则**：`:lang(zh)` 下 title 降字重到 400；正文 160% 行高；大标题中文使用 Montserrat 缺失自动回退到系统中文黑体，视觉上保持一致字重即可。

### 3.3 字体自托管清单（官网 /harness/fonts/ 可直接下载）

| 文件 | 用途 | 官网 URL |
|---|---|---|
| host-grotesk-latin.woff2 / -latin-ext / -italic ×2 | display 备用字体 | https://www.deepseek.com/harness/fonts/host-grotesk-latin.woff2 等 |
| dm-sans-400/500/700.woff2 | 正文（三字重） | https://www.deepseek.com/harness/fonts/dm-sans-400.woff2 等 |
| Montserrat | 大标题（官网 CSS 引用但未在本页自托管，Google Fonts OFL 免费） | fonts.google.com |
| Fragment Mono | 代码（OFL 免费，Google Fonts） | fonts.google.com |
| Noto Sans SC 300-600 | 中文（官网从 Google Fonts 加载） | fonts.googleapis.com |

> 落地：`public/fonts/` 自托管全部 woff2（subsets 按需裁剪），`font-display: swap`，与官网一致对首屏关键字体做 preload。

---

## 4. 主题机制

- 主题通过 `<html data-theme="dark">` / `data-theme="light"` 切换，全部 token 在 CSS 变量层翻转；
- **harness 页面默认深色**（官网 HTML 实测 `<html lang="zh-CN" data-theme="dark">`）；本项目建议：默认深色，提供 light 切换（存 localStorage），`color-scheme` 同步；
- 无闪白：SSR 输出时按 cookie/默认值直接渲染 `data-theme`，客户端水合后再允许切换。

---

## 5. 布局规范

| 项 | 规范 |
|---|---|
| 容器 `.ds-container` | `width: min(100% - 48px, 1140px)`（移动/桌面）；宽屏 `min(100% - 160px, 1280px)`；`margin-inline: auto` |
| Hero 高度 | 移动端 `min-height: 100svh`；桌面 `height: 100vh; max-height: 1000px` |
| Hero 网格 | `grid-cols-1`（移动）→ `md:grid-cols-[60fr_40fr]`（文案 60% / 预览 40%），`gap-ds-9`，垂直居中 |
| Hero 内边距 | `pt-ds-11 pb-ds-11` |
| 区块节奏 | 首段 `pt-ds-9 pb-ds-11`；中部段 `py-ds-10`；结尾 CTA 段 `pt-ds-11 pb-ds-13` |
| 标题下距 | h2 → 下 `mt-ds-4 mb-ds-9`；h3 → `mb-ds-2`；段落组 `gap-ds-2` |
| 卡片网格 | 3 列 `gap-ds-6/9`；卡片内 `p-ds-7`、`gap-ds-3` |
| 断点 | 沿用 Tailwind 默认（md=768px 起显示点阵/桌面元素；宽屏容器 1280px） |
| 首屏视觉结构 | 顶部背景氛围层（shader）+ 玻璃 header + 居中 60/40 内容 + 底部渐隐遮罩 |

---

## 6. 组件规范

### 6.1 Header（官网 .ds-header-wrapper/.ds-header-bar）

- 固定顶部：`position: fixed; top: 0; z-index: 50`；宽度与容器一致（`min(100% - 48px, 1140px)`，宽屏 1280px）；`padding: 8px 0 0`；
- 药丸形条：`border-radius: var(--ds-radius-pill)`；默认透明；
- 滚动后玻璃化：`.is-scrolled` 时显示 `::before` 背景层 —— `background: var(--ds-color-bg-surface-raised)` + `backdrop-filter: blur(12px)` + `border: 1px solid var(--ds-color-border-default)`，过渡 `opacity .4s ease-in-out`；
- 内容：左 logo（独立设计，不用 DeepSeek logo）；右导航链接（ghost 样式）+ GitHub 图标按钮 + 语言切换（`.ds-locale-toggle` 药丸分段控件，激活项 `is-active`）+ 移动端汉堡菜单。

### 6.2 按钮体系

**变体**：`primary`（浅色主题暖黑底 `#1a1615` 白字 / 深色主题白底黑字）、`secondary`（玻璃：半透明底 + blur + 边框）、`ghost`（透明，hover 浅底）、`ghost-static`（固定场景）、`liquid`（hero 用）、`text`（纯文字）。

**基座**（所有变体）：`display:flex; align-items:center; gap:6px; border-radius: var(--ds-radius-pill); font-weight:500; line-height:120%; overflow:hidden; isolation:isolate;`

**涟漪 hover**：`::after` 绝对定位圆形（`width:150%; aspect-ratio:1; border-radius:50%`）中心缩放到 1，`transition: transform .36s ease-out, opacity .1s ease`，底色用变体的 hover-bg token。

**尺寸**：
| 尺寸 | 字号 | 内边距 | 图标 |
|---|---|---|---|
| `ds-btn-m` | 15px | 11px 18px | 16px svg |
| `ds-btn-s` | 14px | 8px 12px | — |
| `ds-btn-xs` | 14px | 6px 12px | — |

### 6.3 卡片 / 面板

- 卡片：`border-radius: var(--ds-radius-card)`（24px）+ 浅色主题 `--ds-shadow-card` 三层阴影 / 深色主题 `inset 0 1px 0 hsla(0,0%,100%,.12)` 内描边；
- 表面层次优先用 `bg-ds-surface-1/3` 半透明 token，避免实色灰；
- 面板/抽屉：`--ds-radius-panel`（16px）+ 玻璃 blur；
- 卡片内节奏：标题（ds-text-title）→ 描述（text-ds-description）→ 操作行，间距 `gap-ds-3`，内边距 `p-ds-7`。

### 6.4 代码块 / 终端样式（官网「快速体验」段实测）

```
容器: rounded-[10px] border border-ds-border-default bg-ds-surface-1 px-ds-4 py-[14px]
代码: font-mono text-[14px] text-ds-primary
提示符: <span class='select-none text-ds-brand'>$ </span>   ← 品牌蓝
复制钮: text-[12px] text-ds-description hover:text-ds-primary transition-colors
```

### 6.5 徽章 / 标签 / 筛选 chips

- 一律药丸形（radius-pill），字号 14px（caption）；
- 中性态：`bg-ds-surface-3` + `border-ds-border-subtle` + `text-ds-secondary`；
- 强调态（选中/品牌）：`text-ds-brand` 或品牌色文字 + `bg` 透明，用 `--ds-color-brand` 的 10% 透明度底；
- 本目录站的「manifest 已核验」「安装时运行 postinstall」等事实标签：中性灰/品牌蓝两档即可，不加红绿语义色（除非有明确风险等级）。

### 6.6 搜索输入

- `border-radius: var(--ds-radius-input)`（10px）；底 `--ds-color-bg-input`，hover `--ds-color-bg-input-hover`，focus 边框 `--ds-color-border-input-focus`；
- 占位符 `--ds-color-text-placeholder`；图标 16px；容器可用玻璃底（surface-raised + blur）。

### 6.7 页脚

- 顶部分隔线 `border-top: 1px solid var(--ds-color-border-subtle)` + `padding-top: var(--ds-space-9)`；
- 容器内 `pb-ds-6`；链接行 `flex flex-wrap gap-x-ds-3 gap-y-ds-2`；文字 `text-ds-description`、14px。

### 6.8 语言切换 / 自定义光标

- 语言切换：药丸分段控件，激活项 `is-active`（背景 surface-raised + blur）；
- 自定义光标环 `.ds-cursor-ring`（桌面 hover 设备）：`position:fixed; z-index:9999; width/height:64px; border-radius:50%; mix-blend-mode:difference; pointer-events:none`，跟随鼠标平滑移动，`transition: width/height/margin .3s cubic-bezier(.16,1,.3,1)`。**可选**，属锦上添花。

---

## 7. 动效规范

| 动效 | 参数 | 说明 |
|---|---|---|
| hero 入场 `.ds-hero-enter` | `@keyframes: opacity 0→1 + translateY(var(--enter-y,20px))→0 + blur(var(--enter-blur,0))→0`；`0.8s ease-out backwards` | 各元素错峰：标签/标题 `--enter-y:24px; --enter-blur:10px; 0.9s`；描述 `--enter-y:20px; --enter-blur:8px; delay .15s`；按钮组 `--enter-y:16px; 0.7s; delay .3s` |
| 滚动入场 | 元素初始 `opacity:0; filter:blur(10px); translateY(40px)`，进入视口后过渡到正常（约 0.6-0.8s） | 用于「加入生态」等区块标题 |
| 按钮涟漪 | 圆形 `::after` scale 0→1，`transform .36s ease-out, opacity .1s ease` | 见 6.2 |
| hover 过渡 | 文字色/边框色 `transition: color/border-color .2-.35s ease`；玻璃层显隐 `.4s ease-in-out` | 全部软过渡，无线性 |
| 背景 shader 节流 | `requestAnimationFrame` 30 FPS（`1000/30` 间隔），DPR ≤ 1.5，离屏暂停（IntersectionObserver），触屏跳过鼠标交互 | 见第 8 章 |
| 缓动偏好 | `cubic-bezier(.16,1,.3,1)`（快出缓停）用于位移类 | |

原则：**动效只做氛围与反馈，不阻塞内容**；所有动画尊重 `prefers-reduced-motion`（关闭 shader 动画与位移）。

---

## 8. 动态背景专项规范

官网的动态背景是**四层叠加**：WebGL2 流动渐变（主氛围） + 2D Canvas 点阵（桌面） + CSS 发光光斑 + 遮罩渐隐。以下为逐层逆向结论与实现参数。

### 8.1 Hero 背景层叠结构（官网 HTML 实测）

```html
<section class="relative flex items-center w-full ds-hero-height">
  <!-- L1 z-0: WebGL 渐变，模糊 + 底部渐隐遮罩 -->
  <div class="absolute inset-0 z-0 overflow-hidden"
       style="mask:linear-gradient(#000000fc 0%, #000000e8 8.98%, transparent 100%);
                  filter:blur(20px); opacity:0(→1 由 JS 淡入)">
    <canvas style="position:absolute;top:0;left:0;width:100%;height:100%"></canvas>
  </div>
  <!-- L2 z-5: 2D 点阵（仅 md+ 显示） -->
  <div class="absolute inset-0 z-[5] hidden md:block" style="mask: 同上">
    <canvas style="...;background:transparent"></canvas>
  </div>
  <!-- L3 z-2: 发光体（mix-blend-mode:screen，动态组件，md+） -->
  <div class="absolute inset-0 z-[2] hidden md:flex items-center justify-center pointer-events-none overflow-hidden"
       style="mix-blend-mode:screen">
    <div class="w-[800px] h-[800px] ml-[100px] shrink-0">…动态组件…</div>
  </div>
  <!-- 内容层 z-10: ds-container 60/40 网格 -->
  <div class="relative z-10 ds-container grid grid-cols-1 gap-ds-9 items-center pt-ds-11 md:grid-cols-[60fr_40fr] pb-ds-11">…</div>
</section>
```

**遮罩公式（两处背景层共用）**：`linear-gradient(#000000fc 0%, #000000e8 8.98%, transparent 100%)` —— 顶部 99% 不透明 → 8.98% 处 91% → 底部全透明，让渐变背景「沉入」页面背景色。

### 8.2 WebGL2 流动渐变系统（核心）

**技术栈**：`canvas.getContext('webgl2', { alpha:true, premultipliedAlpha:false, powerPreference:'low-power' })` + 三个 fragment shader 程序（flowmap 累积器 / 渐变主渲染 / FBM 流体），全屏三角带（TRIANGLE_STRIP, 4 顶点）绘制。

**渲染管线（每帧）**：

```
1. 鼠标状态：原始坐标 x,y → 指数平滑 smoothX/Y（mouseSmoothing）→ 平滑速度 svx/svy（mouseVelocity）
2. Pass A（离屏 FBO ping-pong）：flowmap 着色器把鼠标影响写入纹理
   - r 通道 = 影响强度（高斯刷 exp(-d²/(r²·0.5))，随 u_decay 指数衰减）
   - gb 通道 = 鼠标速度方向编码（velocity*2+0.5 clamp 到 0..1）
3. Pass B（屏幕）：渐变着色器读 flowmap → 扭曲/漩涡/发光随影响强度增强
4. 30 FPS 节流 + IntersectionObserver 离屏暂停 + 触屏设备跳过鼠标
```

**主渐变着色器 uniform 与默认值（源码实测）**：

| uniform | 作用 | 默认/参考 |
|---|---|---|
| `u_colors` | 渐变色板 | `['#2E58A4', '#D2E2EE', '#FFFFFF']`（深蓝→雾蓝→白） |
| `u_colorCount` | 色板色数 | 3 |
| `u_speed` | 时间流速 | `u_time = 秒 × (speed/100)` |
| `u_scale` | 噪声尺度 | 参考 ~1 |
| `u_distortion / u_distortBoost` | 基础扭曲 / flowmap 附加扭曲 | 与鼠标联动 |
| `u_swirl / u_swirlBoost / u_swirlIterations` | 漩涡强度 / 鼠标附加 / 迭代次数 | 迭代 1..30 clamp |
| `u_noiseBoost` | 鼠标区噪声扰动 | |
| `u_glowIntensity + u_glowColor1..3` | 鼠标区三色辉光 | glow 默认白，随鼠标影响强度混合 |
| `u_mouseRadius / u_mouseStrength / u_decay` | 刷子半径/强度/衰减（flowmap 用） | |
| `u_mouseSmoothing / u_mouseVelocity` | 鼠标平滑系数 | 参考 .08~.2 |
| `u_proportion / u_softness` | 色带比例/软硬边 | |
| `u_shape / u_shapeScale` | 底层形状波 | `shape = .5 + .5·sin(cuv.x)·cos(cuv.y)` |

另有 `type:'fluid'` 变体：3D simplex noise（snoise/fbm/fluidNoise/curlish 域扭曲），uniform 含 `u_lightPos/u_lightCore/u_lightHalo/u_vignette/u_bloomThreshold/u_bloomRange/u_bloomStrength/u_grain` —— 用于「加入生态」等区块。

### 8.3 2D 点阵背景（L2）

- `getContext('2d')`；`(hover:none), (pointer:coarse)` 设备直接跳过；
- DPR 上限 2；网格间距 **90px**；
- 每点含 `restX/restY`（静止位）+ `x/y`（当前位）+ `vx/vy`（速度），**鼠标靠近 → 点被推开 → 弹簧回位**（经典 dot-grid 交互）；
- 默认色：点/线 `rgba(60, 100, 160, …)`（灰蓝，透明度低）；30 FPS 节流；
- 纯 CSS 替代 `.ds-grid-bg`（无交互版）：`linear-gradient` 画 90px 网格线 `rgba(0,0,0,.025)`，四边用 mask 渐隐。

### 8.4 CSS 发光光斑（「加入生态」段实测）

三个纯 CSS 光斑叠在内容下方（无需 GPU shader 即可复用）：

| 光斑 | 位置/尺寸 | 渐变 | 模糊/透明度 |
|---|---|---|---|
| 1 | `bottom:-100px; left:10%; 500×500` | `radial-gradient(circle, #1A3870 0%, transparent 70%)` | blur(80px) / 0.3 |
| 2 | `bottom:-50px; left:50%; -translate-x-1/2; 700×400` | `radial-gradient(ellipse at center, #2D5F9E 0%, #1A3870 40%, transparent 70%)` | blur(100px) / 0.4 |
| 3 | `bottom:-80px; right:10%; 400×400` | `radial-gradient(circle, #4A8AC4 0%, #2D5F9E 30%, transparent 70%)` | blur(60px) / 0.2 |

「加入生态」段结构：`max-height:720px; overflow:hidden` 容器 → 顶部 `-inset-[30%]` 动态发光层（`mix-blend-mode:screen` + `mask:radial-gradient(ellipse 60% 60% at center, black 0%, transparent 70%)`）→ 500px 高 shader canvas（双向 mask：上下 `transparent 0%/black 20%/black 80%/transparent 100%` ∩ 左右 `transparent 0%/black 15%/black 85%/transparent 100%`，`mask-composite:intersect`）→ 光斑 → 内容。

### 8.5 性能与降级策略（官网做法，照搬）

1. **30 FPS 节流**：rAF 回调内 `if (now - last < 1000/30) return`；
2. **DPR 上限**：WebGL 1.5、点阵 2.0，超高分屏不追满分辨率；
3. **离屏暂停**：IntersectionObserver（threshold 0）翻转可见性，不可见停画；
4. **触屏跳过**：`(hover:none),(pointer:coarse)` 不注册 mousemove，shader 退化为纯自动动画；
5. **上下文失败回退**：getContext 失败 → 隐藏 canvas，用 CSS 光斑/渐变兜底（页面仍完整）；
6. **prefers-reduced-motion**：关闭时间推进与位移动效（静态帧或纯色）；
7. 首选 `powerPreference:'low-power'`；resize 只在尺寸变化时重建。

### 8.6 我们的实施方案

| 方案 | 保真度 | 成本 | 适用 |
|---|---|---|---|
| A. 完整移植 WebGL shader（附录 11 含官方 GLSL 全源码） | 100% | 中（React 组件 + shader 编译管理，约 300-400 行） | 首屏 hero、生态 CTA 段 |
| B. CSS 近似：多组 `radial-gradient` 光斑（#1A3870/#2D5F9E/#4A8AC4 + blur 60-100px）+ 缓慢 keyframes 漂移 + 点阵用 `.ds-grid-bg` | 60% | 低（纯 CSS） | 其余区块、降级兜底 |
| C. 静态渐变图 + 遮罩 | 30% | 极低 | 极端兼容 |

**建议组合：Hero 用 A + 点阵；全站区块用 B 光斑；A 不可用时自动落 B。** 移植时组件接口对齐官方 props：`type('gradient'|'fluid'), colors, glowColors, speed, scale, distortion, swirl, mouseStrength, mouseRadius, decay, mouseSmoothing, mouseVelocity`。

**注意**：本目录站的 hero 是插件列表场景，渐变背景的默认色板沿用官方深蓝系（#2E58A4/#D2E2EE/#FFFFFF），但可以替换为本站品牌色板；背景仅作氛围层，文字对比度必须满足 WCAG AA（深色页面上文字 #fff / 描述 ≥ 50% 白）。

---

## 9. 移植实施规范

本项目技术栈：Vinext（Next.js 兼容）+ Tailwind CSS 4 + 手写 CSS 变量。移植分四步：

### 9.1 第 1 步：CSS 变量层（globals.css）

```css
:root { /* 第 2 章全部 --ds-* token 原样照抄（浅色主题） */ }
html[data-theme='dark'] { /* 第 2.2 章深色覆盖 */ }
```

### 9.2 第 2 步：Tailwind 4 映射（@theme）

Tailwind 4 中在 `@theme` 注册命名空间即可自动生成 `text-ds-primary`、`p-ds-9`、`rounded-ds-card` 等工具类（与官网类名一致，直接复用其 HTML 模式）：

```css
@theme {
  --color-ds-brand: var(--ds-color-brand);
  --color-ds-primary: var(--ds-color-text-primary);
  --color-ds-description: var(--ds-color-text-description);
  --color-ds-surface-1: var(--ds-color-bg-surface-1);
  --color-ds-surface-3: var(--ds-color-bg-surface-3);
  --color-ds-border-default: var(--ds-color-border-default);
  --color-ds-border-subtle: var(--ds-color-border-subtle);
  --spacing-ds-1: 4px;  /* …ds-2..13 按第 2.4 章 */
  --radius-ds-card: var(--ds-radius-card);
  --radius-ds-panel: var(--ds-radius-panel);
  --radius-ds-input: var(--ds-radius-input);
}
```

### 9.3 第 3 步：组件映射（本站页面 ↔ 官网组件）

| 本站页面区域 | 对齐的官网组件 | 关键类 |
|---|---|---|
| 全局 header | ds-header-wrapper/bar（固定 + 滚动玻璃） | 6.1 |
| 首页 hero（站点名 + 搜索框） | hero 层叠结构 + ds-hero-enter 入场 | 5/8.1 |
| 搜索框 | 玻璃输入（radius-input + bg-input token） | 6.6 |
| 分类 chips | 药丸 chips（surface-3 + brand 选中态） | 6.5 |
| 插件卡片 | 卡片 24px 圆角 + shadow-card / 深色 inset 描边 | 6.3 |
| 安装命令 | 终端代码块（$ 提示符 brand 蓝 + 复制钮） | 6.4 |
| 排行榜/统计 | ds-text-hero/heading1 数字 + caption 说明 | 3.2 |
| 生态 CTA 段 | 「加入生态」段（shader canvas + 光斑 + 双向 mask） | 8.4 |
| 页脚 | 分隔线 + text-ds-description 链接行 | 6.7 |
| 插件详情抽屉 | panel 16px + 玻璃 + title/body/caption 层级 | 6.3 |
| 空态/加载 | 骨架用 surface-3 圆角条 + 轻微 shimmer | 6.5 |

### 9.4 第 4 步：字体与资源

- `public/fonts/` 自托管（3.3 清单）；大标题 Montserrat、正文 DM Sans 400/500/700、代码 Fragment Mono；
- hero/CTA 的 shader 组件放 `components/aurora-background.tsx`，全站统一引用，props 见 8.6；
- favicon/OG 图沿用本站独立标识，仅风格对齐（蓝 #4d6bfe 深色底）。

---

## 10. 验收清单

- [ ] `--ds-*` token 与第 2 章逐项一致（浅色 + 深色两套）；
- [ ] `<html data-theme>` 默认 dark，可切换，无闪白；
- [ ] 字体栈与 3.1 一致，全部 woff2 自托管，无 Google Fonts 运行时依赖；
- [ ] 字号标度符合 3.2（hero 46px / heading1 36px / body 16px 等）；
- [ ] 容器 1140/1280px、hero 100vh max-1000px、区块间距符合第 5 章；
- [ ] 按钮五种变体 + 涟漪 hover + m/s/xs 尺寸齐备；
- [ ] 终端代码块样式（brand 蓝 `$`、复制钮）与官网一致；
- [ ] hero 动态背景：30 FPS、DPR 上限、离屏暂停、触屏降级、失败回退 CSS 光斑；
- [ ] 深色主题下文字对比度达标（描述文字 ≥ 50% 白、主文字 #fff）；
- [ ] `prefers-reduced-motion` 下动效全部停用；
- [ ] 移动端：无点阵/光标环，网格单列，触摸目标 ≥ 44px。

---
---

## 11. 附录：GLSL 着色器源码

> 以下源码从官网页面 JS chunk（app/[locale]/page）逐字提取（2026-08-16），供方案 A 完整移植使用。顶点着色器全屏三角带为通用代码，三个程序共用：

```glsl
#version 300 es
in vec4 a_position;
out vec2 vUv;
void main() {
  vUv = a_position.xy * 0.5 + 0.5;
  gl_Position = a_position;
}
```

### 11.1 flowmap 累积着色器（Pass A：把鼠标影响写入离屏纹理）

```glsl
#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D u_prev;
uniform vec2 u_mouse;
uniform vec2 u_velocity;
uniform float u_brushRadius;
uniform float u_brushStrength;
uniform float u_decay;
out vec4 fragColor;

void main() {
  vec4 prev = texture(u_prev, vUv);

  prev.r *= u_decay;
  prev.gb = mix(vec2(0.5), prev.gb, u_decay);

  float dist = distance(vUv, u_mouse);

  float influence = exp(-dist * dist / (u_brushRadius * u_brushRadius * 0.5));
  influence = max(0.0, influence - 0.01);

  float speed = length(u_velocity);
  float presenceStrength = u_brushStrength * 0.3;
  float velBonus = min(speed * 3.0, 0.7) * u_brushStrength;
  float totalStrength = presenceStrength + velBonus;

  prev.r = max(prev.r, influence * totalStrength);
  float blendAmt = influence * min(totalStrength, 0.4) * 0.3;
  prev.g = mix(prev.g, clamp(u_velocity.x * 2.0 + 0.5, 0.0, 1.0), blendAmt);
  prev.b = mix(prev.b, clamp(u_velocity.y * 2.0 + 0.5, 0.0, 1.0), blendAmt);

  fragColor = prev;
}
```

### 11.2 渐变主着色器（Pass B：多色混合 + 噪声扭曲 + 漩涡 + 鼠标辉光）

```glsl
#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform float u_pixelRatio;
uniform vec2 u_resolution;
uniform float u_scale;
uniform float u_rotation;
uniform vec4 u_color1, u_color2, u_color3, u_color4, u_color5;
uniform float u_colorCount;
uniform float u_proportion;
uniform float u_softness;
uniform float u_shape;
uniform float u_shapeScale;
uniform float u_distortion;
uniform float u_swirl;
uniform float u_swirlIterations;
uniform vec2 u_offset;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_noiseBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1;
uniform vec3 u_glowColor2;
uniform vec3 u_glowColor3;
out vec4 fragColor;

#define TWO_PI 6.28318530718
#define PI 3.14159265358979323846

vec2 rotate(vec2 uv, float th) { return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv; }
float random(vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123); }
float noise(vec2 st) {
  vec2 i = floor(st); vec2 f = fract(st);
  float a = random(i), b = random(i + vec2(1,0)), c = random(i + vec2(0,1)), d = random(i + vec2(1,1));
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

vec3 blend_multi(float mixer, float softness) {
  float edge = 1.0 - softness;
  float n = u_colorCount;
  vec3 col = u_color1.rgb;
  if (n > 1.5) { col = mix(col, u_color2.rgb, smoothstep(0.0 + 0.2*edge, 1.0/(n-0.5) - 0.2*edge, mixer)); }
  if (n > 2.5) { col = mix(col, u_color3.rgb, smoothstep(1.0/(n-0.5) + 0.1*edge, 2.0/(n-0.5) - 0.1*edge, mixer)); }
  if (n > 3.5) { col = mix(col, u_color4.rgb, smoothstep(2.0/(n-0.5) + 0.1*edge, 3.0/(n-0.5) - 0.1*edge, mixer)); }
  if (n > 4.5) { col = mix(col, u_color5.rgb, smoothstep(3.0/(n-0.5) + 0.1*edge, 4.0/(n-0.5) - 0.1*edge, mixer)); }
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = .5 * u_time;
  float ns = .0005 + .006 * u_scale;
  uv -= .5; uv *= (ns * u_resolution); uv = rotate(uv, u_rotation * .5 * PI);
  uv /= u_pixelRatio; uv += .5; uv += u_offset;

  vec2 fragUV = gl_FragCoord.xy / u_resolution.xy;
  vec4 flow = texture(u_flowmap, fragUV);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  float n1 = noise(uv + t), n2 = noise(uv*2. - t);
  float angle = n1 * TWO_PI;

  float totalDistortion = u_distortion + influence * u_distortBoost;
  uv.x += 4. * totalDistortion * n2 * cos(angle);
  uv.y += 4. * totalDistortion * n2 * sin(angle);

  uv += flowDir * influence * 0.15;

  if (influence > 0.001) {
    float localNoise = noise(uv * 2.0 + t * 1.5);
    uv += influence * u_noiseBoost * vec2(cos(localNoise * TWO_PI), sin(localNoise * TWO_PI));
  }

  float iters = ceil(clamp(u_swirlIterations, 1., 30.));
  float swirlAmt = clamp(u_swirl, 0., 2.) + influence * u_swirlBoost;
  for (float i = 1.; i <= 30.0; i++) {
    if (i > iters) break;
    uv.x += swirlAmt / i * cos(t + i*1.5*uv.y);
    uv.y += swirlAmt / i * cos(t + i*1.*uv.x);
  }

  float proportion = clamp(u_proportion, 0., 1.);
  vec2 cuv = uv * (.5 + 3.5 * u_shapeScale);
  float shape = .5 + .5 * sin(cuv.x) * cos(cuv.y);
  float mixer = shape + .48 * sign(proportion - .5) * pow(abs(proportion - .5), .5);
  vec3 col = blend_multi(mixer, clamp(u_softness, 0., 1.));

  // Mouse proximity color shift: 3-color glow
  float glow = smoothstep(0.0, 0.8, influence);
  float glowNoise = noise(uv * 3.0 + u_time * 0.1) ;
  float glowDist = smoothstep(0.0, 1.0, influence);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);
  col = mix(col, glowMix, glow * u_glowIntensity);

  fragColor = vec4(col, 1.0);
}
```

### 11.3 FBM 流体着色器（type:fluid 变体，160 行完整版）

> 用 3D simplex noise（snoise/fbm/fluidNoise/curlish 域扭曲）替代 value noise，含虚拟光源、bloom、vignette、grain 后处理。

```glsl
#version 300 es
precision mediump float;
in vec2 vUv;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec3 u_c1, u_c2, u_c3, u_c4, u_c5;
uniform float u_scale;
uniform vec2 u_offset;
uniform float u_grain;
uniform float u_speed;
uniform sampler2D u_flowmap;
uniform float u_distortBoost;
uniform float u_swirlBoost;
uniform float u_glowIntensity;
uniform vec3 u_glowColor1;
uniform vec3 u_glowColor2;
uniform vec3 u_glowColor3;
uniform vec2 u_lightPos;
uniform float u_lightCore;
uniform float u_lightHalo;
uniform float u_vignette;
uniform float u_bloomThreshold;
uniform float u_bloomRange;
uniform float u_bloomStrength;
out vec4 fragColor;

vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);
  const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.;
  vec4 s1=floor(b1)*2.+1.;
  vec4 sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);
  m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}

float hash(vec2 p){
  vec3 p3=fract(vec3(p.xyx)*.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}

float fbm(vec3 p){
  float v=0.,amp=.6;vec3 shift=vec3(100.);
  for(int i=0;i<1;i++){v+=amp*snoise(p);p=p*2.+shift;amp*=.4;}
  return v;
}

float fluidNoise(vec2 uv,float t){
  float n1=fbm(vec3(uv*.6,t*.06));
  float n2=fbm(vec3(uv*.6+5.2,t*.06+1.3));
  vec2 w1=vec2(n1,n2)*.6;
  float n3=fbm(vec3((uv+w1)*.7+1.7,t*.05+3.1));
  float n4=fbm(vec3((uv+w1)*.7+9.2,t*.05+5.7));
  vec2 w2=vec2(n3,n4)*.5;
  return fbm(vec3((uv+w1+w2)*.5,t*.04));
}

vec2 curlish(vec2 uv,float t){
  float eps=.02;
  float n=snoise(vec3(uv*.8,t));
  float nx=snoise(vec3((uv+vec2(eps,0.))*.8,t));
  float ny=snoise(vec3((uv+vec2(0.,eps))*.8,t));
  return vec2(-(ny-n)/eps,(nx-n)/eps)*.003;
}

void main(){
  float aspect=u_resolution.x/u_resolution.y;
  vec2 uv=gl_FragCoord.xy/u_resolution;
  vec2 suv=vec2(uv.x*aspect, uv.y) * u_scale + u_offset;
  float t=u_time;

  // Mouse interaction via flowmap
  vec4 flow = texture(u_flowmap, uv);
  float influence = flow.r;
  vec2 flowDir = (flow.gb - 0.5) * 2.0;

  // Apply mouse distortion to UV
  suv += flowDir * influence * u_distortBoost * 0.8;
  // Apply mouse swirl
  float swirlAngle = influence * u_swirlBoost * 2.5;
  float cs = cos(swirlAngle), sn = sin(swirlAngle);
  vec2 delta = suv - vec2(uv.x * aspect, uv.y) * u_scale;
  suv += (mat2(cs, sn, -sn, cs) * delta - delta) * influence;

  vec2 curl=curlish(suv,t*.04);
  vec2 uvD=suv+curl*12.;
  float f=fluidNoise(uvD,t);
  float swirl=snoise(vec3(uvD*.8+f*1.5,t*.035))*.5+.5;
  float n=f*.5+.5;
  vec3 col=mix(u_c1,u_c2,smoothstep(.2,.5,n));
  col=mix(col,u_c3,smoothstep(.35,.65,n+swirl*.25));
  col=mix(col,u_c4,smoothstep(.6,.85,swirl)*.55);
  col=mix(col,u_c5,smoothstep(.5,.8,n*swirl)*.35);

  // Mouse proximity color shift: 3-color glow blended by distance + noise
  float glow = smoothstep(0.0, 0.8, influence);
  float glowNoise = snoise(vec3(uvD * 1.5, t * 0.08)) * 0.5 + 0.5;
  float glowDist = smoothstep(0.0, 1.0, influence);
  vec3 glowMix = mix(u_glowColor3, u_glowColor2, glowDist);
  glowMix = mix(glowMix, u_glowColor1, glowDist * glowNoise);
  col = mix(col, glowMix, glow * u_glowIntensity);

  if(u_grain>0.0){
    vec2 flowOffset = (uvD - suv) * u_resolution.y;
    vec2 gp = floor((gl_FragCoord.xy + flowOffset) / 5.0);
    float gr=hash(gp)*2.-1.;
    col+=gr*u_grain;
  }

  // Self-luminance bloom: bright fluid regions become their own light spots,
  // so glow follows the flow and mouse disturbance instead of a fixed point
  float luma=dot(col,vec3(.299,.587,.114));
  float bloom=smoothstep(u_bloomThreshold-u_bloomRange,u_bloomThreshold+u_bloomRange,luma);
  col+=(col*.85+vec3(.15,.145,.13))*bloom*u_bloomStrength;

  // Virtual light source: soft warm core (same side as helm lighting)
  float ld=length((uv-u_lightPos)*vec2(aspect,1.));
  float core=exp(-ld*ld*4.5);
  float halo=exp(-ld*1.8);
  col+=vec3(1.,.97,.9)*core*u_lightCore+vec3(.72,.8,1.)*halo*u_lightHalo;

  float vig=1.-smoothstep(.35,.75,length(uv-.5));
  col=mix(col*(1.-u_vignette),col,vig);
  fragColor=vec4(col,1.);
}
```

---

> 附：本规范数据来源 —— 官网 CSS /harness/_next/static/css/6f322bb0cffe2c36.css（44.7KB）与页面 chunk app/[locale]/page-6a50331094e9a8ae.js（74.9KB）。如官网样式更新，以官网为准重新抓取。
