# 頁面工廠(B 線)

三個固定 slug 的頁面草稿，透過 WP REST API 建立或更新，**不動任何主題檔案**。

| slug | 標題 | 內容 |
|---|---|---|
| `/service/` | 服務與預算 | 服務項目(住宅/商空/禪意佛院/舊翻新)、合作流程五步、進度對應付款原則(無具體價格) |
| `/contact/` | 聯絡我們 | LINE @comebank、04-2386-1491、台中市南屯區環中路四段120-7號、營業時間佔位 |
| `/about/` | 關於我們 | 總監魏啓倫介紹骨架(2001 創立、六項國際獎)、工作照/團隊照圖片佔位 |

所有文案為草稿版,頁首均標記 **【待總監審】**;待補資訊以【佔位:…】標出。

## 安全操作方式

預設只做本機驗證，不連線也不寫入 WordPress：

```bash
node scripts/page-factory.mjs --validate-only
```

核對驗證結果後，才以明確的 `--apply` 建立／更新草稿：

```bash
WP_BASE_URL=https://www.comebank.com.tw \
WP_USER=<WP帳號> \
WP_APP_PASSWORD=<應用程式密碼> \
node scripts/page-factory.mjs --apply
```

腳本會先確認核准網域、查出既有頁面並建立本機備份／執行紀錄，再逐頁寫入及回讀驗證。若任一頁失敗，會停止後續頁面並在紀錄中標示部分完成狀態。

只有在文案已核准、`pages.json` 明確改為 `publish`，而且內容已清除所有 `【待總監審】` 與 `【佔位:…】` 後，才可另加 `--publish-approved`。目前三頁皆固定為 `draft`。

> 注意:目前 Claude Code 遠端環境的網路 allowlist 未開放 WP 主機,
> 且環境內沒有 WP 憑證，因此尚未實際寫入。憑證只應透過執行環境變數提供，不得提交到 repository。
