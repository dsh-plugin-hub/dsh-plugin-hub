-- P1-T5：D1 插件表（方案文档 4.2 / PLAN 6.2）
-- id = owner/repo 小写；facts 事实字段拍平为布尔列；lifecycle_scripts 存 JSON 数组文本。
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,            -- owner/repo 小写
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  category TEXT NOT NULL,
  description_en TEXT,
  description_zh TEXT,
  stars INTEGER,
  forks INTEGER,
  open_issues INTEGER,
  pushed_at TEXT,
  created_at TEXT,
  license TEXT,
  language TEXT,
  homepage TEXT,
  archived INTEGER DEFAULT 0,
  curated INTEGER DEFAULT 0,
  has_manifest INTEGER DEFAULT 0,
  has_lockfile INTEGER DEFAULT 0,
  has_license INTEGER DEFAULT 0,
  has_readme INTEGER DEFAULT 0,
  lifecycle_scripts TEXT,         -- JSON 数组（facts.lifecycleScripts）
  removed INTEGER DEFAULT 0,      -- 退出 topic / 被删除
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_plugins_category ON plugins(category);
CREATE INDEX IF NOT EXISTS idx_plugins_stars ON plugins(stars DESC);

-- 惰性同步元数据：记录最后一次写入 D1 的 registry.generatedAt（P1-T5 比对用）
CREATE TABLE IF NOT EXISTS registry_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
