/**
 * IndexNow 推送：把 public/indexnow-urls.txt 中的 URL 推给搜索引擎。
 *
 * - IndexNow 协议（Bing、Seznam、Naver、Yep 等）：无需站长验证，密钥文件公开即可。
 * - 首次推送若密钥文件尚未在 CDN 生效，引擎可能返回 403/404，按非致命处理（下次部署重试）。
 * - Baidu 主动推送：设置 BAIDU_PUSH_TOKEN 环境变量（CI secret）后自动启用。
 */
import { readFile } from "node:fs/promises";
import { INDEXNOW_KEY, SITE_HOST } from "./seo-artifacts.mjs";

const urls = (await readFile(new URL("../public/indexnow-urls.txt", import.meta.url), "utf8"))
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

if (!urls.length) {
  console.log("IndexNow: no URLs to push, skipping");
  process.exit(0);
}

const payload = {
  host: SITE_HOST,
  key: INDEXNOW_KEY,
  keyLocation: "https://" + SITE_HOST + "/" + INDEXNOW_KEY + ".txt",
  urlList: urls,
};

try {
  const response = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  console.log("IndexNow: " + response.status + " " + text.slice(0, 300));
  if (!response.ok) {
    console.warn("IndexNow 返回非 2xx（密钥文件可能尚未部署完成），非致命，下次部署自动重试");
  }
} catch (error) {
  console.warn("IndexNow push failed (non-fatal): " + (error?.message || error));
}

// Baidu 主动推送（可选）：需要在 GitHub secrets 配置 BAIDU_PUSH_TOKEN。
const baiduToken = process.env.BAIDU_PUSH_TOKEN?.trim();
if (baiduToken) {
  const site = (process.env.BAIDU_SITE || "https://" + SITE_HOST).trim();
  try {
    const target = "http://data.zz.baidu.com/urls?site=" + encodeURIComponent(site) +
      "&token=" + encodeURIComponent(baiduToken);
    const response = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: urls.join("\n"),
    });
    console.log("Baidu push: " + response.status + " " + (await response.text()).slice(0, 300));
  } catch (error) {
    console.warn("Baidu push failed (non-fatal): " + (error?.message || error));
  }
}
