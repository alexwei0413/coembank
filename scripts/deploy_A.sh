#!/usr/bin/env bash
###############################################################################
# deploy_A.sh —  A 線 / 內容工廠  (康貝客 comebank.com.tw)
#
# 一鍵部署：  ① 作品集「樂．悠揚」(cb_portfolio)
#            ② 三篇設計日誌    (cb_journal)
#
# 設計原則（依總監指示）：
#   * 只透過 WP-CLI 操作（= REST / 資料庫層），**不碰任何主題檔案**。
#   * 圖片用 `wp media import` 直接上傳媒體庫，再以附件 ID 綁定。
#   * 全部直接 publish。
#
# 執行環境：請在「能連到 comebank.com.tw 的那台 WordPress 主機」上執行，
#           因為圖片與日誌原文都掛在同一個站台。
#
# 用法：
#   bash deploy_A.sh            # 正式執行
#   DRY_RUN=1 bash deploy_A.sh  # 只印出將要做的事，不實際寫入
###############################################################################
set -uo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# 0. 連線設定 —  ▶▶ 執行前請確認這一段 ◀◀
# ─────────────────────────────────────────────────────────────────────────────
# WP 站台根目錄（wp-cli 需在此找到 wp-load.php）。若用 ssh alias 或 docker，
# 把 WP 改成對應呼叫即可，例如：
#   WP=(wp --ssh=user@host/var/www/comebank)
#   WP=(wp @prod)
WP_PATH="${WP_PATH:-/var/www/comebank}"
WP=(wp --path="${WP_PATH}" --skip-themes --skip-plugins=0)

# 圖片來源（樂悠揚 live11 系列）
IMG_BASE="${IMG_BASE:-https://comebank.com.tw/wp-content/uploads/2024/02}"

# 自訂型別 / 分類法名稱（依主題註冊；如不同請改這裡）
CPT_PORTFOLIO="cb_portfolio"
CPT_JOURNAL="cb_journal"
TAX_SPACE="cb_space"          # 作品空間別分類法
TAX_JOURNAL_CAT="category"    # 日誌分類；若主題另註冊請改成 cb_journal_cat 等

DRY_RUN="${DRY_RUN:-0}"

# ─────────────────────────────────────────────────────────────────────────────
# 小工具
# ─────────────────────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*" >&2; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

run() {  # 包一層方便 DRY_RUN 觀察
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] %s\n' "$*" >&2
    return 0
  fi
  "$@"
}

# 確保某分類法的詞彙存在，回傳 term_id（以名稱比對）
ensure_term() {  # $1=taxonomy  $2=term-name
  local tax="$1" name="$2" tid
  tid="$("${WP[@]}" term list "$tax" --name="$name" --field=term_id 2>/dev/null | head -n1)"
  if [[ -z "$tid" ]]; then
    log "建立分類詞彙：${tax} / ${name}"
    tid="$(run "${WP[@]}" term create "$tax" "$name" --porcelain 2>/dev/null)"
  fi
  printf '%s' "$tid"
}

# ─────────────────────────────────────────────────────────────────────────────
# 前置檢查
# ─────────────────────────────────────────────────────────────────────────────
command -v wp >/dev/null 2>&1 || die "找不到 wp-cli，請先安裝或調整 WP=() 呼叫方式。"
"${WP[@]}" core is-installed 2>/dev/null || die "WP-CLI 連不到站台（WP_PATH=${WP_PATH}）。"

for cpt in "$CPT_PORTFOLIO" "$CPT_JOURNAL"; do
  "${WP[@]}" post-type get "$cpt" >/dev/null 2>&1 \
    || warn "找不到自訂型別 ${cpt}（主題可能尚未註冊）— 仍會嘗試建立。"
done

ok "前置檢查完成，站台：$("${WP[@]}" option get siteurl 2>/dev/null)"

###############################################################################
# ①  作品集：樂．悠揚
###############################################################################
log "===== ① 作品集 樂．悠揚 ====="

