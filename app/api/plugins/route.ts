import { previewSnapshot } from "@/lib/plugin-data";

// 注：生产与开发环境均由 Worker 的 fetch 处理器直接拦截 /api/plugins
// （D1 分页 + KV 回退），本路由仅作类型层面的兜底。
export async function GET() {
  return Response.json(previewSnapshot, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
