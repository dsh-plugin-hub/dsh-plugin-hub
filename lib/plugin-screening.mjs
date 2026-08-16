// 插件事实/分类工具模块（无筛查判定）。
// P1-T2 已删除筛查体系（clear/review/blocked 三级判定、正则规则表、commit 锁定），
// 本模块只保留：manifest 解析、分类推断、安装命令派生、注册表字段白名单清洗。

export const LIFECYCLE_SCRIPTS = ["preinstall", "install", "postinstall", "prepare"];

export const LOCKFILES = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
]);

/** owner/name 格式校验（GitHub 命名：每段字母数字开头/结尾，中间可含 . _ -） */
const GITHUB_REPO_PATTERN = /^[a-z\d](?:[a-z\d._-]*[a-z\d])?\/[a-z\d](?:[a-z\d._-]*[a-z\d])?$/iu;

/** PluginRecord 字段白名单（新数据模型，不含 screening/screenedCommit/installCommand/attention） */
const PLUGIN_FIELD_WHITELIST = [
  "id", "order", "name", "owner", "repo", "url", "category", "description",
  "added", "curated", "topic", "stars", "forks", "openIssues", "watchers",
  "pushedAt", "updatedAt", "createdAt", "license", "language", "homepage",
  "archived", "defaultBranch", "maintenance", "manifest", "facts", "removed",
  "discovery",
];

/** PluginRegistryData.summary 字段白名单（已删除 screeningClear/screeningReview/screeningBlocked） */
const SUMMARY_FIELD_WHITELIST = [
  "curated", "listed", "autoDiscovered", "topicTotal",
  "metadataMatches", "manifestMatches", "owners", "stars",
];

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function exportPath(value) {
  if (typeof value === "string") return value;
  const record = asObject(value);
  for (const key of ["default", "import", "require", "node", "browser"]) {
    if (typeof record[key] === "string") return record[key];
  }
  return null;
}

function pickFields(source, whitelist) {
  const result = {};
  for (const key of whitelist) {
    if (key in source) result[key] = source[key];
  }
  return result;
}

export function normalizeRepositoryPath(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.length > 240 ||
    normalized.startsWith("/") ||
    normalized.includes("\\") ||
    normalized.includes("\0") ||
    normalized.split("/").includes("..") ||
    /^[a-z][a-z\d+.-]*:/iu.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

export function manifestSummary(pkg, branch) {
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    return {
      state: "missing",
      branch,
      kinds: [],
      packageName: null,
      version: null,
      lifecycleScripts: [],
      runtimeDependencies: 0,
      declaredPaths: [],
      invalidDeclaredPaths: [],
    };
  }

  const dsh = asObject(pkg.dsh);
  const kinds = ["bundle", "plugin", "profile", "client"].filter(
    (key) => dsh[key] !== undefined,
  );
  const scripts = asObject(pkg.scripts);
  const lifecycleScripts = LIFECYCLE_SCRIPTS.filter(
    (key) => typeof scripts[key] === "string" && scripts[key].trim(),
  );
  const exportsField = asObject(pkg.exports);
  const bundle = asObject(dsh.bundle);
  const candidates = [
    bundle.patch,
    pkg.main,
    exportPath(exportsField["."]),
    dsh.client === undefined ? null : exportPath(exportsField["./client"]),
  ].filter((value) => typeof value === "string");
  const declaredPaths = [];
  const invalidDeclaredPaths = [];
  for (const value of candidates) {
    const normalized = normalizeRepositoryPath(value);
    if (normalized) declaredPaths.push(normalized);
    else invalidDeclaredPaths.push(value);
  }

  return {
    state: kinds.length ? "verified" : "package-only",
    branch,
    kinds,
    packageName: typeof pkg.name === "string" ? pkg.name : null,
    version: typeof pkg.version === "string" ? pkg.version : null,
    lifecycleScripts,
    runtimeDependencies: Object.keys(asObject(pkg.dependencies)).length,
    declaredPaths: [...new Set(declaredPaths)].slice(0, 6),
    invalidDeclaredPaths: [...new Set(invalidDeclaredPaths)].slice(0, 6),
  };
}

/**
 * 从 PluginManifest 与仓库元数据 best-effort 计算纯事实字段（无判定）。
 * meta 支持多种输入形态：
 *   - license: SPDX id 字符串，或 { spdx_id } 对象
 *   - files: 仓库根文件清单（推导锁文件/README）
 *   - hasLockfile / hasReadme: 调用方预计算结果（优先于 files）
 */