PORTFOLIO_TITLE="樂．悠揚"
SPACE_TERM="住宅"
META_LOCATION="台中"
META_PING="80"          # 80 坪（存純數字；若主題欄位含單位請改成「80坪」）
META_SIGNATURE="1"      # cb_signature = 代表作旗標
COVER_INDEX=5           # 封面 = live11-5

# 避免重複建立
EXIST_ID="$("${WP[@]}" post list --post_type="$CPT_PORTFOLIO" \
            --title="$PORTFOLIO_TITLE" --field=ID 2>/dev/null | head -n1)"
if [[ -n "$EXIST_ID" ]]; then
  warn "作品「${PORTFOLIO_TITLE}」已存在 (ID=${EXIST_ID})，略過建立。如需重建請先刪除。"
else
  # --- 1) 匯入 13 張圖到媒體庫，依序收集附件 ID -----------------------------
  declare -A GALLERY_IDS=()
  for n in $(seq 1 13); do
    url="${IMG_BASE}/live11-${n}.jpg"
    log "匯入圖片 ${n}/13：${url}"
    if [[ "$DRY_RUN" == "1" ]]; then
      GALLERY_IDS[$n]="DRY${n}"
    else
      id="$("${WP[@]}" media import "$url" --porcelain 2>/dev/null)"
      [[ -n "$id" ]] || die "live11-${n}.jpg 匯入失敗，請確認來源 URL 可連線。"
      GALLERY_IDS[$n]="$id"
    fi
  done

  COVER_ID="${GALLERY_IDS[$COVER_INDEX]}"
  # 依 1..13 順序組出 gallery 的逗號字串
  gallery_csv=""
  for n in $(seq 1 13); do gallery_csv+="${GALLERY_IDS[$n]},"; done
  gallery_csv="${gallery_csv%,}"
  ok "圖片匯入完成；封面 live11-${COVER_INDEX} → 附件 ID=${COVER_ID}"
  ok "gallery IDs：${gallery_csv}"

  # --- 2) 建立作品（直接 publish）-------------------------------------------
  log "建立 ${CPT_PORTFOLIO}：${PORTFOLIO_TITLE}"
  PID="$(run "${WP[@]}" post create \
           --post_type="$CPT_PORTFOLIO" \
           --post_title="$PORTFOLIO_TITLE" \
           --post_status=publish \
           --porcelain)"
  [[ "$DRY_RUN" == "1" ]] && PID="DRYPID"
  [[ -n "$PID" ]] || die "建立作品失敗。"
  ok "作品建立完成，ID=${PID}"

  # --- 3) 空間別分類：住宅 ---------------------------------------------------
  ensure_term "$TAX_SPACE" "$SPACE_TERM" >/dev/null
  run "${WP[@]}" post term set "$PID" "$TAX_SPACE" "$SPACE_TERM" --by=name

  # --- 4) Meta 指令 ----------------------------------------------------------
  run "${WP[@]}" post meta update "$PID" cb_location  "$META_LOCATION"
  run "${WP[@]}" post meta update "$PID" cb_ping      "$META_PING"
  run "${WP[@]}" post meta update "$PID" cb_signature "$META_SIGNATURE"
  run "${WP[@]}" post meta update "$PID" cb_gallery   "$gallery_csv"
  # 封面（精選圖片）= live11-5
  run "${WP[@]}" post meta update "$PID" _thumbnail_id "$COVER_ID"

  ok "作品「${PORTFOLIO_TITLE}」部署完成 → $("${WP[@]}" post list --post__in="$PID" --field=guid 2>/dev/null)"
fi

###############################################################################
# ②  三篇設計日誌
###############################################################################
log "===== ② 設計日誌（cb_journal）====="

