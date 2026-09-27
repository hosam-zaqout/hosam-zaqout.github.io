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

async function loadData() {
  if (process.env.MOCK_FILE) {
    const mock = JSON.parse(await fs.readFile(process.env.MOCK_FILE, "utf8"));
    for (const arr of Object.values(mock)) if (Array.isArray(arr)) for (const d of arr) stripPrivate(d);
    return mock;
  }
  const out = {};
  for (const s of SECTIONS) out[s.col] = await fetchCollection(s.col);
  out.testimonials = await fetchCollection("testimonials");
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
@media(max-width:820px){.hero,.grid2{grid-template-columns:1fr}.nav{display:none}h1{font-size:1.4rem}.facts th{white-space:normal}}
`;

function layout({ title, description, canonical, image, schemas, body, ogType = "website" }) {
  const img = image || OG_DEFAULT;
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow, max-image-preview:large">
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
<style>${CSS}</style>
${schemas.map(jsonLd).join("\n")}
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-GZJCYL5YM8"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-GZJCYL5YM8');</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="logo" href="/"><img src="/logo.jpg" alt="شعار 3ENG.s" width="36" height="36">${BRAND}</a>
  <nav class="nav">${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}<a href="/topics/">التصنيفات</a></nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">
  <nav><a href="/">الرئيسية</a>${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}<a href="/topics/">التصنيفات</a><a href="/#about">من نحن</a><a href="/#faq">الأسئلة الشائعة</a><a href="/privacy.html">سياسة الخصوصية</a></nav>
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

const ORG = { "@type": "EducationalOrganization", name: BRAND, alternateName: BRAND_AR, url: SITE, logo: `${SITE}/logo.jpg` };

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
  for (const sec of SECTIONS) {
    for (const it of data[sec.col] || []) {
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
      hasCourseInstance: {
        "@type": "CourseInstance",
        courseMode: item.mode || "Online",
        ...(workload ? { courseWorkload: workload } : {}),
        inLanguage: "ar",
      },
      ...extra,
    };
  } else {
    main = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: title,
      description: cut(item.desc || item.shortDesc || desc, 500),
      url: canonical,
      sku: item.id,
      image: imgAbs || `${SITE}/logo.jpg`,
      brand: { "@type": "Brand", name: BRAND },
      category: (item.category && isNaN(item.category) ? item.category : "") || sec.one,
      ...(item.author ? { author: { "@type": "Person", name: clean(item.author) } } : {}),
      offers: offer,
      ...extra,
    };
  }
  if (updated) main.dateModified = updated;

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
    item.author ? ["المؤلف", item.author] : null,
    ["اللغة", "العربية"],
    ["السعر", free ? "مجاني" : `$${price} ${CURRENCY}`],
    ["طريقة الحصول عليه", howGet],
    sec.type === "Course" ? ["الشهادة", "شهادة معتمدة لكل من يُنجز الدورة"] : null,
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
  </div>
</section>

${factsHtml}
${item.desc ? `<section class="box"><h2>📖 التفاصيل</h2>${paragraphs(item.desc)}</section>` : ""}
<div class="grid2">
  ${list("👥 لمن هذا؟", audience, "•")}
  ${list(learnTitle, item.learns)}
  ${list("🔧 المكونات المستخدمة", item.components, "•")}
  ${list("📝 المتطلبات المسبقة", item.requirements, "•")}
</div>
${list("📚 محاور الدورة", item.topics, "▸")}
${yt ? `<section class="box"><h2>🎬 فيديو ${esc(sec.one)}</h2><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div></section>` : ""}
${faqs.length ? `<section class="box faq"><h2>❓ أسئلة عن ${esc(sec.one)}</h2>${faqs.map((f) => `<details><summary>${esc(clean(f.q))}</summary><p>${esc(clean(f.a))}</p></details>`).join("")}</section>` : ""}
${license}

<section class="box"><h2>👷 عن ${BRAND}</h2><p>${BRAND} (${BRAND_AR}) منصة عربية من فلسطين يديرها مهندسون كهربائيون ومدربون جامعيون، تقدّم دورات ومشاريع جاهزة وكتباً في الهندسة الكهربائية والأنظمة المدمجة وإنترنت الأشياء. <a href="/#about" style="color:var(--acc)">تعرّف على الفريق</a> • <a href="/#faq" style="color:var(--acc)">الأسئلة الشائعة</a> • <a href="/privacy.html#refund" style="color:var(--acc)">سياسة الإرجاع</a></p></section>

${related.length ? `<h2 class="sec-title">🔗 قد يهمك أيضاً</h2><div class="cards">${related.map((r) => card(r._sec, r)).join("")}</div>` : ""}
`;

  return layout({
    title: `${cut(title, 55)} | ${BRAND}`,
    description: desc,
    canonical,
    image: imgAbs,
    ogType: "product",
    schemas,
    body,
  });
}

