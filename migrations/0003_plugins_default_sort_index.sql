-- 0003: 默认排序复合索引。/api/plugins 无筛选查询的
-- WHERE removed = 0 ORDER BY curated DESC, stars DESC, name COLLATE NOCASE ASC
-- 原先每次冷请求全表扫描 + 排序（1.4 万行读）；建索引后 LIMIT 分页只读命中的几十行。
-- 读额度（免费版 500 万行/天）保护：N 增长时读成本从 O(每次请求×N) 降到 O(命中行数)。
CREATE INDEX IF NOT EXISTS idx_plugins_removed_curated
  ON plugins(removed, curated DESC, stars DESC, name COLLATE NOCASE);
