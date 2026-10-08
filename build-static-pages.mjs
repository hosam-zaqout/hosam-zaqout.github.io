#!/usr/bin/env node
/**
 * ============================================================
 *  3ENG.s — مولّد الصفحات الثابتة (Static Pages Generator)
 * ============================================================
 *  بيقرأ الدورات والمشاريع والمنتجات والكتب من Firestore
 *  وبيولّد لكل عنصر صفحة HTML ثابتة فيها:
 *    - Title / Description / Canonical / Open Graph
 *    - Schema: Course أو Product + BreadcrumbList
 *  وبيولّد كمان:
 *    - صفحة فهرس لكل قسم  (/courses/ , /projects/ ...)
 *    - sitemap.xml  كامل
 *    - llms.txt     (للظهور في ChatGPT / Perplexity / Gemini)
 *    - صور WebP مضغوطة لكل عنصر في /img/  (يحتاج مكتبة sharp — اختيارية)
 *    - صفحات تصنيف حسب التقنية/المجال في /topics/
 *    - الأقسام المخصصة من لوحة التحكم في /sections/{slug}/ (منتجات أو مقالات)
 *    - صفحات الفريق /team/{slug}/ (Person) وربط كل دورة/كتاب بمدرّبه أو مؤلفه
 *    - محتوى ثابت داخل index.html (روابط العناصر + الأرقام + الآراء)
 *      بين علامات <!--SSR:xxx--> … <!--/SSR:xxx--> — عشان جوجل والـ AI يشوفوه بدون JavaScript
 *    - (اختياري) إرسال الروابط الجديدة لـ Bing عبر IndexNow
 *
 *  التشغيل:   node tools/build-static-pages.mjs
 *  المتطلبات: Node.js 18 أو أحدث (بدون أي مكتبات)
 *
 *  متغيرات اختيارية:
 *    OUT_DIR        مجلد الإخراج (الافتراضي: جذر المستودع)
 *    INDEXNOW_KEY   مفتاح IndexNow (حروف وأرقام، 8-128 حرف)
 *    MOCK_FILE      ملف JSON للتجربة بدل Firestore
 * ============================================================
 */

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
// محوّل نصوص المقالات — نفس الملف اللي تستخدمه لوحة التحكم وصفحة 404
await import(new URL("./assets/md.js", import.meta.url));
import { TOOLS, TOOL_CATS } from "./tools-data.mjs";
const md = globalThis.md3;

// ---------------- الإعدادات ----------------
const SITE = "https://www.3engs.com";
const PROJECT_ID = "engs-website";
const API_KEY = process.env.FIREBASE_API_KEY || "AIzaSyALJiF8l_wnk_6FU6etQpz44Z43lSORXQk"; // مفتاح الويب العام (نفس اللي بالموقع)
const OUT_DIR = path.resolve(process.env.OUT_DIR || ".");
const CURRENCY = "USD";
const WHATSAPP = "972592753159";
const BRAND = "3ENG.s";
const BRAND_AR = "المهندسون الثلاثة";

// صفحات ثابتة موجودة أصلاً بالموقع وبدك تكون بالـ sitemap
const EXTRA_URLS = [
  { loc: "/privacy.html", priority: 0.3 },
];
const OG_DEFAULT = `${SITE}/og-image.jpg`;

// الأقسام: اسم الـ collection بـ Firestore ← إعدادات الصفحة
const SECTIONS = [
  { col: "courses",  dir: "courses",  label: "الدورات",          one: "دورة",        type: "Course",  emoji: "🎓", anchor: "#courses"  },
  { col: "projects", dir: "projects", label: "المشاريع الجاهزة", one: "مشروع",       type: "Product", emoji: "🛠️", anchor: "#projects" },
  { col: "products", dir: "products", label: "المنتجات الرقمية", one: "منتج رقمي",   type: "Product", emoji: "📦", anchor: "#products" },
  { col: "books",    dir: "books",    label: "الكتب الهندسية",   one: "كتاب",        type: "Product", emoji: "📚", anchor: "#books"    },
];

