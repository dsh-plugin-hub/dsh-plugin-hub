import assert from "node:assert/strict";
import test from "node:test";
import {
  BUCKET_RESULT_CAP,
  EMPTY_BUCKET_STOP,
  incrementalCreatedStart,
  monthRangeFor,
  planBuckets,
  prevMonthRange,
  shouldStopOnEmptyStreak,
  splitRange,
} from "../worker/plugin-registry.ts";

// P1-T3 验收：分桶规划纯逻辑（无网络）——桶序列正确、触顶二分、空桶停止

test("monthRangeFor covers the full calendar month (incl. leap year)", () => {
  assert.deepEqual(monthRangeFor(new Date("2026-08-16T03:00:00Z")), { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(monthRangeFor(new Date("2026-12-01T00:00:00Z")), { start: "2026-12-01", end: "2026-12-31" });
  assert.deepEqual(monthRangeFor(new Date("2026-01-31T23:59:59Z")), { start: "2026-01-01", end: "2026-01-31" });
  assert.deepEqual(monthRangeFor(new Date("2024-02-10T00:00:00Z")), { start: "2024-02-01", end: "2024-02-29" });
});

test("prevMonthRange walks backwards across year boundaries", () => {
  assert.deepEqual(prevMonthRange({ start: "2026-08-01", end: "2026-08-31" }), { start: "2026-07-01", end: "2026-07-31" });
  assert.deepEqual(prevMonthRange({ start: "2026-01-01", end: "2026-01-31" }), { start: "2025-12-01", end: "2025-12-31" });
});

test("planBuckets produces newest-first month buckets down to oldestSeen", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  const buckets = planBuckets(now, "2025-11-03T10:00:00Z");
  assert.equal(buckets.length, 10); // 2025-11 .. 2026-08
  assert.deepEqual(buckets[0], { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(buckets[buckets.length - 1], { start: "2025-11-01", end: "2025-11-30" });
  for (let i = 1; i < buckets.length; i += 1) {
    assert.ok(buckets[i].start < buckets[i - 1].start, "months must be ordered newest → oldest");
  }
  // 桶首尾相接，无遗漏月份
  assert.deepEqual(prevMonthRange(buckets[0]), buckets[1]);
});

test("planBuckets falls back to the floor when no oldestSeen exists (first sweep)", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  const buckets = planBuckets(now, null);
  assert.equal(buckets.length, 80); // 2020-01 .. 2026-08
  assert.deepEqual(buckets[0], { start: "2026-08-01", end: "2026-08-31" });
  assert.deepEqual(buckets[buckets.length - 1], { start: "2020-01-01", end: "2020-01-31" });
});

test("planBuckets clamps oldestSeen earlier than the floor", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  const buckets = planBuckets(now, "2019-05-01T00:00:00Z");
  assert.equal(buckets[buckets.length - 1].start, "2020-01-01");
});

test("planBuckets handles a same-month oldestSeen (single bucket)", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  const buckets = planBuckets(now, "2026-08-01T00:00:00Z");
  assert.equal(buckets.length, 1);
  assert.deepEqual(buckets[0], { start: "2026-08-01", end: "2026-08-31" });
});

test("splitRange bisects a bucket at the day midpoint, covering the original range", () => {
  const [first, second] = splitRange({ start: "2026-08-01", end: "2026-08-31" });
  assert.equal(first.start, "2026-08-01");
  assert.equal(second.end, "2026-08-31");
  assert.equal(first.end, second.start);
  assert.ok(first.start <= first.end && second.start <= second.end);
  // 半月区间可继续二分
  const [f2, s2] = splitRange(first);
  assert.equal(f2.start, first.start);
  assert.equal(s2.end, first.end);
  assert.equal(f2.end, s2.start);
});

test("splitRange returns a no-op for a single-day bucket (cap cannot be split further)", () => {
  const range = { start: "2026-08-16", end: "2026-08-16" };
  assert.deepEqual(splitRange(range), [range, range]);
});

test("shouldStopOnEmptyStreak stops the first sweep after 3 consecutive empty months", () => {
  assert.equal(shouldStopOnEmptyStreak(0, true), false);
  assert.equal(shouldStopOnEmptyStreak(2, true), false);
  assert.equal(shouldStopOnEmptyStreak(EMPTY_BUCKET_STOP, true), true);
  assert.equal(shouldStopOnEmptyStreak(10, true), true);
  // 周扫（月份队列受 oldestSeen 约束）不应被空桶提前停止
  assert.equal(shouldStopOnEmptyStreak(10, false), false);
  // 自定义阈值
  assert.equal(shouldStopOnEmptyStreak(2, true, 2), true);
});

test("incrementalCreatedStart stays inside the current month", () => {
  const now = new Date("2026-08-16T00:00:00Z");
  const start = incrementalCreatedStart(now);
  assert.ok(start >= "2026-08-01", "window must not start before the current month");
  assert.ok(start <= now.toISOString(), "window must not start in the future");
  // 月初时回退到当月 1 号
  const early = new Date("2026-08-01T02:00:00Z");
  assert.equal(incrementalCreatedStart(early), "2026-08-01");
});

test("bucket constants match the GitHub Search hard cap", () => {
  assert.equal(BUCKET_RESULT_CAP, 1000);
  assert.equal(EMPTY_BUCKET_STOP, 3);
});