function card(sec, it, showType = false) {
  const img = it._thumb || it.imageUrl || it.coverUrl || it.image;
  const price = num(it.price) ?? 0;
  const h = it._w && it._h ? Math.round((480 * it._h) / it._w) : 225;
  return `<a class="card" href="/${sec.dir}/${it._slug}/">${img
    ? `<img src="${esc(img)}" alt="${esc(clean(it.title))}" loading="lazy" decoding="async" width="480" height="${h}">`
    : `<div class="ph">${it.emoji || sec.emoji}</div>`}<div class="b">${showType ? `<div class="k">${sec.emoji} ${esc(sec.one)}</div>` : ""}<h3>${esc(cut(it.title, 70))}</h3><div class="p">${price > 0 && !isFree(it) ? "$" + price : "مجاني"}</div></div></a>`;
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
  const groups = SECTIONS.map((sec) => [sec, items.filter((i) => i._sec === sec)]).filter(([, g]) => g.length);
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

function redirectPage(to) {
  return `<!DOCTYPE html><html lang="ar"><head><meta charset="UTF-8"><title>تم نقل الصفحة</title>
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
    return `<a href="/${sec.dir}/${it._slug}/">${esc(cut(it.title, 70))}<b>${price > 0 && !isFree(it) ? "$" + price : "مجاني"}</b></a>`;
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
  const hero = data.config?.hero || {};
  for (const i of [1, 2, 3, 4]) {
    const v = clean(hero["stat" + i]?.num);
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
<p class="lead">كل ${esc(sec.label)} المتوفرة على منصة ${BRAND} في الهندسة الكهربائية، ESP32، Arduino، إنترنت الأشياء والذكاء الاصطناعي.</p>
<div class="cards">${items.map((it) => card(sec, it)).join("")}</div>`;
  return layout({
    title: `${sec.label} | ${BRAND} ${BRAND_AR}`,
    description: cut(`تصفح ${sec.label} على منصة ${BRAND}: ${items.slice(0, 4).map((i) => clean(i.title)).join("، ")}`, 155),
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
- سياسة الخصوصية والإرجاع: ${SITE}/privacy.html

## الفريق
- م. حسام زقوت — مهندس كهربائي، مؤسس ومدرّب. بكالوريوس هندسة كهربائية من الجامعة الإسلامية بغزة، مساعد تدريس وبحث ومحاضر زائر في إنترنت الأشياء والحساسات. متخصص في الأنظمة المدمجة وتصميم PCB والعتاد المدمج بالذكاء الاصطناعي.
- م. إسراء الطويل — مهندسة أنظمة مدمجة ومدرّبة، متخصصة في إنترنت الأشياء والأنظمة المدمجة، درّبت أكثر من 300 طالب.
- م. فرات الطويل — مهندسة أنظمة ذكية مهتمة بتطوير المنتجات وبتعليم الأطفال علوم الإلكترونيات واللغات، ولديها خبرة كبيرة في إعداد السيرة الذاتية وتدريب الطلاب على اجتياز المقابلات والتقدّم للمنح الدراسية.

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
  const entries = [{ loc: "/", priority: 1.0, lastmod: new Date().toISOString(), image: OG_DEFAULT, title: BRAND }];
  const changed = [];
  let total = 0;

  // 1) تجهيز العناصر والـ slugs لكل الأقسام
  const redirectsBy = {}, seenBy = {}, all = [];
  for (const sec of SECTIONS) {
    const items = (data[sec.col] || []).filter((i) => clean(i.title) && i.hidden !== true && i.published !== false);
    const seen = new Set();
    const redirects = [];
    for (const it of items) {
      it._updated ??= it.updatedAt;
      it._sec = sec;
      let sl = slugify(it);
      while (seen.has(sl)) sl += "-" + it.id.slice(0, 4).toLowerCase();
      seen.add(sl);
      it._slug = sl;
      // غيّرت الرابط من لوحة التحكم؟ الرابط القديم يحوّل للجديد بدل ما يعطي 404
      const old = autoSlug(it);
      if (old !== sl) redirects.push([old, sl]);
    }
    for (const [old] of redirects) seen.add(old);
    data[sec.col] = items;
    redirectsBy[sec.col] = redirects;
    seenBy[sec.col] = seen;
    all.push(...items);
  }

  // 2) ضغط الصور
  await optimizeImages(data);

  // 3) الصفحات
  for (const sec of SECTIONS) {
    const items = data[sec.col];
    if (!items.length) continue;

    // مسح الصفحات القديمة لعناصر انحذفت
    const dir = path.join(OUT_DIR, sec.dir);
    try {
      for (const d of await fs.readdir(dir, { withFileTypes: true }))
        if (d.isDirectory() && !seenBy[sec.col].has(d.name)) await fs.rm(path.join(dir, d.name), { recursive: true });
    } catch {}

    if (await writeFile(`${sec.dir}/index.html`, hubPage(sec, items))) changed.push(`${SITE}/${sec.dir}/`);
    entries.push({ loc: `/${sec.dir}/`, priority: 0.9 });

    for (const [old, to] of redirectsBy[sec.col]) await writeFile(`${sec.dir}/${old}/index.html`, redirectPage(`${SITE}/${sec.dir}/${to}/`));

    for (const it of items) {
      const rel = `${sec.dir}/${it._slug}/index.html`;
      if (await writeFile(rel, itemPage(sec, it, items, all))) changed.push(`${SITE}/${sec.dir}/${it._slug}/`);
      entries.push({ loc: `/${sec.dir}/${it._slug}/`, priority: 0.8, lastmod: isoDate(it._updated), image: absUrl(it._img || it.imageUrl), title: clean(it.title) });
      total++;
    }
    console.log(`✅ ${sec.label}: ${items.length}`);
  }

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

  console.log(`\n🎉 تم توليد ${total} صفحة + ${SECTIONS.length} فهارس + ${topicList.length} تصنيف + sitemap.xml + llms.txt`);
  console.log(`📝 صفحات تغيّرت: ${changed.length}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
