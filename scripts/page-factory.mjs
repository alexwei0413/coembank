#!/usr/bin/env node
/**
 * 以 WordPress REST API 建立或更新固定 slug 頁面。
 *
 * 預設只做本機驗證；必須加上 --apply 才會寫入 WordPress。
 * publish 狀態另需 --publish-approved，且內容不得含待審或佔位標記。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = path.join(SCRIPT_DIR, "..", "content", "pages");
const DEFAULT_ALLOWED_HOSTS = ["comebank.com.tw", "www.comebank.com.tw"];
const UNRESOLVED_MARKERS = [/【待總監審】/u, /【佔位[:：]/u];

export function parseArgs(argv) {
  const options = { apply: false, publishApproved: false, validateOnly: false };
  for (const arg of argv) {
    if (arg === "--apply") options.apply = true;
    else if (arg === "--publish-approved") options.publishApproved = true;
    else if (arg === "--validate-only") options.validateOnly = true;
    else throw new Error(`未知參數：${arg}`);
  }
  if (options.validateOnly && options.apply) {
    throw new Error("--validate-only 與 --apply 不可同時使用");
  }
  return options;
}

export function assertAllowedTarget(baseUrl, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  let target;
  try {
    target = new URL(baseUrl);
  } catch {
    throw new Error("WP_BASE_URL 不是有效網址");
  }
  if (target.protocol !== "https:") throw new Error("WP_BASE_URL 必須使用 HTTPS");
  if (!allowedHosts.includes(target.hostname.toLowerCase())) {
    throw new Error(`WP_BASE_URL 網域未獲核准：${target.hostname}`);
  }
  return target.origin;
}

export function hasUnresolvedContent(content) {
  return UNRESOLVED_MARKERS.some((pattern) => pattern.test(content));
}

export function validatePages(pages, contentByFile, { publishApproved = false } = {}) {
  if (!Array.isArray(pages) || pages.length === 0) throw new Error("pages.json 必須是非空陣列");
  const seenSlugs = new Set();
  const seenFiles = new Set();

  for (const page of pages) {
    if (!page || typeof page !== "object") throw new Error("頁面設定格式錯誤");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(page.slug ?? "")) {
      throw new Error(`slug 格式錯誤：${page.slug ?? "(missing)"}`);
    }
    if (seenSlugs.has(page.slug)) throw new Error(`slug 重複：${page.slug}`);
    if (seenFiles.has(page.file)) throw new Error(`內容檔案重複：${page.file}`);
    seenSlugs.add(page.slug);
    seenFiles.add(page.file);

    if (!page.title || !page.file) throw new Error(`頁面 ${page.slug} 缺少 title 或 file`);
    if (!["draft", "publish"].includes(page.status)) {
      throw new Error(`頁面 ${page.slug} 的 status 只接受 draft 或 publish`);
    }
    const content = contentByFile.get(page.file);
    if (typeof content !== "string") throw new Error(`找不到內容檔案：${page.file}`);
    if (page.status === "publish" && !publishApproved) {
      throw new Error(`頁面 ${page.slug} 要求 publish，但未提供 --publish-approved`);
    }
    if (page.status === "publish" && hasUnresolvedContent(content)) {
      throw new Error(`頁面 ${page.slug} 仍有待審／佔位內容，不得 publish`);
    }
  }
  return pages;
}

function rawValue(field) {
  return field?.raw ?? field?.rendered ?? "";
}

function snapshot(page) {
  if (!page) return null;
  return {
    id: page.id,
    slug: page.slug,
    status: page.status,
    modified_gmt: page.modified_gmt,
    title: rawValue(page.title),
    content: rawValue(page.content),
    link: page.link,
  };
}

async function writeManifest(file, manifest) {
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function loadPageDefinitions(contentDir = CONTENT_DIR) {
  const pages = JSON.parse(await readFile(path.join(contentDir, "pages.json"), "utf8"));
  const contentByFile = new Map();
  for (const page of pages) {
    if (page?.file && !contentByFile.has(page.file)) {
      contentByFile.set(page.file, await readFile(path.join(contentDir, page.file), "utf8"));
    }
  }
  return { pages, contentByFile };
}

function createWpClient({ baseUrl, user, password, timeoutMs = 15_000 }) {
  const auth = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

  return async function wp(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: auth,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`${options.method ?? "GET"} ${url} -> ${response.status}: ${detail}`);
    }
    return response.json();
  };
}

async function buildPlan({ pages, contentByFile, wp, api }) {
  const plan = [];
  for (const page of pages) {
    const query = new URLSearchParams({
      slug: page.slug,
      status: "publish,future,draft,pending,private",
      context: "edit",
    });
    const existing = await wp(`${api}?${query}`);
    if (!Array.isArray(existing)) throw new Error(`頁面 ${page.slug} 的查詢結果格式錯誤`);
    if (existing.length > 1) throw new Error(`頁面 ${page.slug} 找到 ${existing.length} 筆，拒絕任選一筆覆寫`);
    plan.push({ page, content: contentByFile.get(page.file), existing: existing[0] ?? null });
  }
  return plan;
}

function verifyReadback(expected, actual) {
  const failures = [];
  if (actual.slug !== expected.slug) failures.push(`slug=${actual.slug}`);
  if (actual.status !== expected.status) failures.push(`status=${actual.status}`);
  if (rawValue(actual.title) !== expected.title) failures.push("title 不一致");
  if (rawValue(actual.content) !== expected.content) failures.push("content 不一致");
  if (failures.length > 0) throw new Error(`readback 驗證失敗：${failures.join("、")}`);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = parseArgs(argv);
  const { pages, contentByFile } = await loadPageDefinitions();
  validatePages(pages, contentByFile, options);

  if (!options.apply) {
    console.log(`VALIDATION_OK：${pages.length} 個頁面；未連線、未寫入 WordPress。`);
    return;
  }

  const { WP_BASE_URL, WP_USER, WP_APP_PASSWORD } = env;
  if (!WP_BASE_URL || !WP_USER || !WP_APP_PASSWORD) {
    throw new Error("--apply 缺少 WP_BASE_URL / WP_USER / WP_APP_PASSWORD");
  }
  const baseUrl = assertAllowedTarget(WP_BASE_URL);
  const api = `${baseUrl}/wp-json/wp/v2/pages`;
  const wp = createWpClient({ baseUrl, user: WP_USER, password: WP_APP_PASSWORD });
  const plan = await buildPlan({ pages, contentByFile, wp, api });

  const backupDir = path.resolve(env.PAGE_FACTORY_BACKUP_DIR ?? ".page-factory-backups");
  await mkdir(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const manifestFile = path.join(backupDir, `page-factory-${stamp}.json`);
  const manifest = {
    target: baseUrl,
    started_at: new Date().toISOString(),
    publish_approved: options.publishApproved,
    prior_state: plan.map(({ page, existing }) => ({ slug: page.slug, snapshot: snapshot(existing) })),
    results: [],
  };
  await writeManifest(manifestFile, manifest);
  console.log(`備份／執行紀錄：${manifestFile}`);

  for (const { page, content, existing } of plan) {
    const expected = { title: page.title, slug: page.slug, content, status: page.status };
    const body = JSON.stringify(expected);
    try {
      if (existing) {
        const latest = await wp(`${api}/${existing.id}?context=edit`);
        if (latest.modified_gmt !== existing.modified_gmt) {
          throw new Error("頁面在備份後已被其他人修改，拒絕覆寫");
        }
      }
      const result = existing
        ? await wp(`${api}/${existing.id}`, { method: "POST", body })
        : await wp(api, { method: "POST", body });
      const readback = await wp(`${api}/${result.id}?context=edit`);
      verifyReadback(expected, readback);
      manifest.results.push({ slug: page.slug, action: existing ? "updated" : "created", id: result.id, verified: true });
      await writeManifest(manifestFile, manifest);
      console.log(`${existing ? "更新" : "建立"} /${page.slug}/ (id=${result.id})；readback=PASS`);
    } catch (error) {
      manifest.results.push({ slug: page.slug, verified: false, error: error.message });
      manifest.failed_at = new Date().toISOString();
      await writeManifest(manifestFile, manifest);
      throw new Error(`頁面 ${page.slug} 寫入失敗；已停止後續頁面。${error.message}`);
    }
  }
  manifest.completed_at = new Date().toISOString();
  await writeManifest(manifestFile, manifest);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`ERROR：${error.message}`);
    process.exitCode = 1;
  });
}
