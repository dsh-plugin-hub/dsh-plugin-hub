/** 增长序列纯函数：服务端（page.tsx 预计算）与客户端（plugin-hub 兜底）共用。 */

export type GrowthPoint = {
  date: string;
  added: number;
  total: number;
};

/** 从 ISO 时间串提取 YYYY-MM-DD，非法输入返回 null。 */
export function isoDate(value: string | null | undefined) {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/u);
  if (!match) return null;
  return Number.isFinite(Date.parse(`${match[1]}T00:00:00Z`)) ? match[1] : null;
}

export function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 按插件首次收录日期聚合为逐日累计序列（升序，含末尾补点到 generatedAt）。 */
export function buildGrowthSeries(plugins: Array<{
  discovery?: { firstSeenAt?: string | null };
  added?: string | null;
}>, generatedAt: string): GrowthPoint[] {
  const generatedDate = isoDate(generatedAt) || "1970-01-01";
  const dailyAdditions = new Map<string, number>();

  for (const plugin of plugins) {
    const date = isoDate(plugin.discovery?.firstSeenAt ?? null) || isoDate(plugin.added ?? null) || generatedDate;
    dailyAdditions.set(date, (dailyAdditions.get(date) || 0) + 1);
  }

  const dates = [...dailyAdditions.keys()].sort();
  if (!dates.length) return [{ date: generatedDate, added: 0, total: 0 }];

  let total = 0;
  const series = dates.map((date) => {
    const added = dailyAdditions.get(date) || 0;
    total += added;
    return { date, added, total };
  });
  const lastDate = series.at(-1)?.date || generatedDate;
  const chartEnd = generatedDate > lastDate ? generatedDate : lastDate;

  if (chartEnd > lastDate) series.push({ date: chartEnd, added: 0, total });
  if (series.length === 1) {
    series.unshift({ date: shiftIsoDate(series[0].date, -1), added: 0, total: 0 });
  }
  return series;
}
