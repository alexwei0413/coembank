#!/usr/bin/env node
/**
 * 頁面工廠:透過 WordPress REST API 建立/更新 page。
 * 只碰 /wp-json/wp/v2/pages,不碰任何主題檔案。
 *
 * 用法:
 *   WP_BASE_URL=https://www.comebank.com.tw \
 *   WP_USER=<帳號> WP_APP_PASSWORD=<應用程式密碼> \
 *   node scripts/page-factory.mjs
 *
 * 冪等:slug 已存在則更新內容,不存在則建立。slug 固定,不會產生 -2 重複頁。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { WP_BASE_URL, WP_USER, WP_APP_PASSWORD } = process.env;
if (!WP_BASE_URL || !WP_USER || !WP_APP_PASSWORD) {
  console.error("缺少環境變數:WP_BASE_URL / WP_USER / WP_APP_PASSWORD");
  process.exit(1);
}

const API = `${WP_BASE_URL.replace(/\/$/, "")}/wp-json/wp/v2/pages`;
const AUTH = "Basic " + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString("base64");
const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "pages");

async function wp(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: AUTH, "Content-Type": "application/json", ...options.headers },
  });
  if (!res.ok) throw new Error(`${options.method ?? "GET"} ${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const pages = JSON.parse(await readFile(path.join(DIR, "pages.json"), "utf8"));

for (const page of pages) {
  const content = await readFile(path.join(DIR, page.file), "utf8");
  const existing = await wp(`${API}?slug=${page.slug}&status=publish,future,draft,pending,private&context=edit`);
  const body = JSON.stringify({ title: page.title, slug: page.slug, content, status: page.status });

  if (existing.length > 0) {
    const updated = await wp(`${API}/${existing[0].id}`, { method: "POST", body });
    console.log(`更新 /${page.slug}/ (id=${updated.id}) -> ${updated.link}`);
  } else {
    const created = await wp(API, { method: "POST", body });
    console.log(`建立 /${page.slug}/ (id=${created.id}) -> ${created.link}`);
  }
}
