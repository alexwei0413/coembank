import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedTarget,
  hasUnresolvedContent,
  parseArgs,
  validatePages,
} from "../scripts/page-factory.mjs";

function contentMap(value = "<p>已核准內容</p>") {
  return new Map([["page.html", value]]);
}

test("預設參數不允許寫入", () => {
  assert.deepEqual(parseArgs([]), { apply: false, publishApproved: false, validateOnly: false });
  assert.throws(() => parseArgs(["--apply", "--validate-only"]), /不可同時使用/u);
});

test("只允許 HTTPS 與核准網域", () => {
  assert.equal(assertAllowedTarget("https://www.comebank.com.tw/path"), "https://www.comebank.com.tw");
  assert.throws(() => assertAllowedTarget("http://comebank.com.tw"), /HTTPS/u);
  assert.throws(() => assertAllowedTarget("https://example.com"), /未獲核准/u);
});

test("拒絕重複 slug", () => {
  const pages = [
    { slug: "service", title: "A", file: "page.html", status: "draft" },
    { slug: "service", title: "B", file: "other.html", status: "draft" },
  ];
  assert.throws(() => validatePages(pages, new Map([["page.html", "A"], ["other.html", "B"]])), /slug 重複/u);
});

test("publish 必須另有核准且不得含待審內容", () => {
  const pages = [{ slug: "service", title: "服務", file: "page.html", status: "publish" }];
  assert.throws(() => validatePages(pages, contentMap()), /publish-approved/u);
  assert.throws(
    () => validatePages(pages, contentMap("<p>【待總監審】</p>"), { publishApproved: true }),
    /不得 publish/u,
  );
  assert.doesNotThrow(() => validatePages(pages, contentMap(), { publishApproved: true }));
});

test("可辨識佔位標記", () => {
  assert.equal(hasUnresolvedContent("【佔位:營業時間】"), true);
  assert.equal(hasUnresolvedContent("已完成內容"), false);
});