export function deriveFacts(manifest, meta = {}) {
  const record = asObject(meta);
  const license = typeof record.license === "string"
    ? record.license
    : asObject(record.license).spdx_id;
  const files = Array.isArray(record.files)
    ? record.files.map((file) => String(file))
    : [];
  const lowerFiles = new Set(files.map((file) => file.toLowerCase()));
  const lifecycleScripts = Array.isArray(manifest?.lifecycleScripts)
    ? manifest.lifecycleScripts.filter((name) => typeof name === "string")
    : [];
  return {
    hasManifest: manifest?.state === "verified",
    hasLockfile: record.hasLockfile === true
      || [...lowerFiles].some((file) => LOCKFILES.has(file)),
    hasLicense: Boolean(license && license !== "NOASSERTION"),
    hasReadme: record.hasReadme === true
      || files.some((file) => /^readme(?:[^/]*)$/iu.test(file)),
    lifecycleScripts,
  };
}

/** 生成无 commit 锁定的安装命令；repo 必须通过 owner/name 格式校验，非法返回 null。 */
export function installCommandFor(repo) {
  if (typeof repo !== "string") return null;
  const normalized = repo.trim();
  if (!normalized || normalized.length > 240) return null;
  if (!GITHUB_REPO_PATTERN.test(normalized)) return null;
  return `dsh plugin --profile web add github:${normalized}`;
}

/**
 * 注册表清洗：字段白名单过滤 + repo 格式清洗（无任何 screening 判定）。
 * 旧 screening/screenedCommit/installCommand/attention 字段被白名单直接剔除。
 */
export function sanitizeRegistryInstallEvidence(registry) {
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.plugins)) return registry;
  return {
    ...registry,
    summary: pickFields(asObject(registry.summary), SUMMARY_FIELD_WHITELIST),
    plugins: registry.plugins.map((plugin) => {
      if (!plugin || typeof plugin !== "object") return plugin;
      const cleaned = pickFields(plugin, PLUGIN_FIELD_WHITELIST);
      if (typeof cleaned.repo === "string" && GITHUB_REPO_PATTERN.test(cleaned.repo.trim())) {
        cleaned.repo = cleaned.repo.trim();
      } else {
        cleaned.repo = null;
      }
      return cleaned;
    }),
  };
}

// 分类关键词规则（12 类，按匹配优先级排序：先特判后泛化，最终回退 tools）。
export const CATEGORY_RULES = {
  theme: /\btheme\b|appearance|color[- ]?scheme|stylesheet|dark mode|light mode|主题|配色|外观/iu,
  model: /\bmodel\b|provider|llm|openai|anthropic|gemini|claude|deepseek|模型|供应商|接入/iu,
  memory: /\bmemory\b|recall|remember|embedding|vector|knowledge|记忆|回想|知识/iu,
  session: /session|conversation|message|chat|checkpoint|rewind|export|import|history|会话|对话|消息|历史|导出|导入/iu,
  skill: /skill|capabilit|prompt|instruction|技能|提示词|能力/iu,
  workflow: /workflow|agent|subagent|orchestrat|schedule|cron|automation|monitor|pipeline|工作流|代理|自动化|定时|监控|流水线/iu,
  notify: /notify|notification|webhook|slack|telegram|feishu|lark|discord|wechat|推送|提醒|通知|飞书/iu,
  dev: /\bdev\b|developer|sandbox|runtime|debug|health|inspect|security|permission|开发|沙箱|调试|安全|权限/iu,
  market: /\bstore\b|market|marketplace|catalog|registry|installer|plugin[- ]?hub|市场|商店|目录|安装器|管理器/iu,
  fun: /game|pet|sticker|emoji|chess|music|quiz|游戏|宠物|贴纸|表情|音乐|趣味/iu,
  ui: /\bui\b|sidebar|panel|layout|canvas|visual|frontend|界面|侧栏|面板|布局/iu,
  tools: /tool|ocr|vision|file|database|browser|search|document|command|工具|视觉|文件|数据库|浏览器|搜索|文档|命令/iu,
};

export function categoryFromText(value) {
  const text = String(value || "");
  for (const category of Object.keys(CATEGORY_RULES)) {
    if (CATEGORY_RULES[category].test(text)) return category;
  }
  return "tools";
}