// ⚠️ حقول ممنوع تطلع بالصفحات أبداً (روابط ملفات مدفوعة وغيرها)
// fileUrl يبقى فقط للعناصر المجانية — عشان زر "تحميل مجاني" المباشر
const PRIVATE_FIELDS = ["downloadUrl", "driveUrl", "secret", "email"];
const isFree = (d) => d.isFree === true || !(Number(d.price) > 0);
function stripPrivate(d) {
  for (const p of PRIVATE_FIELDS) delete d[p];
  if (!isFree(d) || !/^https?:\/\//i.test(d.fileUrl || "")) delete d.fileUrl;
  return d;
}

// ---------------- قراءة Firestore (REST) ----------------
function decode(v) {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
function decodeFields(f) {
  const o = {};
  for (const [k, v] of Object.entries(f)) o[k] = decode(v);
  return o;
}

async function fetchCollection(col) {
  const docs = [];
  let pageToken = "";
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${col}` +
      `?key=${API_KEY}&pageSize=300${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`⚠️  ${col}: HTTP ${r.status} — تم تخطي هذا القسم`);
      return [];
    }
    const j = await r.json();
    for (const d of j.documents || []) {
      const data = stripPrivate(decodeFields(d.fields || {}));
      data.id = d.name.split("/").pop();
      data._updated = data.updatedAt || d.updateTime;
      docs.push(data);
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function fetchDoc(p) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${p}?key=${API_KEY}`);
  if (!r.ok) { console.warn(`⚠️  ${p}: HTTP ${r.status}`); return {}; }
  return decodeFields((await r.json()).fields || {});
}

// الترتيب من لوحة التحكم (الحقل order، الأصغر أولاً؛ بدون ترتيب = بالآخر)
const byOrder = (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9);
// روابط القائمة العلوية من لوحة التحكم (🧭 ترتيب الصفحة) — تُضبط بعد تحميل البيانات
let SITE_NAV = null;
function navLinks() {
  if (!SITE_NAV) return `${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}<a href="/tools/">الحاسبات</a><a href="/cad/">3ENG CAD</a><a href="/topics/">التصنيفات</a>`;
  return SITE_NAV.map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join("");
}

async function loadData() {
  const data = await loadRaw();
  for (const s of SECTIONS) if (Array.isArray(data[s.col])) data[s.col].sort(byOrder);
  const nav = data.config?.layout?.nav;
  if (Array.isArray(nav) && nav.length) {
    SITE_NAV = nav.filter((n) => n && n.show !== false && n.label && /^(\/|#|https?:\/\/)/.test(n.href || ""))
      .map((n) => ({ label: String(n.label), href: n.href.startsWith("#") ? "/" + n.href : n.href }));
  }
  return data;
}

async function loadRaw() {
  if (process.env.MOCK_FILE) {
    const mock = JSON.parse(await fs.readFile(process.env.MOCK_FILE, "utf8"));
    for (const arr of Object.values(mock)) if (Array.isArray(arr)) for (const d of arr) stripPrivate(d);
    return mock;
  }
  const out = {};
  for (const s of SECTIONS) out[s.col] = await fetchCollection(s.col);
  out.testimonials = await fetchCollection("testimonials");
  out.custom_sections = await fetchCollection("custom_sections");
  out.section_items = await fetchCollection("section_items");
  out.config = await fetchDoc("site_config/main");
  return out;
}

// ---------------- أدوات مساعدة ----------------
const esc = (s = "") => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clean = (s = "") => String(s ?? "").replace(/\s+/g, " ").replace(/\|+\s*$/, "").trim();
const cut = (s, n) => { s = clean(s); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, "") + "…"; };
const num = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
const arr = (v) => (Array.isArray(v) ? v.filter((x) => clean(x)) : []);
const jsonLd = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;

function slugify(item) {
  const custom = String(item.slug || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return custom || autoSlug(item);
}
function autoSlug(item) {
  const words = (clean(item.title).toLowerCase().match(/[a-z0-9]+/g) || []).slice(0, 5);
  const shortId = item.id.slice(0, 6).toLowerCase();
  return words.length ? `${words.join("-")}-${shortId}` : item.id.toLowerCase();
}

function isoDuration(txt) {
  // "40 ساعة" → PT40H ،  "3-5 ساعات" → PT5H
  const n = String(txt || "").match(/\d+(\.\d+)?/g);
  if (!n) return null;
  const h = Math.ceil(Number(n[n.length - 1]));
  return /دقيق|min/i.test(txt) ? `PT${h}M` : `PT${h}H`;
}
function isoDate(v) {
  if (!v) return null;
  if (typeof v === "object" && v.seconds) return new Date(v.seconds * 1000).toISOString();
  const d = new Date(v);
  return isNaN(d) ? null : d.toISOString();
}
function youtubeId(url = "") {
  const m = String(url).match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function paragraphs(text = "") {
  return String(text).split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("\n");
}
function list(title, items, icon = "✔") {
  items = arr(items);
  if (!items.length) return "";
  return `<section class="box"><h2>${title}</h2><ul class="list">${items
    .map((i) => `<li><span>${icon}</span>${esc(clean(i))}</li>`).join("")}</ul></section>`;
}

// ---------------- القالب ----------------
const CSS = `
:root{--bg:#0b1020;--card:#131a2e;--line:#232c47;--txt:#e9edf7;--mut:#98a2bf;--acc:#F59E0B;--acc2:#fbbf24;--ok:#34d399}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Cairo,system-ui,Tahoma,sans-serif;background:var(--bg);color:var(--txt);line-height:1.8}
a{color:inherit;text-decoration:none}
.wrap{max-width:1080px;margin:auto;padding:0 16px}
header.top{border-bottom:1px solid var(--line);background:#0b1020e6;position:sticky;top:0;z-index:5;backdrop-filter:blur(8px)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;height:62px}
.logo{display:flex;align-items:center;gap:10px;font-weight:800}
.logo img{width:36px;height:36px;border-radius:10px}
.nav{display:flex;gap:18px;font-size:.92rem;color:var(--mut)}
.nav a:hover{color:var(--acc)}
.crumbs{font-size:.82rem;color:var(--mut);margin:18px 0 8px}
.crumbs a:hover{color:var(--acc)}
.hero{display:grid;grid-template-columns:1.3fr 1fr;gap:26px;align-items:start;margin:10px 0 26px}
.hero img{width:100%;height:auto;border-radius:18px;border:1px solid var(--line);aspect-ratio:16/9;object-fit:cover;background:var(--card)}
.emoji-cover{aspect-ratio:16/9;border-radius:18px;background:linear-gradient(135deg,#1e2a55,#131a2e);display:grid;place-items:center;font-size:5rem;border:1px solid var(--line)}
h1{font-size:1.75rem;line-height:1.5;margin-bottom:10px}
.lead{color:var(--mut);margin-bottom:16px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:18px}
.tag{background:var(--card);border:1px solid var(--line);border-radius:999px;padding:4px 12px;font-size:.82rem}
.price{display:flex;align-items:baseline;gap:12px;margin-bottom:16px}
.price b{font-size:2rem;color:var(--acc)}
.price s{color:var(--mut)}
.price .off{background:#34d39922;color:var(--ok);padding:2px 10px;border-radius:999px;font-size:.8rem}
.cta{display:flex;flex-wrap:wrap;gap:10px}
.trust{margin-top:12px;font-size:.82rem;color:var(--mut)}.trust a{color:var(--acc)}
.btn{display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:12px;font-weight:700;font-size:.95rem}
.btn.main{background:var(--acc);color:#1a1200}
.btn.main:hover{background:var(--acc2)}
.btn.wa{background:#25d36622;color:#4ade80;border:1px solid #25d36655}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.box{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:20px;margin-bottom:16px}
.box h2{font-size:1.1rem;margin-bottom:10px;color:var(--acc2)}
.box p{margin-bottom:10px;color:#d3d9ea}
.list{list-style:none;display:grid;gap:6px}
.list li{display:flex;gap:10px;color:#d3d9ea}
.list li span{color:var(--ok)}
.video{position:relative;max-width:760px;margin:auto;aspect-ratio:16/9;border-radius:14px;overflow:hidden;background:#000}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;transition:.2s}
.card:hover{border-color:var(--acc);transform:translateY(-2px)}
.card img,.card .ph{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#1a2340}
.card .ph{display:grid;place-items:center;font-size:2.6rem}
.card .b{padding:12px 14px}
.card h3{font-size:.98rem;line-height:1.6;margin-bottom:4px}
.card .p{color:var(--acc);font-weight:700}
.sec-title{font-size:1.3rem;margin:30px 0 14px}
footer{border-top:1px solid var(--line);margin-top:40px;padding:26px 0;color:var(--mut);font-size:.85rem;text-align:center}
footer nav{display:flex;justify-content:center;flex-wrap:wrap;gap:16px;margin-bottom:10px}
.facts{width:100%;border-collapse:collapse;font-size:.92rem}
.facts th,.facts td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}
.facts th{color:var(--mut);font-weight:700;width:34%;white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{display:inline-block;border:1px solid var(--acc);color:var(--acc2);border-radius:999px;padding:1px 12px;font-size:.82rem}
.faq details{border:1px solid var(--line);border-radius:12px;margin-bottom:8px;padding:0 14px}
.faq summary{cursor:pointer;padding:12px 0;font-weight:700}
.faq p{padding-bottom:12px;color:#d3d9ea}
.card .k{font-size:.72rem;color:var(--mut)}
.rv{border-right:3px solid var(--acc);background:#0f1528;border-radius:10px;padding:12px 16px;margin:0 0 10px}
.rv p{margin:6px 0;color:#dfe4f1}
.rv footer{font-size:.85rem;color:var(--mut)}
.answer{border-color:var(--acc);background:linear-gradient(135deg,#1c2542,#131a2e)}
.answer p{font-size:1.02rem;color:#eef1f8}
.person{display:grid;grid-template-columns:140px 1fr;gap:24px;align-items:center;margin:14px 0 24px}
.person .av{width:140px;height:140px;border-radius:50%;background:linear-gradient(135deg,var(--acc),var(--acc2));display:grid;place-items:center;font-size:3rem;font-weight:800;color:#1a1200;overflow:hidden;border:3px solid var(--acc)}
.person .av img{width:100%;height:100%;object-fit:cover}
.person .role{color:var(--acc2);font-weight:700}
@media(max-width:600px){.person{grid-template-columns:1fr;text-align:center}.person .av{margin:auto}}
.article{max-width:760px;margin:0 auto}
.article .meta{color:var(--mut);font-size:.88rem;margin:6px 0 18px;display:flex;flex-wrap:wrap;gap:14px}
.article .cover{width:100%;height:auto;border-radius:16px;border:1px solid var(--line);margin-bottom:22px}
.prose{font-size:1.06rem;line-height:2}
.prose h2{font-size:1.35rem;margin:28px 0 10px;color:var(--acc2)}
.prose h3{font-size:1.12rem;margin:22px 0 8px}
.prose p{margin-bottom:14px;color:#dfe4f1}
.prose ul,.prose ol{margin:0 22px 16px 0;display:grid;gap:6px}
.prose a{color:var(--acc);text-decoration:underline}
.prose img{max-width:100%;height:auto;border-radius:12px;margin:10px 0}
.prose blockquote{border-right:4px solid var(--acc);padding:8px 16px;margin:14px 0;background:var(--card);border-radius:8px;color:#dfe4f1}
.prose code{background:#1a2340;padding:1px 6px;border-radius:6px;direction:ltr;unicode-bidi:embed}
.prose pre{background:#0a0f1d;border:1px solid var(--line);border-radius:10px;padding:14px;overflow:auto;direction:ltr;text-align:left;margin:14px 0}
.prose pre code{background:none;padding:0}
.tbl{overflow-x:auto;margin:14px 0}.tbl table{border-collapse:collapse;width:100%;font-size:.94rem}.tbl th,.tbl td{border:1px solid var(--line);padding:8px 12px;text-align:right;vertical-align:top}.tbl th{background:#1a2340;color:var(--acc2)}.tbl tr:nth-child(even) td{background:#0f1528}
.calc .fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:14px}
.calc label{display:flex;flex-direction:column;gap:4px;font-size:.86rem;color:var(--mut)}
.calc input,.calc select{background:#0a0f1d;border:1px solid var(--line);border-radius:10px;padding:9px 12px;color:var(--txt);font:inherit;width:100%}
.calc input:focus,.calc select:focus{outline:none;border-color:var(--acc)}
.calc .u{display:flex;gap:6px}.calc .u select{width:auto}
.calc .chk{flex-direction:row;align-items:center;gap:8px}.calc .chk input{width:auto}
.calc .sub{grid-column:1/-1;margin:0}
.res{display:grid;gap:6px}.res .r{display:flex;justify-content:space-between;gap:10px;padding:9px 12px;background:#0f1528;border-radius:10px}.res .r.main{border:1px solid var(--acc);background:#1c2542}.res .r.main b{color:var(--acc2);font-size:1.1rem}
.hint{font-size:.82rem;color:var(--mut);margin-top:8px}
.warn{background:#3b2a0a;border:1px solid #F59E0B55;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:.9rem}
.rsvg{width:100%;max-width:320px;display:block;margin:0 auto 12px}
.rev{margin:6px 0 14px;font-size:.9rem}.rev .u{max-width:260px;margin:6px 0}
.tblw{overflow-x:auto}.loads{width:100%;border-collapse:collapse;font-size:.88rem}.loads th{color:var(--mut);text-align:right;padding:6px}.loads td{padding:4px}.loads{table-layout:fixed}.loads th:nth-child(1){width:34%}.loads th:last-child{width:28px}.loads th{font-size:.78rem}.loads input{padding:7px 6px;min-width:0}
.calc .add{background:none;border:1px dashed var(--acc);color:var(--acc2);border-radius:10px;padding:7px 14px;margin:8px 0 14px;font:inherit;cursor:pointer}
.calc .del{background:none;border:0;color:#f87171;cursor:pointer;font-size:1rem}
.tlinks{display:flex;flex-wrap:wrap;gap:8px}.tlinks a{border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:.88rem}.tlinks a:hover{border-color:var(--acc)}
[hidden]{display:none!important}
.answer b,.box p b{unicode-bidi:plaintext}
.box p.eq{direction:ltr;unicode-bidi:isolate;text-align:center;font-family:Consolas,"Courier New",monospace;font-size:1rem;font-weight:700;color:var(--acc2);background:#0a0f1d;border:1px solid var(--line);border-radius:10px;padding:8px 14px;margin:6px 0 12px;overflow-x:auto;white-space:nowrap}
.schem{max-width:520px;margin:6px auto 16px;color:#cbd3e6}.schem svg{width:100%;height:auto;display:block;direction:ltr}.schem text{fill:var(--acc2);stroke:none;font-weight:700;font-size:15px;font-family:inherit}.schem .pin text{fill:#98a2bf;font-size:11px;font-weight:700}.schem .chip{font-size:26px;fill:#cbd3e6}.schem .hl{stroke:var(--acc)}
.pro-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px dashed var(--line)}.pro-btn{background:#1c2542;border:1px solid var(--acc);color:var(--acc2);border-radius:10px;padding:7px 14px;font:inherit;font-size:.88rem;cursor:pointer}.pro-btn:hover{background:#26305a}.pro-tag{font-size:.75rem;color:var(--mut);margin-inline-start:auto}.pro-bar.is-pro .pro-tag{color:var(--ok)}
.pro-msg{flex-basis:100%;background:#1c2542;border:1px solid var(--acc);border-radius:12px;padding:10px 14px;font-size:.9rem}.pro-msg a{color:var(--acc);font-weight:700;text-decoration:underline}.pro-buy{display:inline-block;margin-top:6px}
.pro-list{flex-basis:100%;margin-top:6px;font-size:.9rem}.pro-item{display:flex;align-items:center;gap:8px;padding:7px 10px;background:#0f1528;border-radius:10px;margin-top:6px}.pro-item span{flex:1}.pro-item small{display:block;color:var(--mut);font-size:.75rem}.pro-item button{background:none;border:1px solid var(--line);color:var(--txt);border-radius:8px;padding:3px 10px;font:inherit;font-size:.8rem;cursor:pointer}
.vd{position:relative;max-width:520px;margin:4px auto 6px;aspect-ratio:480/300;color:#cbd3e6}.vd svg{width:100%;height:100%;display:block}.vd .lbl{fill:var(--acc2)}
.vd input{position:absolute;width:21%;padding:6px 8px;text-align:center;font-weight:700;background:#0a0f1d;border:1.5px solid var(--acc);border-radius:9px;color:var(--txt);font:inherit;font-size:.95rem}
.vd input.auto{border-color:var(--ok);color:var(--ok);background:#0d2a22;box-shadow:0 0 0 3px #34d39933}
.calc .clr{background:none;border:0;color:var(--acc);text-decoration:underline;cursor:pointer;font:inherit}
@media(max-width:480px){.vd input{font-size:.8rem;padding:4px}.vd .lbl{font-size:18px}}
@media(max-width:820px){.hero,.grid2{grid-template-columns:1fr}.nav{display:none}h1{font-size:1.4rem}.facts th{white-space:normal}}
`;

function layout({ title, description, canonical, image, schemas, body, ogType = "website", itemId = "" }) {
  const img = image || OG_DEFAULT;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">${itemId ? `\n<meta name="3engs-id" content="${esc(itemId)}">` : ""}
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/logo.jpg">
<meta name="theme-color" content="#F59E0B">
<meta property="og:type" content="${ogType}">
<meta property="og:site_name" content="${BRAND}">
<meta property="og:locale" content="ar_PS">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(img)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(img)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap" rel="stylesheet">
<style>${CSS.replace(/\s*\n\s*/g, "").replace(/\s*([{}:;,])\s*/g, "$1").replace(/;}/g, "}")}</style>
${schemas.map(jsonLd).join("\n")}
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-GZJCYL5YM8"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-GZJCYL5YM8');</script>
<script src="/assets/visit.js" defer></script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="/"><img src="/logo.jpg" alt="شعار 3ENG.s" width="36" height="36">${BRAND}</a>
  <nav class="nav">${navLinks()}</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">
  <nav><a href="/">الرئيسية</a>${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}<a href="/tools/">الحاسبات</a><a href="/cad/">3ENG CAD</a><a href="/topics/">التصنيفات</a><a href="/team/">الفريق</a><a href="/about/">من نحن</a><a href="/#faq">الأسئلة الشائعة</a><a href="/privacy.html">سياسة الخصوصية</a></nav>
  © ${new Date().getFullYear()} ${BRAND} — ${BRAND_AR} • منصة تعليم الهندسة الكهربائية والأنظمة المدمجة
</div></footer>
</body>
</html>`;
}

function crumbs(items) {
  const html = `<nav class="crumbs" aria-label="مسار التنقل">${items
    .map((c, i) => (i < items.length - 1 ? `<a href="${c.url}">${esc(c.name)}</a> ‹ ` : `<span>${esc(c.name)}</span>`)).join("")}</nav>`;
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.name, item: SITE + c.url })),
  };
  return { html, schema };
}

const ORG_ID = `${SITE}/#organization`;
const ORG = {
  "@type": "EducationalOrganization", "@id": ORG_ID, name: BRAND, alternateName: BRAND_AR, url: SITE + "/", logo: `${SITE}/logo.jpg`,
  sameAs: ["https://www.instagram.com/3eng.s", "https://www.tiktok.com/@3eng.s", "https://www.facebook.com/profile.php?id=61584936014304", "https://linktr.ee/3eng.s"],
};

// ---------------- آراء الطلاب ----------------
let REVIEWS = [];
function reviewsOf(sec, item) {
  const key = `${sec.col}/${item.id}`;
  return REVIEWS.filter((r) => r.itemRef === key && clean(r.text) && clean(r.name));
}
function ratingOf(list) {
  if (!list.length) return null;
  const vals = list.map((r) => Math.min(5, Math.max(1, Number(r.rating) || 5)));
  return { avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10, count: vals.length };
}

// ---------------- الفريق (E-E-A-T) ----------------
// photo: ضع صورة في /img/team/{slug}.jpg وبتظهر تلقائياً
const TEAM = [
  {
    slug: "hosam-zaqout", name: "م. حسام زقوت", en: "Hosam Zaqout", aliases: ["حسام زقوت", "hosam zaqout", "hosam"],
    role: "مهندس كهربائي • مؤسس ومدرّب", jobTitle: "Electrical Engineer, Founder & Trainer", founder: true,
    bio: [
      "مهندس كهربائي ومؤسس منصة 3ENG.s. حاصل على بكالوريوس الهندسة الكهربائية من الجامعة الإسلامية بغزة، وعمل مساعد تدريس وبحث ومحاضراً زائراً في إنترنت الأشياء والحساسات.",
      "متخصص في الأنظمة المدمجة وتصميم الدوائر المطبوعة PCB والعتاد المدمج بالذكاء الاصطناعي، ويدرّب على ESP32 و Arduino و Python ومعالجة الصور.",
    ],
    alumniOf: "Islamic University of Gaza", alumniAr: "الجامعة الإسلامية بغزة",
    knows: ["Embedded Systems", "IoT", "PCB Design", "ESP32", "Arduino", "Python", "AI Hardware", "Control Systems"],
    sameAs: [
      "https://www.linkedin.com/in/hosam-r-k-zaqout-142533202/",
      "https://www.researchgate.net/profile/Hosam-Zaqout/",
      "https://www.youtube.com/@hosam.zaqout",
    ],
  },
  {
    slug: "israa-altaweel", name: "م. إسراء الطويل", en: "Israa Al-Taweel", aliases: ["إسراء الطويل", "اسراء الطويل", "israa"],
    role: "مهندسة أنظمة مدمجة • مدرّبة", jobTitle: "Embedded Systems Engineer & Trainer",
    bio: [
      "مهندسة متخصصة في إنترنت الأشياء والأنظمة المدمجة، درّبت أكثر من 300 طالب.",
      "لها مشاريع عملية في الطاقة الشمسية والأتمتة والأجهزة الذكية.",
    ],
    knows: ["IoT", "Embedded Systems", "Arduino", "Python", "Electronics"],
    sameAs: [],
  },
  {
    slug: "furat-altaweel", name: "م. فرات الطويل", en: "Furat Al-Taweel", aliases: ["فرات الطويل", "furat"],
    role: "مهندسة أنظمة ذكية • تطوير المنتجات والتدريب", jobTitle: "Smart Systems Engineer, Product Development & Trainer",
    bio: [
      "مهندسة أنظمة ذكية مهتمة بتطوير المنتجات، وبتعليم الأطفال علوم الإلكترونيات واللغات.",
      "لديها خبرة كبيرة في إعداد السيرة الذاتية، وتدريب الطلاب على اجتياز المقابلات والتقدّم للمنح الدراسية.",
    ],
    knows: ["Smart Systems", "Product Development", "Electronics for Kids", "CV Writing", "Interview Preparation", "Scholarships"],
    sameAs: [],
  },
];
const normName = (t) => clean(t).replace(/^م\.?\s*/, "").replace(/\s+/g, " ").toLowerCase();
function teamOf(name) {
  const n = normName(name);
  if (!n) return null;
  return TEAM.find((m) => normName(m.name) === n || m.aliases.some((a) => n.includes(a.toLowerCase()))) || null;
}
// المدرّب: حقل instructor، أو سطر "المدرب: ..." داخل الوصف
function instructorOf(item) {
  const raw = clean(item.instructor) || ((String(item.desc || "").match(/المدرب\s*[:：]\s*([^\n]+)/) || [])[1] || "");
  return clean(raw);
}
function personLd(name) {
  const m = teamOf(name);
  return m
    ? { "@type": "Person", "@id": `${SITE}/team/${m.slug}/#person`, name: m.en, alternateName: m.name.replace(/^م\.\s*/, ""), url: `${SITE}/team/${m.slug}/` }
    : { "@type": "Person", name: clean(name) };
}
function personLink(name) {
  const m = teamOf(name);
  return m ? `<a href="/team/${m.slug}/" style="color:var(--acc)">${esc(clean(name))}</a>` : esc(clean(name));
}
async function teamPhoto(m) {
  for (const ext of ["webp", "jpg", "png"]) {
    try { await fs.access(path.join(OUT_DIR, "img", "team", `${m.slug}.${ext}`)); return `/img/team/${m.slug}.${ext}`; } catch {}
  }
  return "";
}

// ---------------- ضغط الصور (WebP) ----------------
// لكل عنصر: /img/{col}/{id}.webp (1200px) و {id}-480.webp للبطاقات
// ما بيعيد الضغط إلا إذا تغيّر رابط الصورة الأصلية. بدون sharp ← بيستخدم الصورة الأصلية
let sharp = null;
try { sharp = (await import("sharp")).default; } catch { console.warn("ℹ️  sharp غير مثبّت — الصور بدون ضغط"); }

async function optimizeImages(data) {
  const manifestPath = path.join(OUT_DIR, "img", "manifest.json");
  let manifest = {};
  try { manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")); } catch {}
  const keep = new Set();
  let done = 0, reused = 0;
  for (const { sec, items } of data.groups) {
    for (const it of items) {
      const src = it.imageUrl || it.coverUrl || it.image;
      if (!src || !/^https?:\/\//.test(src)) continue;
      const key = `${sec.col}/${it.id}`;
      const hash = crypto.createHash("sha1").update(src).digest("hex").slice(0, 12);
      const big = `img/${key}.webp`, small = `img/${key}-480.webp`;
      const prev = manifest[key];
      let exists = false;
      try { await fs.access(path.join(OUT_DIR, big)); await fs.access(path.join(OUT_DIR, small)); exists = true; } catch {}
      if (prev && prev.hash === hash && exists) {
        Object.assign(it, { _img: "/" + big, _thumb: "/" + small, _w: prev.w, _h: prev.h });
        keep.add(key); reused++; continue;
      }
      if (!sharp) continue;
      try {
        const r = await fetch(src);
        if (!r.ok) throw new Error("HTTP " + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.mkdir(path.dirname(path.join(OUT_DIR, big)), { recursive: true });
        const out = await sharp(buf).rotate().resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer({ resolveWithObject: true });
        await fs.writeFile(path.join(OUT_DIR, big), out.data);
        await fs.writeFile(path.join(OUT_DIR, small), await sharp(buf).rotate().resize({ width: 480, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer());
        manifest[key] = { hash, w: out.info.width, h: out.info.height, fromKB: Math.round(buf.length / 1024), toKB: Math.round(out.data.length / 1024) };
        Object.assign(it, { _img: "/" + big, _thumb: "/" + small, _w: out.info.width, _h: out.info.height });
        keep.add(key); done++;
      } catch (e) {
        console.warn(`⚠️  صورة ${key}: ${e.message}`);
      }
    }
  }
  // حذف صور العناصر المحذوفة
  for (const key of Object.keys(manifest)) {
    if (keep.has(key)) continue;
    delete manifest[key];
    for (const f of [`img/${key}.webp`, `img/${key}-480.webp`]) await fs.rm(path.join(OUT_DIR, f), { force: true });
  }
  if (Object.keys(manifest).length || done) await writeFile("img/manifest.json", JSON.stringify(manifest, null, 1) + "\n");
  console.log(`🖼️  الصور: ${done} مضغوطة جديدة، ${reused} بدون تغيير`);
}
const absUrl = (u) => (u && u.startsWith("/") ? SITE + u : u);

// ---------------- التصنيفات (التقنيات والمجالات) ----------------
// الاسم اللي بتكتبه في لوحة التحكم ← صفحة /topics/{slug}/
const TAXONOMY = [
  { slug: "arduino",       names: ["arduino", "اردوينو", "أردوينو"],                    ar: "أردوينو Arduino",            about: "لوحات Arduino هي أشهر منصة لتعلّم برمجة المتحكمات والإلكترونيات، ومناسبة للمبتدئين ومشاريع الروبوتات والأتمتة." },
  { slug: "esp32",         names: ["esp32"],                                             ar: "ESP32",                       about: "ESP32 متحكم قوي منخفض التكلفة يدعم Wi-Fi و Bluetooth، ويُستخدم بكثرة في مشاريع إنترنت الأشياء والأنظمة الذكية." },
  { slug: "esp8266",       names: ["esp8266", "nodemcu"],                                ar: "ESP8266 / NodeMCU",           about: "ESP8266 متحكم صغير مزوّد بـ Wi-Fi، مناسب لمشاريع إنترنت الأشياء البسيطة والتحكم عن بعد." },
  { slug: "raspberry-pi",  names: ["raspberry pi", "raspberry", "راسبيري", "راسبيري باي"], ar: "راسبيري باي Raspberry Pi",   about: "Raspberry Pi حاسوب صغير بحجم الكف يعمل بنظام Linux، ويُستخدم في المشاريع الذكية ومعالجة الصور والذكاء الاصطناعي." },
  { slug: "pic",           names: ["pic", "pic microcontroller"],                        ar: "متحكمات PIC",                 about: "متحكمات PIC من Microchip تُدرَّس في الجامعات وتُستخدم في الأنظمة الصناعية وأنظمة الحماية والتحكم." },
  { slug: "stm32",         names: ["stm32"],                                             ar: "STM32",                       about: "متحكمات STM32 المبنية على ARM Cortex-M تُستخدم في التطبيقات الاحترافية والصناعية التي تحتاج أداءً عالياً." },
  { slug: "python",        names: ["python", "بايثون"],                                  ar: "بايثون Python",               about: "Python لغة برمجة سهلة وقوية، وهي الأساس في الذكاء الاصطناعي وتحليل البيانات وبرمجة الأجهزة الذكية." },
  { slug: "pcb-design",    names: ["pcb", "pcb design", "تصميم pcb", "تصميم اللوحات المطبوعة"], ar: "تصميم الدوائر المطبوعة PCB", about: "تصميم PCB هو تحويل الدائرة الإلكترونية إلى لوحة مطبوعة احترافية قابلة للتصنيع." },
  { slug: "electronics",   names: ["electronics", "الكترونيات", "إلكترونيات", "الإلكترونيات"], ar: "الإلكترونيات",           about: "أساسيات الإلكترونيات: المقاومات والمكثفات والترانزستورات والدوائر، وهي نقطة البداية لكل مهندس ومبتكر." },
  { slug: "iot",           names: ["iot", "انترنت الاشياء", "إنترنت الأشياء"],           ar: "إنترنت الأشياء (IoT)",        about: "إنترنت الأشياء يربط الحساسات والأجهزة بالإنترنت للمراقبة والتحكم عن بعد عبر الهاتف والمنصات السحابية." },
  { slug: "embedded-systems", names: ["embedded", "embedded systems", "الانظمة المدمجة", "الأنظمة المدمجة"], ar: "الأنظمة المدمجة", about: "الأنظمة المدمجة هي أنظمة حاسوبية صغيرة مخصّصة لمهمة محددة داخل جهاز أكبر، مثل المتحكمات في الأجهزة الذكية." },
  { slug: "automation",    names: ["automation", "اتمتة", "أتمتة", "التحكم", "control"], ar: "الأتمتة والتحكم",             about: "الأتمتة وأنظمة التحكم تجعل الأجهزة تعمل تلقائياً وبدقة، من التحكم المنزلي إلى خطوط الإنتاج الصناعية." },
  { slug: "ai",            names: ["ai", "ذكاء اصطناعي", "الذكاء الاصطناعي"],            ar: "الذكاء الاصطناعي",            about: "الذكاء الاصطناعي يمكّن الأنظمة من التعلّم واتخاذ القرار، ويُدمج اليوم مع المتحكمات والحساسات في المشاريع الذكية." },
  { slug: "robotics",      names: ["robotics", "روبوت", "روبوتات", "روبوتيكس"],          ar: "الروبوتات",                   about: "الروبوتات تجمع بين الميكانيك والإلكترونيات والبرمجة لبناء آلات تتحرك وتتفاعل مع محيطها." },
  { slug: "renewable-energy", names: ["renewable energy", "solar", "طاقة متجددة", "الطاقة المتجددة", "طاقة شمسية"], ar: "الطاقة المتجددة", about: "الطاقة المتجددة تشمل أنظمة الطاقة الشمسية والرياح، وهي من أسرع مجالات الهندسة الكهربائية نمواً." },
  { slug: "drivers-tools", names: ["driver", "drivers", "تعريفات", "أدوات"],             ar: "تعريفات وأدوات",              about: "تعريفات وأدوات يحتاجها كل من يعمل على لوحات Arduino و ESP لتتعرّف عليها أجهزة الكمبيوتر." },
];
function topicOf(tag) {
  const t = clean(tag).toLowerCase();
  return TAXONOMY.find((x) => x.names.includes(t) || x.slug === t) || null;
}
function itemTopics(it) {
  const out = [];
  for (const t of arr(it.tags)) { const x = topicOf(t); if (x && !out.includes(x)) out.push(x); }
  return out;
}

// أول جملة من نص: بدون رموز Markdown، و«م.» (مهندس) ما بتنهي الجملة
function firstSent(t) {
  // ⁠ (word joiner) مش مسافة — فالتقسيم ما بيوقف عند «م.»
  const p = md.plain(t).replace(/(^|\s)م\.\s/g, "$1م.⁠");
  return (p.split(/(?<=[.!؟?])\s/)[0] || "").replace(/⁠/g, " ");
}

// ---------------- وصف نتائج البحث (Meta Description) ----------------
function fitMeta(head, middle, cta, max = 155) {
  const fixed = `${head}${middle ? ": " : ""}`;
  const tail = ` ${cta}`;
  let mid = clean(middle).replace(/[.،,:؛\s]+$/, "");
  const room = max - fixed.length - tail.length - 1;
  if (mid.length > room) mid = mid.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "") + "…";
  let out = `${fixed}${mid}${mid && !mid.endsWith("…") ? "." : ""}${tail}`;
  // قصير كثير؟ نضيف اسم المنصة
  if (out.length < 120) out += ` — منصة ${BRAND} ${BRAND_AR}`;
  return cut(out, max);
}
function metaDescription(sec, item) {
  const title = cut(clean(item.title).split("|")[0].trim(), 60);
  const free = isFree(item);
  const price = num(item.price) ?? 0;
  const L = arr(item.learns).map(clean).filter((x) => x.length < 70);
  const first = firstSent;
  if (sec.type === "Course") {
    const facts = [item.level, item.duration].filter(Boolean).join("، ");
    const what = L.length ? "تعلّم " + L.slice(0, 2).join(" و") : first(item.desc);
    return fitMeta(`دورة ${title}`, [facts, what].filter(Boolean).join(" — "), free ? "سجّل مجاناً مع شهادة معتمدة." : `اشترك الآن بـ${price}$ مع شهادة معتمدة.`);
  }
  if (sec.type === "Article") {
    // المقال: الملخص نفسه هو الوصف (العنوان موجود أصلاً بعنوان الصفحة)
    const cta = ` اقرأ المقال على ${BRAND}.`;
    let body = clean(item.desc || md.plain(item.body)).replace(/[.،\s]+$/, "");
    if (body.length + 1 + cta.length > 155) body = body.slice(0, 155 - cta.length - 2).replace(/\s+\S*$/, "") + "…";
    return `${body}${body.endsWith("…") ? "" : "."}${cta}`;
  }
  const cta = free ? "حمّله مجاناً الآن." : `اطلبه الآن بـ${price}$.`;
  if (sec.col === "books") return fitMeta(`كتاب ${title}${item.author ? " — " + clean(item.author) : ""}`, first(item.desc), cta);
  if (sec.col === "projects") return fitMeta(`مشروع ${title}`, item.shortDesc || first(item.desc), free ? "حمّل الكود والمخطط مجاناً." : `اطلبه الآن بـ${price}$ مع الكود الكامل.`);
  return fitMeta(title, item.shortDesc || first(item.desc), cta);
}

// ---------------- صفحة العنصر ----------------
function itemPage(sec, item, siblings, all) {
  const title = clean(item.title) || `${sec.one} من ${BRAND}`;
  const url = `/${sec.dir}/${item._slug}/`;
  const canonical = SITE + url;
  const desc = cut(item.shortDesc || item.desc || `${sec.one} ${title} من منصة ${BRAND}`, 155);
  const price = num(item.price) ?? 0;
  const free = isFree(item);
  const oldPrice = num(item.oldPrice);
  const orig = item.imageUrl || item.coverUrl || item.image || "";
  const img = item._img || orig;
  const imgAbs = absUrl(img);
  const yt = youtubeId(item.videoUrl);
  const updated = isoDate(item._updated);
  const topics = itemTopics(item);
  const audience = arr(item.audience).map(clean);
  const faqs = (Array.isArray(item.faqs) ? item.faqs : []).filter((f) => f && clean(f.q) && clean(f.a));
  const offer = {
    "@type": "Offer",
    price: String(free ? 0 : price),
    priceCurrency: CURRENCY,
    availability: "https://schema.org/InStock",
    url: canonical,
    ...(sec.type === "Course" ? { category: free ? "Free" : "Paid" } : {}),
  };
  const extra = {
    ...(topics.length || arr(item.tags).length ? { keywords: [...new Set([...topics.map((t) => t.ar), ...arr(item.tags).map(clean)])].join("، ") } : {}),
    ...(audience.length ? { audience: { "@type": "Audience", audienceType: audience.join("، ") } } : {}),
    isAccessibleForFree: free,
    inLanguage: "ar",
  };

  let main;
  if (sec.type === "Course") {
    const workload = isoDuration(item.duration);
    main = {
      "@context": "https://schema.org",
      "@type": "Course",
      name: title,
      description: cut(item.desc || item.shortDesc || desc, 500),
      url: canonical,
      ...(imgAbs ? { image: imgAbs } : {}),
      provider: ORG,
      offers: offer,
      ...(item.level ? { educationalLevel: item.level } : {}),
      ...(arr(item.learns).length ? { teaches: arr(item.learns).map(clean) } : {}),
      ...(arr(item.requirements).length ? { coursePrerequisites: arr(item.requirements).map(clean) } : {}),
      ...(arr(item.topics).length ? { syllabusSections: arr(item.topics).slice(0, 30).map((t) => ({ "@type": "Syllabus", name: clean(t) })) } : {}),
      ...(instructorOf(item) ? { author: personLd(instructorOf(item)) } : {}),
      hasCourseInstance: {
        "@type": "CourseInstance",
        courseMode: item.mode || "Online",
        ...(instructorOf(item) ? { instructor: personLd(instructorOf(item)) } : {}),
        ...(workload ? { courseWorkload: workload } : {}),
        inLanguage: "ar",
      },
      ...extra,
    };
  } else {
    main = {
      "@context": "https://schema.org",
      "@type": sec.col === "books" ? ["Product", "Book"] : "Product",
      name: title,
      description: cut(item.desc || item.shortDesc || desc, 500),
      url: canonical,
      sku: item.id,
      ...(sec.col === "books" ? { bookFormat: "https://schema.org/EBook", ...(num(item.pages) ? { numberOfPages: num(item.pages) } : {}) } : {}),
      image: imgAbs || `${SITE}/logo.jpg`,
      brand: { "@type": "Brand", name: BRAND },
      category: (item.category && isNaN(item.category) ? item.category : "") || sec.one,
      ...(item.author ? { author: personLd(item.author) } : {}),
      offers: offer,
      ...extra,
    };
  }
  if (updated) main.dateModified = updated;
  const reviews = reviewsOf(sec, item);
  const rating = ratingOf(reviews);
  if (rating) {
    main.aggregateRating = { "@type": "AggregateRating", ratingValue: rating.avg, reviewCount: rating.count, bestRating: 5, worstRating: 1 };
    main.review = reviews.slice(0, 10).map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: clean(r.name) },
      reviewRating: { "@type": "Rating", ratingValue: Math.min(5, Math.max(1, Number(r.rating) || 5)), bestRating: 5 },
      reviewBody: clean(r.text),
      ...(isoDate(r.createdAt) ? { datePublished: isoDate(r.createdAt).slice(0, 10) } : {}),
    }));
  }

  const schemas = [main];
  if (faqs.length) schemas.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: clean(f.q), acceptedAnswer: { "@type": "Answer", text: clean(f.a) } })),
  });

  const bc = crumbs([
    { name: "الرئيسية", url: "/" },
    { name: sec.label, url: `/${sec.dir}/` },
    { name: cut(title, 60), url },
  ]);
  schemas.push(bc.schema);

  const tags = [
    item.category && isNaN(item.category) ? `📂 ${item.category}` : "",
    item.level && `🎯 ${item.level}`,
    item.duration && `⏱ ${item.duration}`,
    item.lessons && `📹 ${item.lessons}`,
    item.author && `✍️ ${item.author}`,
    item.pages && `📄 ${item.pages} صفحة`,
  ].filter(Boolean);

  // ملخص سريع — معلومات واضحة وسهلة الاستخراج لجوجل والـ AI
  const howGet = free
    ? (item.fileUrl ? "تحميل مباشر ومجاني — بدون دفع أو تسجيل" : "مجاني — تواصل معنا للحصول عليه")
    : sec.type === "Course"
      ? "بعد الاشتراك نتواصل معك بتفاصيل الوصول (أونلاين مباشر أو مسجّلة حسب الدورة)"
      : "تحميل فوري بعد تأكيد الدفع من صفحة «مشترياتي» في حسابك";
  const facts = [
    ["النوع", sec.one],
    topics.length ? ["التقنيات والمجالات", `<span class="chips">${topics.map((t) => `<a class="chip" href="/topics/${t.slug}/">${esc(t.ar)}</a>`).join("")}</span>`, true] : null,
    item.level ? ["المستوى", item.level] : null,
    item.duration ? ["المدة", item.duration] : null,
    item.lessons ? ["عدد الدروس", item.lessons] : null,
    instructorOf(item) ? ["المدرّب", personLink(instructorOf(item)), true] : null,
    item.author ? ["المؤلف", personLink(item.author), true] : null,
    ["اللغة", "العربية"],
    ["السعر", free ? "مجاني" : `$${price} ${CURRENCY}`],
    ["طريقة الحصول عليه", howGet],
    sec.type === "Course" ? ["الشهادة", "شهادة معتمدة لكل من يُنجز الدورة"] : null,
    rating ? ["تقييم الطلاب", `★ ${rating.avg.toFixed(1)} من 5 (${rating.count} ${rating.count === 1 ? "تقييم" : "تقييمات"})`] : null,
    updated ? ["آخر تحديث", updated.slice(0, 10)] : null,
  ].filter(Boolean);
  const factsHtml = `<section class="box"><h2>⚡ ملخص سريع</h2><table class="facts">${facts.map(([k, v, raw]) => `<tr><th>${k}</th><td>${raw ? v : esc(v)}</td></tr>`).join("")}</table></section>`;

  const license = free
    ? ""
    : `<section class="box"><h2>📥 الاستلام والترخيص</h2><p>${sec.type === "Course"
        ? "بعد إتمام الاشتراك يتواصل معك فريقنا بتفاصيل الوصول إلى الدورة ومواعيدها أو روابط الدروس المسجّلة."
        : "بعد تأكيد الدفع تظهر ملفات المنتج فوراً في صفحة «📦 مشترياتي» داخل حسابك، ويمكنك تحميلها في أي وقت."}
 تحصل على رخصة استخدام شخصي، ويُمنع إعادة بيع المحتوى أو نشره. التفاصيل في <a href="/privacy.html#terms" style="color:var(--acc)">شروط الاستخدام</a> و<a href="/privacy.html#refund" style="color:var(--acc)">سياسة الإرجاع</a>.</p></section>`;

  const off = oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
  const waMsg = encodeURIComponent(`مرحباً 3ENG.s، أرغب في طلب: ${title}\n${canonical}`);
  const cover = img
    ? `<img src="${esc(img)}" alt="${esc(title)}" width="${item._w || 800}" height="${item._h || 450}" fetchpriority="high" decoding="async">`
    : `<div class="emoji-cover">${item.emoji || sec.emoji}</div>`;

  const learnTitle = sec.type === "Course" ? "🎯 ماذا ستتعلم" : "🎁 ماذا ستحصل عليه";

  // ✅ باختصار: جواب مباشر يقدر جوجل والذكاء الاصطناعي يقتبسه كما هو
  const instr = instructorOf(item);
  const firstSentence = (t) => cut(firstSent(t), 160);
  const L = arr(item.learns).map(clean).filter((x) => x.length < 90);
  const topicNames = topics.map((t) => t.ar);
  const priceTxt = free ? "وهو مجاني بالكامل" : `وسعره ${price}$`;
  let answer;
  if (sec.type === "Course") {
    answer = `«${title}» دورة${item.level ? " بمستوى " + item.level : ""} باللغة العربية من منصة ${BRAND}${instr ? "، يقدّمها " + instr : ""}${item.duration ? "، مدتها " + item.duration : ""}${item.lessons ? " في " + item.lessons : ""}.`
      + (L.length ? ` ستتعلم فيها: ${L.slice(0, 4).join("، ")}.` : item.desc ? " " + firstSentence(item.desc) : "")
      + (audience.length ? ` الفئة المستهدفة: ${audience.slice(0, 2).join("، ")}.` : "")
      + ` تُمنح شهادة معتمدة عند إتمامها، ${free ? "وهي مجانية" : "وسعرها " + price + "$"}.`;
  } else {
    const kind = sec.col === "books" ? "كتاب" : sec.col === "projects" ? "مشروع" + (item.level ? " بمستوى " + item.level : "") + " جاهز" : sec.one;
    answer = `«${title}» ${kind} باللغة العربية من منصة ${BRAND}${item.author ? " من تأليف " + clean(item.author) : ""}${topicNames.length ? " في مجال " + topicNames.slice(0, 3).join(" و") : ""}.`
      + (item.shortDesc ? " " + cut(item.shortDesc, 170) : item.desc ? " " + firstSentence(item.desc) : "")
      + (L.length && sec.col === "projects" ? ` يتضمن: ${L.slice(0, 4).join("، ")}.` : "")
      + (arr(item.components).length ? ` أهم المكونات: ${arr(item.components).slice(0, 4).map((c) => clean(c).split(/[(—]/)[0].trim()).join("، ")}.` : "")
      + (audience.length ? ` الفئة المستهدفة: ${audience.slice(0, 2).join("، ")}` : "")
      + `${audience.length ? ". " : " "}${free ? "وهو مجاني بالكامل" : "السعر " + price + "$"}.`;
  }
  const answerHtml = `<section class="box answer"><h2>✅ باختصار</h2><p>${esc(answer)}</p>${instr ? `<p style="margin:0">👨‍🏫 المدرّب: ${personLink(instr)}</p>` : item.author && teamOf(item.author) ? `<p style="margin:0">✍️ المؤلف: ${personLink(item.author)}</p>` : ""}</section>`;

  // عناصر مرتبطة: نفس التقنية أولاً (من كل الأقسام)، ثم نفس القسم
  const score = (o) => itemTopics(o).filter((t) => topics.includes(t)).length;
  const related = all
    .filter((o) => !(o._sec === sec && o.id === item.id))
    .map((o) => [o, score(o) * 10 + (o._sec === sec ? 1 : 0)])
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([o]) => o);

  const body = `
${bc.html}
<section class="hero">
  <div>${cover}</div>
  <div>
    <h1>${esc(title)}</h1>
    ${item.shortDesc ? `<p class="lead">${esc(clean(item.shortDesc))}</p>` : ""}
    <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="price">${!free ? `<b>$${price}</b>` : `<b>مجاني</b>`}${!free && oldPrice && oldPrice > price ? `<s>$${oldPrice}</s><span class="off">وفّر ${off}%</span>` : ""}</div>
    <div class="cta">
      ${!free
        ? `<a class="btn main" href="/?open=${sec.col}:${item.id}">🛒 اطلب الآن</a>`
        : item.fileUrl
          ? `<a class="btn main" href="${esc(item.fileUrl)}" target="_blank" rel="nofollow noopener">📥 تحميل مجاني</a>`
          : `<a class="btn main" href="/?open=${sec.col}:${item.id}">📥 احصل عليه مجاناً</a>`}
      <a class="btn wa" href="https://wa.me/${WHATSAPP}?text=${waMsg}" rel="nofollow">💬 استفسار واتساب</a>
    </div>
    ${!free ? `<p class="trust">🔒 دفع آمن عبر بوابة Togo — بيانات بطاقتك لا تصل إلينا • ↩️ <a href="/privacy.html#refund">استرداد خلال 7 أيام</a> حسب السياسة</p>` : ""}
  </div>
</section>

${answerHtml}
${factsHtml}
${item.desc ? `<section class="box"><h2>📖 التفاصيل</h2><div class="prose">${md.render(item.desc)}</div></section>` : ""}
<div class="grid2">
  ${list("👥 لمن هذا؟", audience, "•")}
  ${list(learnTitle, item.learns)}
  ${list("🔧 المكونات المستخدمة", item.components, "•")}
  ${list("📝 المتطلبات المسبقة", item.requirements, "•")}
</div>
${list("📚 محاور الدورة", item.topics, "▸")}
${yt ? `<section class="box"><h2>🎬 فيديو ${esc(sec.one)}</h2><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div></section>` : ""}
${reviews.length ? `<section class="box"><h2>⭐ آراء الطلاب${rating ? ` <span style="font-size:.85rem;color:var(--mut)">(${rating.avg.toFixed(1)} من 5)</span>` : ""}</h2>${reviews.map((r) => { const st = Math.min(5, Math.max(1, Number(r.rating) || 5)); return `<blockquote class="rv"><div style="color:var(--acc)">${"★".repeat(st)}${"☆".repeat(5 - st)}</div><p>${esc(clean(r.text))}</p><footer>— <b>${esc(clean(r.name))}</b>${clean(r.role) ? "، " + esc(clean(r.role)) : ""}</footer></blockquote>`; }).join("")}</section>` : ""}
${faqs.length ? `<section class="box faq"><h2>❓ أسئلة عن ${esc(sec.one)}</h2>${faqs.map((f) => `<details><summary>${esc(clean(f.q))}</summary><p>${esc(clean(f.a))}</p></details>`).join("")}</section>` : ""}
${license}

<section class="box"><h2>👷 عن ${BRAND}</h2><p>${BRAND} (${BRAND_AR}) منصة عربية من فلسطين يديرها مهندسون كهربائيون ومدربون جامعيون، تقدّم دورات ومشاريع جاهزة وكتباً في الهندسة الكهربائية والأنظمة المدمجة وإنترنت الأشياء. <a href="/#about" style="color:var(--acc)">تعرّف على الفريق</a> • <a href="/#faq" style="color:var(--acc)">الأسئلة الشائعة</a> • <a href="/privacy.html#refund" style="color:var(--acc)">سياسة الإرجاع</a></p></section>

${related.length ? `<h2 class="sec-title">🔗 قد يهمك أيضاً</h2><div class="cards">${related.map((r) => card(r._sec, r)).join("")}</div>` : ""}
`;

  return layout({
    title: `${cut(title, 55)} | ${BRAND}`,
    description: metaDescription(sec, item),
    canonical,
    image: imgAbs,
    ogType: "product",
    schemas,
    body,
    itemId: item.id,
  });
}

function card(sec, it, showType = false) {
  const img = it._thumb || it.imageUrl || it.coverUrl || it.image;
  const price = num(it.price) ?? 0;
  const h = it._w && it._h ? Math.round((480 * it._h) / it._w) : 225;
  return `<a class="card" href="/${sec.dir}/${it._slug}/">${img
    ? `<img src="${esc(img)}" alt="${esc(clean(it.title))}" loading="lazy" decoding="async" width="480" height="${h}">`
    : `<div class="ph">${it.emoji || sec.emoji}</div>`}<div class="b">${showType ? `<div class="k">${sec.emoji} ${esc(sec.one)}</div>` : ""}<h3>${esc(cut(it.title, 70))}</h3>${sec.type === "Article"
      ? `<div class="k">${articleDate(it) ? "📅 " + articleDate(it) + " • " : ""}⏱ ${md.readingMinutes(it.body)} دقائق قراءة</div>`
      : `<div class="p">${price > 0 && !isFree(it) ? "$" + price : "مجاني"}</div>`}</div></a>`;
}

// ---------------- صفحة المقال ----------------
function articleDate(it) {
  const d = isoDate(it.publishedAt || it.createdAt);
  return d ? d.slice(0, 10) : "";
}
function articlePage(sec, item, all) {
  const title = clean(item.title);
  const url = `/${sec.dir}/${item._slug}/`;
  const canonical = SITE + url;
  const text = md.plain(item.body);
  const desc = cut(item.desc || text || title, 155);
  const img = item._img || item.imageUrl || "";
  const imgAbs = absUrl(img) || OG_DEFAULT;
  const published = isoDate(item.publishedAt || item.createdAt);
  const updated = isoDate(item._updated) || published;
  const topics = itemTopics(item);
  const faqs = (Array.isArray(item.faqs) ? item.faqs : []).filter((f) => f && clean(f.q) && clean(f.a));
  const author = clean(item.author);
  const minutes = md.readingMinutes(item.body);
  const yt = youtubeId(item.videoUrl);

  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: sec.label, url: `/${sec.dir}/` }, { name: cut(title, 60), url }]);
  const schemas = [{
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: cut(title, 110),
    description: desc,
    image: imgAbs,
    url: canonical,
    mainEntityOfPage: canonical,
    inLanguage: "ar",
    articleSection: sec.label,
    wordCount: text.split(" ").filter(Boolean).length,
    ...(published ? { datePublished: published } : {}),
    ...(updated ? { dateModified: updated } : {}),
    author: author ? personLd(author) : ORG,
    publisher: ORG,
    ...(topics.length || arr(item.tags).length ? { keywords: [...new Set([...topics.map((t) => t.ar), ...arr(item.tags).map(clean)])].join("، ") } : {}),
  }];
  if (faqs.length) schemas.push({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: clean(f.q), acceptedAnswer: { "@type": "Answer", text: clean(f.a) } })),
  });
  schemas.push(bc.schema);

  const score = (o) => itemTopics(o).filter((t) => topics.includes(t)).length;
  const related = all
    .filter((o) => o !== item)
    .map((o) => [o, score(o) * 10 + (o._sec === sec ? 1 : 0)])
    .filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([o]) => o);

  const body = `
${bc.html}
<article class="article">
  <h1>${esc(title)}</h1>
  <div class="meta">${author ? `<span>✍️ ${personLink(author)}</span>` : `<span>✍️ فريق ${BRAND}</span>`}${published ? `<span>📅 ${published.slice(0, 10)}</span>` : ""}<span>⏱ ${minutes} دقائق قراءة</span></div>
  ${topics.length ? `<div class="chips" style="margin-bottom:16px">${topics.map((t) => `<a class="chip" href="/topics/${t.slug}/">${esc(t.ar)}</a>`).join("")}</div>` : ""}
  ${img ? `<img class="cover" src="${esc(img)}" alt="${esc(title)}" width="${item._w || 1200}" height="${item._h || 675}" fetchpriority="high" decoding="async">` : ""}
  ${item.desc ? `<p class="lead">${esc(clean(item.desc))}</p>` : ""}
  <div class="prose">${md.render(item.body)}</div>
  ${yt ? `<section class="box" style="margin-top:20px"><h2>🎬 فيديو</h2><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div></section>` : ""}
  ${faqs.length ? `<section class="box faq" style="margin-top:20px"><h2>❓ أسئلة شائعة</h2>${faqs.map((f) => `<details><summary>${esc(clean(f.q))}</summary><p>${esc(clean(f.a))}</p></details>`).join("")}</section>` : ""}
  <section class="box" style="margin-top:20px"><h2>👷 عن ${BRAND}</h2><p>${BRAND} (${BRAND_AR}) منصة عربية من فلسطين يديرها مهندسون كهربائيون ومدربون جامعيون، تقدّم دورات ومشاريع جاهزة وكتباً ومقالات في الهندسة الكهربائية والأنظمة المدمجة وإنترنت الأشياء. <a href="/#about" style="color:var(--acc)">تعرّف على الفريق</a> • <a href="/courses/" style="color:var(--acc)">الدورات</a> • <a href="/projects/" style="color:var(--acc)">المشاريع</a></p></section>
</article>
${related.length ? `<h2 class="sec-title">🔗 قد يهمك أيضاً</h2><div class="cards">${related.map((r) => card(r._sec, r, r._sec !== sec)).join("")}</div>` : ""}
`;
  return layout({ title: `${cut(title, 55)} | ${BRAND}`, description: metaDescription(sec, item), canonical, image: imgAbs, ogType: "article", schemas, body, itemId: item.id });
}

// ---------------- صفحات الفريق /team/ ----------------
function teamWorks(m, all) {
  return all.filter((it) => [instructorOf(it), it.author].some((x) => x && teamOf(x) === m));
}
function teamPage(m, photo, works) {
  const url = `/team/${m.slug}/`;
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "فريق 3ENG.s", url: "/team/" }, { name: m.name, url }]);
  const person = {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${SITE}${url}#person`,
    name: m.en,
    alternateName: m.name.replace(/^م\.\s*/, ""),
    url: SITE + url,
    jobTitle: m.jobTitle,
    description: m.bio.join(" "),
    worksFor: { "@id": ORG_ID },
    ...(m.alumniOf ? { alumniOf: { "@type": "CollegeOrUniversity", name: m.alumniOf } } : {}),
    knowsAbout: m.knows,
    knowsLanguage: ["ar", "en"],
    ...(photo ? { image: SITE + photo } : {}),
    ...(m.sameAs.length ? { sameAs: m.sameAs } : {}),
  };
  const profile = { "@context": "https://schema.org", "@type": "ProfilePage", url: SITE + url, mainEntity: { "@id": person["@id"] } };
  const topicLinks = m.knows.map((k) => { const t = topicOf(k); return t ? `<a class="chip" href="/topics/${t.slug}/">${esc(t.ar)}</a>` : `<span class="chip">${esc(k)}</span>`; });
  const body = `${bc.html}
<section class="person">
  <div class="av">${photo ? `<img src="${photo}" alt="${esc(m.name)}" width="140" height="140">` : esc(m.name.replace(/^م\.\s*/, "")[0])}</div>
  <div><h1>${esc(m.name)}</h1><div class="role">${esc(m.role)}</div><p class="lead" style="margin-top:8px">فريق ${BRAND} — ${BRAND_AR}</p></div>
</section>
<section class="box"><h2>👤 نبذة</h2>${m.bio.map((p) => `<p>${esc(p)}</p>`).join("")}${m.alumniAr ? `<p>🎓 ${esc(m.alumniAr)}</p>` : ""}</section>
<section class="box"><h2>🧠 مجالات الخبرة</h2><div class="chips">${topicLinks.join("")}</div></section>
${m.sameAs.length ? `<section class="box"><h2>🔗 روابط</h2><p>${m.sameAs.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener me" style="color:var(--acc)">${esc(u.replace(/^https?:\/\/(www\.)?/, ""))}</a>`).join(" • ")}</p></section>` : ""}
${works.length ? `<h2 class="sec-title">📚 محتوى ${esc(m.name)}</h2><div class="cards">${works.map((w) => card(w._sec, w, true)).join("")}</div>` : ""}`;
  return layout({
    title: `${m.name} — ${m.role.split("•")[0].trim()} | ${BRAND}`,
    description: cut(`${m.name}: ${m.bio.join(" ")}`, 155),
    canonical: SITE + url,
    image: photo ? SITE + photo : "",
    ogType: "profile",
    schemas: [person, profile, bc.schema],
    body,
  });
}
function teamHub(list) {
  const url = "/team/";
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "فريق 3ENG.s", url }]);
  const body = `${bc.html}
<h1>👷 فريق ${BRAND} — ${BRAND_AR}</h1>
<p class="lead">مهندسون كهربائيون ومدرّبون من فلسطين، يقدّمون الدورات والمشاريع والكتب على منصة ${BRAND}.</p>
<div class="cards">${list.map(([m, photo]) => `<a class="card" href="/team/${m.slug}/">${photo ? `<img src="${photo}" alt="${esc(m.name)}" loading="lazy" width="480" height="480">` : `<div class="ph">${esc(m.name.replace(/^م\.\s*/, "")[0])}</div>`}<div class="b"><h3>${esc(m.name)}</h3><div class="k">${esc(m.role)}</div></div></a>`).join("")}</div>`;
  return layout({
    title: `فريق ${BRAND} | ${BRAND_AR}`,
    description: `تعرّف على فريق ${BRAND}: ${TEAM.map((m) => m.name).join("، ")} — مهندسون كهربائيون ومدرّبون من فلسطين.`,
    canonical: SITE + url,
    schemas: [bc.schema],
    body,
  });
}

// ---------------- الحاسبات /tools/ ----------------
// المعادلات والقيم اللاتينية داخل النص العربي ← <bdi> عشان ترتيبها ما يخرب (بدون لمس الوسوم والـ entities)
const LTR_RUN = /[A-Za-z0-9(Ͱ-Ͽ√⌊][A-Za-z0-9 ()+−×÷=/.,²³√·^_≈≤≥%Ωµ∥⌊⌋⅓Ͱ-Ͽ-]*[A-Za-z0-9)²³%Ωµ⌋Ͱ-Ͽ]|[A-Za-z0-9Ωµ]/g;
const ltr = (html) => String(html).split(/(<[^>]+>|&[a-z#0-9]+;)/).map((p, i) => (i % 2 ? p : p.replace(LTR_RUN, (m) => (/[A-Za-zͰ-Ͽ√]/.test(m) && /[=+×÷−/^]/.test(m) ? `<bdi dir="ltr">${m}</bdi>` : m)))).join("");
const TOOLS_DISCLAIMER = `<p class="warn">⚠️ النتائج للتعلّم والتقدير المبدئي. التمديدات الكهربائية والمنظومات الحقيقية لازم يصممها أو يراجعها مهندس كهربائي مرخّص حسب الكود المحلي.</p>`;
function toolPage(t, all) {
  const url = `/tools/${t.slug}/`;
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "الحاسبات الهندسية", url: "/tools/" }, { name: t.name, url }]);
  const app = {
    "@context": "https://schema.org", "@type": "WebApplication", name: t.title, url: SITE + url, description: t.desc,
    applicationCategory: "EducationalApplication", operatingSystem: "Any", inLanguage: "ar", isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, publisher: { "@id": ORG_ID },
  };
  const faq = { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: t.faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
  const related = all.filter((it) => itemTopics(it).some((x) => t.topics.includes(x.slug))).slice(0, 4);
  const siblings = TOOLS.filter((x) => x.slug !== t.slug);
  const body = `${bc.html}
<h1>${esc(t.emoji)} ${esc(t.title)}</h1>
<section class="box answer"><h2>✅ باختصار</h2><p>${ltr(t.answer)}</p></section>
<section class="box calc" data-tool="${t.slug}"><h2>🧮 الحاسبة</h2>${t.form}<div class="out" aria-live="polite"></div></section>
${t.warn ? TOOLS_DISCLAIMER : ""}
<section class="box"><h2>📐 طريقة الحساب</h2>${ltr(t.how)}</section>
<section class="box"><h2>📝 مثال</h2><p>${ltr(t.example)}</p></section>
<section class="box faq"><h2>❓ أسئلة شائعة</h2>${t.faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${ltr(esc(a))}</p></details>`).join("")}</section>
${related.length ? `<h2 class="sec-title">📚 تعلّم أكثر</h2><div class="cards">${related.map((w) => card(w._sec, w, true)).join("")}</div>` : ""}
<h2 class="sec-title">🧮 حاسبات أخرى</h2>
<div class="tlinks">${siblings.map((x) => `<a href="/tools/${x.slug}/">${esc(x.emoji)} ${esc(x.name)}</a>`).join("")}</div>
<script src="/assets/tools.js?v=4" defer></script>
<script type="module" src="/assets/tools-pro.js?v=2"></script>`;
  return layout({ title: `${t.title} | ${BRAND}`, description: t.desc, canonical: SITE + url, schemas: [app, faq, bc.schema], body });
}
function toolsHub() {
  const url = "/tools/";
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "الحاسبات الهندسية", url }]);
  const list = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: TOOLS.map((t, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/tools/${t.slug}/`, name: t.title })) };
  const body = `${bc.html}
<h1>🧮 الحاسبات الهندسية — ${BRAND}</h1>
<p class="lead">${TOOLS.length} حاسبة كهربائية وإلكترونية مجانية بالعربي — أساسيات الإلكترونيات، التمديدات والقدرة، الطاقة الشمسية، والأنظمة المدمجة — كل وحدة مع شرح المعادلات وأمثلة عملية.</p>
${TOOL_CATS.map((c) => { const ts = TOOLS.filter((t) => t.cat === c.id); return ts.length ? `<h2 class="sec-title">${c.emoji} ${esc(c.label)}</h2><div class="cards">${ts.map((t) => `<a class="card" href="/tools/${t.slug}/"><div class="ph">${esc(t.emoji)}</div><div class="b"><h3>${esc(t.title)}</h3><div class="k">${esc(cut(t.desc, 90))}</div></div></a>`).join("")}</div>` : ""; }).join("")}`;
  return layout({
    title: `الحاسبات الهندسية والكهربائية بالعربي | ${BRAND}`,
    description: cut(`${TOOLS.length} حاسبة كهربائية مجانية بالعربي من ${BRAND}: قانون أوم، مقاومة LED، مقسّم الجهد، 555، مقطع السلك، ثلاثي الطور، الطاقة الشمسية، ADC و PWM.`, 155),
    canonical: SITE + url, schemas: [list, bc.schema], body,
  });
}

// ---------------- صفحة من نحن /about/ — الهوية، الفريق، الدفع والاسترداد، التواصل ----------------
function aboutPage(list, counts) {
  const url = "/about/";
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "من نحن", url }]);
  const about = { "@context": "https://schema.org", "@type": "AboutPage", url: SITE + url, name: `من نحن — ${BRAND}`, mainEntity: { "@id": ORG_ID } };
  const org = { "@context": "https://schema.org", ...ORG, email: "info@3engs.com", telephone: "+" + WHATSAPP, areaServed: "Arab World",
    founder: { "@id": `${SITE}/team/${TEAM.find((m) => m.founder)?.slug}/#person` },
    employee: TEAM.map((m) => ({ "@id": `${SITE}/team/${m.slug}/#person` })) };
  const stat = (n, l) => (n ? `<div class="box" style="text-align:center;margin:0"><b style="font-size:1.6rem;color:var(--acc)">${n}</b><div style="color:var(--mut);font-size:.85rem">${l}</div></div>` : "");
  const body = `${bc.html}
<h1>من نحن — ${BRAND} (${BRAND_AR})</h1>
<p class="lead">مهندسون كهربائيون من فلسطين نعلّم الهندسة بطريقة عملية.</p>
<section class="box"><h2>🎯 قصتنا</h2>
<p>بدأت ${BRAND} كمبادرة تعليمية هدفها نقل الخبرة العملية في الهندسة الكهربائية والأنظمة المدمجة للطلاب والمهتمين في العالم العربي.</p>
<p>نقدّم دورات تدريبية، مشاريع جاهزة، وكتباً هندسية مبسطة في مجالات ESP32 و Arduino و PIC وإنترنت الأشياء والذكاء الاصطناعي، وكل محتوانا مبني على تجربة حقيقية في التدريس الجامعي والمشاريع العملية.</p>
</section>
<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0">
${stat(counts.courses, "دورة تعليمية")}${stat(counts.projects, "مشروع هندسي")}${stat(counts.products, "منتج رقمي")}${stat(counts.books, "كتاب هندسي")}${stat(TEAM.length, "مهندسين في الفريق")}
</div>
<h2 class="sec-title">👷 الفريق</h2>
<div class="cards">${list.map(([m, photo]) => `<a class="card" href="/team/${m.slug}/">${photo ? `<img src="${photo}" alt="${esc(m.name)}" loading="lazy" width="480" height="480">` : `<div class="ph">${esc(m.name.replace(/^م\.\s*/, "")[0])}</div>`}<div class="b"><h3>${esc(m.name)}</h3><div class="k">${esc(m.role)}</div></div></a>`).join("")}</div>
<section class="box"><h2>🔒 الشراء والدفع</h2>
<ul>
<li>الدفع الإلكتروني بالبطاقة يتم عبر بوابة الدفع <b>Togo</b> على صفحتها الآمنة — بيانات بطاقتك لا تصل إلينا ولا نخزّنها.</li>
<li>تأكيد الدفع يتم آلياً من بوابة الدفع نفسها، وبعدها تظهر مشترياتك فوراً في صفحة <b>"📦 مشترياتي"</b> بحسابك على الموقع.</li>
<li>يمكن أيضاً الشراء بالتواصل معنا مباشرة عبر <a href="https://wa.me/${WHATSAPP}" rel="nofollow" style="color:var(--acc)">واتساب</a> أو PayPal.</li>
<li>↩️ يحق لك طلب الاسترداد خلال <b>7 أيام</b> من تاريخ الشراء في الحالات المذكورة في <a href="/privacy.html#refund" style="color:var(--acc)">سياسة الإرجاع والاسترداد</a>.</li>
</ul>
</section>
<section class="box"><h2>📞 تواصل معنا</h2>
<ul>
<li>📧 البريد: <a href="mailto:info@3engs.com" style="color:var(--acc)">info@3engs.com</a></li>
<li>💬 واتساب: <a href="https://wa.me/${WHATSAPP}" rel="nofollow" style="color:var(--acc)" dir="ltr">+${WHATSAPP}</a></li>
<li>🌐 حساباتنا: ${ORG.sameAs.map((u) => `<a href="${u}" target="_blank" rel="noopener me" style="color:var(--acc)">${esc(u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`).join(" • ")}</li>
<li>📄 <a href="/privacy.html" style="color:var(--acc)">سياسة الخصوصية</a> • <a href="/privacy.html#terms" style="color:var(--acc)">شروط الاستخدام</a></li>
</ul>
</section>`;
  return layout({
    title: `من نحن | ${BRAND} — ${BRAND_AR}`,
    description: cut(`${BRAND} (${BRAND_AR}): منصة تعليمية لمهندسين كهربائيين من فلسطين — دورات ومشاريع وكتب في ESP32 و Arduino وإنترنت الأشياء. تعرّف على الفريق وطرق الدفع الآمن وسياسة الاسترداد.`, 155),
    canonical: SITE + url,
    schemas: [about, org, bc.schema],
    body,
  });
}

// ---------------- صفحات التصنيف /topics/ ----------------
function topicPage(t, items) {
  const url = `/topics/${t.slug}/`;
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "التصنيفات", url: "/topics/" }, { name: t.ar, url }]);
  const listSchema = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${t.ar} — ${BRAND}`,
    url: SITE + url,
    about: t.ar,
    mainEntity: { "@type": "ItemList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/${it._sec.dir}/${it._slug}/`, name: clean(it.title) })) },
  };
  const groups = [...new Map(items.map((i) => [i._sec.key, i._sec])).values()].map((sec) => [sec, items.filter((i) => i._sec.key === sec.key)]);
  const body = `${bc.html}
<h1>${esc(t.ar)}: دورات ومشاريع وكتب</h1>
<p class="lead">${esc(t.about)} على منصة ${BRAND} تجد ${items.length} ${items.length > 2 && items.length < 11 ? "عناصر" : "عنصراً"} في هذا المجال باللغة العربية.</p>
${groups.map(([sec, g]) => `<h2 class="sec-title">${sec.emoji} ${esc(sec.label)}</h2><div class="cards">${g.map((it) => card(sec, it)).join("")}</div>`).join("\n")}`;
  return layout({
    title: `${t.ar} | دورات ومشاريع وكتب — ${BRAND}`,
    description: cut(`${t.about} تصفّح ${items.map((i) => clean(i.title)).slice(0, 3).join("، ")} على ${BRAND}.`, 155),
    canonical: SITE + url,
    schemas: [listSchema, bc.schema],
    body,
  });
}
function topicsHub(list) {
  const url = "/topics/";
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: "التصنيفات", url }]);
  const body = `${bc.html}
<h1>🏷️ تصفّح حسب التقنية والمجال</h1>
<p class="lead">كل محتوى ${BRAND} مصنّف حسب التقنية (Arduino، ESP32، Raspberry Pi…) والمجال (إنترنت الأشياء، الأنظمة المدمجة، الذكاء الاصطناعي…).</p>
<div class="cards">${list.map(([t, items]) => `<a class="card" href="/topics/${t.slug}/"><div class="b"><h3>${esc(t.ar)}</h3><div class="k">${items.length} عنصر</div></div></a>`).join("")}</div>`;
  return layout({
    title: `التصنيفات | ${BRAND} ${BRAND_AR}`,
    description: `تصفّح دورات ومشاريع وكتب ${BRAND} حسب التقنية والمجال: ${list.map(([t]) => t.ar).slice(0, 6).join("، ")}.`,
    canonical: SITE + url,
    schemas: [bc.schema],
    body,
  });
}

function redirectPage(to, id = "") {
  return `<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><title>تم نقل الصفحة</title>${id ? `<meta name="3engs-id" content="${esc(id)}">` : ""}
<link rel="canonical" href="${to}"><meta name="robots" content="noindex, follow">
<meta http-equiv="refresh" content="0; url=${to}"><script>location.replace(${JSON.stringify(to)})</script></head>
<body><a href="${to}">${to}</a></body></html>`;
}

// ---------------- الصفحة الرئيسية: محتوى ثابت بين علامات SSR ----------------
function ssrReplace(html, key, content) {
  const re = new RegExp(`(<!--SSR:${key}-->)[\\s\\S]*?(<!--/SSR:${key}-->)`);
  return re.test(html) ? html.replace(re, (_, a, b) => a + content + b) : html;
}
function ssrItems(sec, items) {
  if (!items.length) return `<div class="loading-ph">لا توجد عناصر حالياً — قريباً!</div>`;
  return `<div class="ssr-list">${items.map((it) => {
    const price = num(it.price) ?? 0;
    return `<a href="/${sec.dir}/${it._slug}/">${esc(cut(it.title, 70))}<b>${sec.type === "Article" ? "📝" : price > 0 && !isFree(it) ? "$" + price : "مجاني"}</b></a>`;
  }).join("")}</div>`;
}
function ssrTestimonials(list) {
  list = (list || []).filter((t) => clean(t.text) && clean(t.name));
  if (!list.length) return `<div class="loading-ph">كن أول من يشاركنا رأيه!</div>`;
  return list.slice(0, 9).map((t) => {
    const r = Math.min(5, Math.max(1, Number(t.rating) || 5));
    return `<div class="tcard"><div class="tstars">${"★".repeat(r)}${"☆".repeat(5 - r)}</div><div class="ttext">${esc(clean(t.text))}</div><div class="tauthor"><div class="tav">${esc(clean(t.name)[0])}</div><div><div class="taname">${esc(clean(t.name))}</div><div class="tarole">${esc(clean(t.role))}</div></div></div></div>`;
  }).join("");
}
async function updateHome(data) {
  const full = path.join(OUT_DIR, "index.html");
  let html;
  try { html = await fs.readFile(full, "utf8"); } catch { return false; }
  for (const sec of SECTIONS) {
    html = ssrReplace(html, sec.col, ssrItems(sec, data[sec.col] || []));
    html = ssrReplace(html, "count-" + sec.col, String((data[sec.col] || []).length));
  }
  html = ssrReplace(html, "testimonials", ssrTestimonials(data.testimonials));
  html = ssrReplace(html, "custom", data.groups.filter((g) => g.sec.custom && g.items.length).map(({ sec, items }) =>
    `<section class="csec"><div class="shdr"><div><div class="stag">${esc(sec.emoji)} ${esc(sec.tagline || "")}</div><h2 class="stitle">${esc(sec.label)}</h2></div></div>${ssrItems(sec, items.slice(0, 4))}<div class="more-wrap"><a class="more-btn" href="/${sec.dir}/">اكتشف المزيد ←</a></div></section>`).join(""));
  const hero = data.config?.hero || {};
  for (const i of [1, 2, 3, 4]) {
    const auto = { 1: String((data.products || []).length), 2: String((data.courses || []).length) }[i];
    const v = clean(hero["stat" + i]?.num) || auto;
    if (v) html = ssrReplace(html, `s${i}n`, esc(v));
  }
  return writeFile("index.html", html);
}

// ---------------- صفحة فهرس القسم ----------------
function hubPage(sec, items) {
  const url = `/${sec.dir}/`;
  const bc = crumbs([{ name: "الرئيسية", url: "/" }, { name: sec.label, url }]);
  const listSchema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${sec.label} — ${BRAND}`,
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE}/${sec.dir}/${it._slug}/`, name: clean(it.title) })),
  };
  const body = `${bc.html}
<h1>${sec.emoji} ${esc(sec.label)}</h1>
<p class="lead">${sec.custom && sec.tagline ? esc(sec.tagline) : `كل ${esc(sec.label)} المتوفرة على منصة ${BRAND} في الهندسة الكهربائية، ESP32، Arduino، إنترنت الأشياء والذكاء الاصطناعي.`}</p>
<div class="cards">${items.map((it) => card(sec, it)).join("")}</div>`;
  return layout({
    title: `${sec.label} | ${BRAND} ${BRAND_AR}`,
    description: cut(`${sec.custom && sec.tagline ? clean(sec.tagline) + " — " : `تصفح ${sec.label} على منصة ${BRAND}: `}${items.slice(0, 4).map((i) => clean(i.title)).join("، ")}`, 155),
    canonical: SITE + url,
    schemas: [listSchema, bc.schema],
    body,
  });
}

// ---------------- sitemap + llms.txt ----------------
function sitemap(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries.map((e) => `  <url>
    <loc>${esc(SITE + e.loc)}</loc>${e.lastmod ? `\n    <lastmod>${e.lastmod.slice(0, 10)}</lastmod>` : ""}
    <priority>${e.priority.toFixed(1)}</priority>${e.image ? `
    <image:image><image:loc>${esc(e.image)}</image:loc><image:title>${esc(e.title || "")}</image:title></image:image>` : ""}
  </url>`).join("\n")}
</urlset>
`;
}

function llms(data) {
  let t = `# ${BRAND} — ${BRAND_AR}

> منصة عربية من فلسطين لتعليم الهندسة الكهربائية والأنظمة المدمجة وإنترنت الأشياء (IoT) والذكاء الاصطناعي. تقدم دورات تدريبية، كتب هندسية، ومشاريع ESP32 و Arduino و PIC جاهزة مع الكود الكامل ومخططات التوصيل. يديرها مهندسون كهربائيون ومدربون جامعيون.

- الموقع: ${SITE}
- البريد: info@3engs.com
- واتساب: +${WHATSAPP}
- إنستغرام: https://www.instagram.com/3eng.s
- تيك توك: https://www.tiktok.com/@3eng.s
- فيسبوك: https://www.facebook.com/profile.php?id=61584936014304
- Linktree: https://linktr.ee/3eng.s
- سياسة الخصوصية والإرجاع: ${SITE}/privacy.html

## الفريق (${SITE}/team/)
- م. حسام زقوت (${SITE}/team/hosam-zaqout/) — مهندس كهربائي، مؤسس ومدرّب. بكالوريوس هندسة كهربائية من الجامعة الإسلامية بغزة، مساعد تدريس وبحث ومحاضر زائر في إنترنت الأشياء والحساسات. متخصص في الأنظمة المدمجة وتصميم PCB والعتاد المدمج بالذكاء الاصطناعي.
- م. إسراء الطويل (${SITE}/team/israa-altaweel/) — مهندسة أنظمة مدمجة ومدرّبة، متخصصة في إنترنت الأشياء والأنظمة المدمجة، درّبت أكثر من 300 طالب.
- م. فرات الطويل (${SITE}/team/furat-altaweel/) — مهندسة أنظمة ذكية مهتمة بتطوير المنتجات وبتعليم الأطفال علوم الإلكترونيات واللغات، ولديها خبرة كبيرة في إعداد السيرة الذاتية وتدريب الطلاب على اجتياز المقابلات والتقدّم للمنح الدراسية.

## أسئلة شائعة
- هل الدورات مناسبة للمبتدئين؟ نعم، معظمها يبدأ من الأساسيات، ومستوى كل دورة مكتوب في صفحتها.
- هل الدورات أونلاين أم مسجّلة؟ نقدم دورات أونلاين مباشرة ودورات مسجّلة، وطريقة تقديم كل دورة ومدتها وعدد دروسها موضحة في صفحتها.
- هل أحصل على شهادة بعد إتمام الدورة؟ نعم، يحصل كل متدرب يُنجز الدورة على شهادة معتمدة من 3ENG.s.
- هل يوجد محتوى مجاني؟ نعم، بعض الكتب والمشاريع والأدوات مجانية ويمكن تحميلها مباشرة بدون تسجيل.
- هل تساعدون في مشاريع التخرج؟ نعم، المشاريع الجاهزة مناسبة لمشاريع التخرج، ويمكن طلب تنفيذ أو تعديل مشروع.
- كيف أتواصل؟ واتساب +${WHATSAPP} أو info@3engs.com.
`;
  for (const sec of SECTIONS) {
    const items = data[sec.col] || [];
    if (!items.length) continue;
    t += `\n## ${sec.label}\n`;
    for (const it of items) {
      const price = num(it.price) ?? 0;
      const tp = itemTopics(it).map((x) => x.ar);
      t += `- [${clean(it.title)}](${SITE}/${sec.dir}/${it._slug}/): ${cut(it.shortDesc || it.desc || "", 140)} (${price > 0 && !isFree(it) ? "$" + price : "مجاني"}${tp.length ? " — " + tp.join("، ") : ""})\n`;
    }
  }
  for (const { sec, items } of data.groups.filter((g) => g.sec.custom && g.items.length)) {
    t += `\n## ${sec.label}${sec.tagline ? " — " + clean(sec.tagline) : ""}\n`;
    for (const it of items) {
      const summary = cut(it.desc || md.plain(it.body), 160);
      t += `- [${clean(it.title)}](${SITE}/${sec.dir}/${it._slug}/): ${summary}\n`;
    }
  }
  return t;
}