# ── 來源網址：▶▶ 請總監確認 / 貼上官網實際文章網址 ◀◀ ───────────────────────
#  我的執行環境被防火牆擋住 comebank.com.tw，無法替你「點進去」確認確切 slug，
#  故此處留成變數。下面三個值請對照官網設計日誌列表填入正確網址即可，
#  其餘抓全文＋圖、建立、分類、publish 全部自動完成。
#
#  分類對應（依總監指示）：
#     孝親房      → 裝修知識
#     設計師怎麼選 → 裝修知識
#     新屋流程     → 流程攻略
URL_XIAOQIN="${URL_XIAOQIN:-https://comebank.com.tw/REPLACE-孝親房文章網址/}"
URL_DESIGNER="${URL_DESIGNER:-https://comebank.com.tw/REPLACE-設計師怎麼選文章網址/}"
URL_PROCESS="${URL_PROCESS:-https://comebank.com.tw/REPLACE-新屋流程文章網址/}"

# 對應表：URL|分類
JOURNALS=(
  "${URL_XIAOQIN}|裝修知識"
  "${URL_DESIGNER}|裝修知識"
  "${URL_PROCESS}|流程攻略"
)

# 預先確保兩個分類存在
ensure_term "$TAX_JOURNAL_CAT" "裝修知識" >/dev/null
ensure_term "$TAX_JOURNAL_CAT" "流程攻略" >/dev/null

# ── PHP 抓全文 importer（透過 wp eval-file，純 REST/DB，不動主題）──────────────
PHP_IMPORTER="$(mktemp /tmp/cb_journal_import.XXXXXX.php)"
cat > "$PHP_IMPORTER" <<'PHP'
<?php
/**
 * 用法：wp eval-file importer.php <src_url> <category> <post_type> <taxonomy> <status>
 * 抓官網單篇文章：標題 + 內文 HTML + 內嵌圖片（sideload 進媒體庫並改寫 src），
 * 建立日誌、指定分類、設定精選圖、發佈。
 */
list($src, $category, $post_type, $taxonomy, $status) = array_pad($args, 5, '');
if (!$src) { WP_CLI::error('缺少來源網址'); }

require_once ABSPATH . 'wp-admin/includes/media.php';
require_once ABSPATH . 'wp-admin/includes/file.php';
require_once ABSPATH . 'wp-admin/includes/image.php';

$resp = wp_remote_get($src, [
  'timeout'    => 45,
  'user-agent' => 'Mozilla/5.0 (compatible; comebank-content-factory/1.0)',
]);
if (is_wp_error($resp)) { WP_CLI::error('抓取失敗：' . $resp->get_error_message()); }
$html = wp_remote_retrieve_body($resp);
if (!$html) { WP_CLI::error('來源無內容：' . $src); }

$doc = new DOMDocument();
libxml_use_internal_errors(true);
// 強制 UTF-8
$doc->loadHTML('<?xml encoding="UTF-8">' . $html);
libxml_clear_errors();
$xp = new DOMXPath($doc);

/* 標題：優先 h1.entry-title → og:title → <title> */
$title = '';
foreach ([
  '//h1[contains(@class,"entry-title")]',
  '//meta[@property="og:title"]/@content',
  '//h1',
  '//title',
] as $q) {
  $node = $xp->query($q)->item(0);
  if ($node) { $title = trim($node->textContent ?: $node->nodeValue); if ($title) break; }
}
if (!$title) { $title = '（未命名日誌）'; }

/* 內文節點：entry-content → article → main */
$content_node = null;
foreach ([
  '//div[contains(@class,"entry-content")]',
  '//article',
  '//main',
] as $q) {
  $n = $xp->query($q)->item(0);
  if ($n) { $content_node = $n; break; }
}
if (!$content_node) { WP_CLI::error('找不到內文區塊：' . $src); }

/* 先建立空文章拿到 ID（圖片要掛在此文章下）*/
$post_id = wp_insert_post([
  'post_type'   => $post_type,
  'post_title'  => $title,
  'post_status' => $status,
  'post_content'=> '',
], true);
if (is_wp_error($post_id)) { WP_CLI::error('建立文章失敗：' . $post_id->get_error_message()); }