// ---------------- IndexNow (Bing / Yandex) ----------------
async function indexNow(urls) {
  const key = (process.env.INDEXNOW_KEY || "").trim(); // trim: سطر فارغ في الـ secret كان يولّد ملف باسم خاطئ
  if (!key || !urls.length) return;
  await fs.writeFile(path.join(OUT_DIR, `${key}.txt`), key);
  try {
    const r = await fetch("https://api.indexnow.org/indexnow", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${key}.txt`, urlList: urls.slice(0, 10000) }),
    });
    console.log(`📡 IndexNow: ${r.status} (${urls.length} رابط)`);
  } catch (e) {
    console.warn("⚠️  IndexNow فشل:", e.message);
  }
}

// ---------------- التشغيل ----------------
async function writeFile(rel, content) {
  const full = path.join(OUT_DIR, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  let old = null;
  try { old = await fs.readFile(full, "utf8"); } catch {}
  if (old !== content) await fs.writeFile(full, content);
  return old !== content;
}

async function main() {
  console.log("🔄 جاري قراءة البيانات…");
  const data = await loadData();
  REVIEWS = data.testimonials || [];
  const entries = [{ loc: "/", priority: 1.0, lastmod: new Date().toISOString(), image: OG_DEFAULT, title: BRAND }];
  const changed = [];
  let total = 0;

  // 1) المجموعات: الأقسام الأساسية + الأقسام المخصصة المفعّلة
  const groups = SECTIONS.map((sec) => ({ sec: { ...sec, key: sec.col }, items: data[sec.col] || [] }));
  const secSeen = new Set();
  const customSecs = (data.custom_sections || []).filter((c) => c.active !== false && clean(c.name))
    .sort((a, b) => (Number(a.order) || 1) - (Number(b.order) || 1));
  for (const c of customSecs) {
    let slug = slugify({ slug: c.slug, title: c.name, id: c.id });
    while (secSeen.has(slug)) slug += "-" + c.id.slice(0, 4).toLowerCase();
    secSeen.add(slug);
    const articles = c.type === "articles";
    const sec = {
      key: "cs:" + c.id, col: "section_items", dir: `sections/${slug}`, custom: true,
      label: clean(c.name), tagline: clean(c.tagline), emoji: c.emoji || (articles ? "📝" : "•"),
      one: articles ? "مقال" : "عنصر", type: articles ? "Article" : "Product", anchor: `#custom-${c.id}`,
    };
    let items = (data.section_items || []).filter((i) => i.sectionId === c.id);
    if (articles) items = items.filter((i) => clean(i.body) || clean(i.desc))
      .sort((a, b) => (isoDate(b.publishedAt || b.createdAt) || "").localeCompare(isoDate(a.publishedAt || a.createdAt) || ""));
    groups.push({ sec, items });
  }
  data.groups = groups;

  const redirectsBy = {}, seenBy = {}, all = [];
  for (const g of groups) {
    const { sec } = g;
    // INCLUDE_DRAFTS=1 ← معاينة محلية للمسودات (ما بتستخدم بالنشر)
    g.items = g.items.filter((i) => clean(i.title) && (process.env.INCLUDE_DRAFTS || (i.hidden !== true && i.published !== false)));
    const seen = new Set();
    const redirects = [];
    for (const it of g.items) {
      it._updated ??= it.updatedAt;
      it._sec = sec;
      let sl = slugify(it);
      while (seen.has(sl)) sl += "-" + it.id.slice(0, 4).toLowerCase();
      seen.add(sl);
      it._slug = sl;
      // غيّرت الرابط من لوحة التحكم؟ الرابط القديم يحوّل للجديد بدل ما يعطي 404
      const old = autoSlug(it);
      if (old !== sl) redirects.push([old, sl, it.id]);
    }
    for (const [old] of redirects) seen.add(old);
    if (!sec.custom) data[sec.col] = g.items;
    redirectsBy[sec.key] = redirects;
    seenBy[sec.key] = seen;
    all.push(...g.items);
  }

  // 2) ضغط الصور
  await optimizeImages(data);

  // 3) الصفحات
  // أقسام مخصصة انحذفت أو تعطّلت ← نحذف مجلداتها
  try {
    const keepSecs = new Set(groups.filter((g) => g.sec.custom).map((g) => g.sec.dir.split("/")[1]));
    for (const d of await fs.readdir(path.join(OUT_DIR, "sections"), { withFileTypes: true }))
      if (d.isDirectory() && !keepSecs.has(d.name)) await fs.rm(path.join(OUT_DIR, "sections", d.name), { recursive: true });
  } catch {}

  for (const { sec, items } of groups) {
    if (!items.length) continue;

    // روابط قديمة: إذا المجلد لعنصر لسا موجود (تغيّر رابطه) ← تحويل للرابط الجديد، وإلا ← حذف
    const dir = path.join(OUT_DIR, sec.dir);
    const byId = new Map(items.map((it) => [it.id, it]));
    try {
      for (const d of await fs.readdir(dir, { withFileTypes: true })) {
        if (!d.isDirectory() || seenBy[sec.key].has(d.name)) continue;
        let html = "";
        try { html = await fs.readFile(path.join(dir, d.name, "index.html"), "utf8"); } catch {}
        const id = (html.match(/name="3engs-id" content="([^"]+)"/) || html.match(/"sku":"([^"]+)"/) || html.match(/[?&]open=[a-z_]+:([A-Za-z0-9_-]+)/) || [])[1];
        const redirSlug = (html.match(/http-equiv="refresh" content="0; url=[^"]*\/([^/"]+)\/"/) || [])[1];
        const target = (id && byId.get(id)) || (redirSlug && items.find((x) => x._slug === redirSlug));
        if (target) {
          await writeFile(`${sec.dir}/${d.name}/index.html`, redirectPage(`${SITE}/${sec.dir}/${target._slug}/`, target.id));
          console.log(`↪️  ${sec.dir}/${d.name}/ → ${target._slug}/`);
        } else {
          await fs.rm(path.join(dir, d.name), { recursive: true });
        }
      }
    } catch {}

    if (await writeFile(`${sec.dir}/index.html`, hubPage(sec, items))) changed.push(`${SITE}/${sec.dir}/`);
    entries.push({ loc: `/${sec.dir}/`, priority: sec.custom ? 0.8 : 0.9 });

    for (const [old, to, id] of redirectsBy[sec.key]) await writeFile(`${sec.dir}/${old}/index.html`, redirectPage(`${SITE}/${sec.dir}/${to}/`, id));

    for (const it of items) {
      const rel = `${sec.dir}/${it._slug}/index.html`;
      const page = sec.type === "Article" ? articlePage(sec, it, all) : itemPage(sec, it, items, all);
      if (await writeFile(rel, page)) changed.push(`${SITE}/${sec.dir}/${it._slug}/`);
      entries.push({ loc: `/${sec.dir}/${it._slug}/`, priority: sec.type === "Article" ? 0.7 : 0.8, lastmod: isoDate(it._updated), image: absUrl(it._img || it.imageUrl), title: clean(it.title) });
      total++;
    }
    console.log(`✅ ${sec.label}: ${items.length}`);
  }

  // 3.5) صفحات الفريق
  const teamList = [];
  for (const m of TEAM) teamList.push([m, await teamPhoto(m)]);
  if (await writeFile("team/index.html", teamHub(teamList))) changed.push(`${SITE}/team/`);
  entries.push({ loc: "/team/", priority: 0.6 });
  for (const [m, photo] of teamList) {
    if (await writeFile(`team/${m.slug}/index.html`, teamPage(m, photo, teamWorks(m, all)))) changed.push(`${SITE}/team/${m.slug}/`);
    entries.push({ loc: `/team/${m.slug}/`, priority: 0.6, ...(photo ? { image: SITE + photo, title: m.name } : {}) });
  }
  const counts = Object.fromEntries(["courses", "projects", "products", "books"].map((c) => [c, (data[c] || []).length]));
  if (await writeFile("about/index.html", aboutPage(teamList, counts))) changed.push(`${SITE}/about/`);
  entries.push({ loc: "/about/", priority: 0.7 });
  console.log(`👷 الفريق: ${TEAM.length} صفحات + من نحن`);

  // 3.6) الحاسبات
  if (await writeFile("tools/index.html", toolsHub())) changed.push(`${SITE}/tools/`);
  entries.push({ loc: "/tools/", priority: 0.8 });
  entries.push({ loc: "/cad/", priority: 0.8 }); // 3ENG CAD — صفحة ثابتة مكتوبة يدوياً
  entries.push({ loc: "/cad/breadboard/", priority: 0.7 });
  for (const t of TOOLS) {
    if (await writeFile(`tools/${t.slug}/index.html`, toolPage(t, all))) changed.push(`${SITE}/tools/${t.slug}/`);
    entries.push({ loc: `/tools/${t.slug}/`, priority: 0.7 });
  }
  console.log(`🧮 الحاسبات: ${TOOLS.length}`);

  // 4) صفحات التصنيف — فقط للتصنيفات اللي فيها عنصرين أو أكثر (بلا صفحات ضعيفة)
  const topicList = TAXONOMY.map((t) => [t, all.filter((it) => itemTopics(it).includes(t))]).filter(([, items]) => items.length >= 2);
  const keepTopics = new Set(topicList.map(([t]) => t.slug));
  try {
    for (const d of await fs.readdir(path.join(OUT_DIR, "topics"), { withFileTypes: true }))
      if (d.isDirectory() && !keepTopics.has(d.name)) await fs.rm(path.join(OUT_DIR, "topics", d.name), { recursive: true });
  } catch {}
  if (topicList.length) {
    if (await writeFile("topics/index.html", topicsHub(topicList))) changed.push(`${SITE}/topics/`);
    entries.push({ loc: "/topics/", priority: 0.7 });
    for (const [t, items] of topicList) {
      if (await writeFile(`topics/${t.slug}/index.html`, topicPage(t, items))) changed.push(`${SITE}/topics/${t.slug}/`);
      entries.push({ loc: `/topics/${t.slug}/`, priority: 0.7 });
    }
    console.log(`🏷️  التصنيفات: ${topicList.map(([t, i]) => `${t.slug}(${i.length})`).join(" ")}`);
  } else {
    await fs.rm(path.join(OUT_DIR, "topics"), { recursive: true, force: true });
    console.log("🏷️  التصنيفات: لا يوجد تصنيف فيه عنصرين أو أكثر بعد — أضف «التقنيات» للعناصر من لوحة التحكم");
  }

  for (const e of EXTRA_URLS) entries.push({ priority: 0.3, ...e });
  await writeFile("sitemap.xml", sitemap(entries));
  await writeFile("llms.txt", llms(data));
  if (await updateHome(data)) { changed.push(`${SITE}/`); console.log("✅ الصفحة الرئيسية: محتوى ثابت محدّث"); }
  await indexNow(changed);

  console.log(`\n🎉 تم توليد ${total} صفحة + ${groups.filter((g) => g.items.length).length} فهارس + ${topicList.length} تصنيف + sitemap.xml + llms.txt`);
  console.log(`📝 صفحات تغيّرت: ${changed.length}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