/* sideload 內嵌圖片並改寫 src */
$first_img_id = 0;
foreach (iterator_to_array($content_node->getElementsByTagName('img')) as $img) {
  $url = $img->getAttribute('src');
  if (!$url) { $url = $img->getAttribute('data-src'); }
  if (!$url) { continue; }
  if (strpos($url, '//') === 0)   { $url = 'https:' . $url; }
  if (strpos($url, 'http') !== 0) { $url = home_url('/') . ltrim($url, '/'); }

  $local = media_sideload_image($url, $post_id, $title, 'src');
  if (is_wp_error($local)) { WP_CLI::warning('圖片略過：' . $url . ' — ' . $local->get_error_message()); continue; }
  $img->setAttribute('src', $local);
  $img->removeAttribute('srcset');
  $img->removeAttribute('data-src');

  if (!$first_img_id) {
    $aid = attachment_url_to_postid($local);
    if ($aid) { $first_img_id = $aid; }
  }
}

/* 取出 content_node 的 innerHTML */
$content = '';
foreach ($content_node->childNodes as $child) {
  $content .= $doc->saveHTML($child);
}

/* 寫回內文 */
wp_update_post(['ID' => $post_id, 'post_content' => $content]);

/* 分類：確保存在並指定 */
if ($category) {
  $term = term_exists($category, $taxonomy);
  if (!$term) { $term = wp_insert_term($category, $taxonomy); }
  if (!is_wp_error($term)) {
    wp_set_object_terms($post_id, $category, $taxonomy, false);
  }
}

/* 精選圖 = 第一張內嵌圖 */
if ($first_img_id) { set_post_thumbnail($post_id, $first_img_id); }

WP_CLI::success(sprintf('日誌建立 #%d「%s」分類=%s → %s',
  $post_id, $title, $category, get_permalink($post_id)));
PHP

# ── 逐篇處理 ──────────────────────────────────────────────────────────────
for entry in "${JOURNALS[@]}"; do
  src="${entry%%|*}"
  cat_name="${entry##*|}"

  if [[ "$src" == *REPLACE-* ]]; then
    warn "略過未填網址的日誌（分類=${cat_name}）：請在腳本頂端填入 URL_* 後再跑。"
    continue
  fi

  # 以來源網址查重，避免重複建立（用 meta 記錄來源）
  dup="$("${WP[@]}" post list --post_type="$CPT_JOURNAL" \
         --meta_key=_cb_source_url --meta_value="$src" --field=ID 2>/dev/null | head -n1)"
  if [[ -n "$dup" ]]; then
    warn "此來源已建立過日誌 (ID=${dup})，略過：${src}"
    continue
  fi

  log "抓取並建立日誌（分類=${cat_name}）：${src}"
  if [[ "$DRY_RUN" == "1" ]]; then
    printf '   [dry-run] wp eval-file importer %s %s %s %s publish\n' \
      "$src" "$cat_name" "$CPT_JOURNAL" "$TAX_JOURNAL_CAT" >&2
    continue
  fi

  out="$("${WP[@]}" eval-file "$PHP_IMPORTER" \
          "$src" "$cat_name" "$CPT_JOURNAL" "$TAX_JOURNAL_CAT" "publish" 2>&1)"
  echo "   $out" >&2

  # 記錄來源 URL（供查重）
  new_id="$(grep -oE '#[0-9]+' <<<"$out" | head -n1 | tr -d '#')"
  if [[ -n "$new_id" ]]; then
    "${WP[@]}" post meta update "$new_id" _cb_source_url "$src" >/dev/null 2>&1
    ok "日誌 #${new_id} 部署完成。"
  fi
done

rm -f "$PHP_IMPORTER"

ok "===== A 線部署結束 ====="
