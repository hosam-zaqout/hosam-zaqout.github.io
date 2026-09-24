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
  // { loc: "/privacy.html", priority: 0.3 },
  // { loc: "/terms.html",   priority: 0.3 },
];

// الأقسام: اسم الـ collection بـ Firestore ← إعدادات الصفحة
const SECTIONS = [
  { col: "courses",  dir: "courses",  label: "الدورات",          one: "دورة",        type: "Course",  emoji: "🎓", anchor: "#courses"  },
  { col: "projects", dir: "projects", label: "المشاريع الجاهزة", one: "مشروع",       type: "Product", emoji: "🛠️", anchor: "#projects" },
  { col: "products", dir: "products", label: "المنتجات الرقمية", one: "منتج رقمي",   type: "Product", emoji: "📦", anchor: "#products" },
  { col: "books",    dir: "books",    label: "الكتب الهندسية",   one: "كتاب",        type: "Product", emoji: "📚", anchor: "#books"    },
];

// ⚠️ حقول ممنوع تطلع بالصفحات أبداً (روابط ملفات مدفوعة وغيرها)
const PRIVATE_FIELDS = ["fileUrl", "downloadUrl", "driveUrl", "secret", "email"];

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
      const data = decodeFields(d.fields || {});
      for (const p of PRIVATE_FIELDS) delete data[p];
      data.id = d.name.split("/").pop();
      data._updated = data.updatedAt || d.updateTime;
      docs.push(data);
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return docs;
}

async function loadData() {
  if (process.env.MOCK_FILE) {
    const mock = JSON.parse(await fs.readFile(process.env.MOCK_FILE, "utf8"));
    for (const arr of Object.values(mock)) for (const d of arr) for (const p of PRIVATE_FIELDS) delete d[p];
    return mock;
  }
  const out = {};
  for (const s of SECTIONS) out[s.col] = await fetchCollection(s.col);
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
  if (item.slug) return String(item.slug).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
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
@media(max-width:820px){.hero,.grid2{grid-template-columns:1fr}.nav{display:none}h1{font-size:1.4rem}}
`;

function layout({ title, description, canonical, image, schemas, body, ogType = "website" }) {
  const img = image || `${SITE}/logo.jpg`;
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
  <nav class="nav">${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}</nav>
</div></header>
<main class="wrap">
${body}
</main>
<footer><div class="wrap">
  <nav><a href="/">الرئيسية</a>${SECTIONS.map((s) => `<a href="/${s.dir}/">${s.label}</a>`).join("")}</nav>
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

// ---------------- صفحة العنصر ----------------
function itemPage(sec, item, siblings) {
  const title = clean(item.title) || `${sec.one} من ${BRAND}`;
  const url = `/${sec.dir}/${item._slug}/`;
  const canonical = SITE + url;
  const desc = cut(item.shortDesc || item.desc || `${sec.one} ${title} من منصة ${BRAND}`, 155);
  const price = num(item.price) ?? 0;
  const oldPrice = num(item.oldPrice);
  const img = item.imageUrl || item.coverUrl || item.image || "";
  const yt = youtubeId(item.videoUrl);
  const updated = isoDate(item._updated);
  const offer = {
    "@type": "Offer",
    price: String(price),
    priceCurrency: CURRENCY,
    availability: "https://schema.org/InStock",
    url: canonical,
    ...(sec.type === "Course" ? { category: price > 0 ? "Paid" : "Free" } : {}),
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
      inLanguage: "ar",
      ...(img ? { image: img } : {}),
      provider: ORG,
      offers: offer,
      ...(item.level ? { educationalLevel: item.level } : {}),
      ...(arr(item.learns).length ? { teaches: arr(item.learns).map(clean) } : {}),
      ...(arr(item.topics).length ? { syllabusSections: arr(item.topics).slice(0, 30).map((t) => ({ "@type": "Syllabus", name: clean(t) })) } : {}),
      hasCourseInstance: {
        "@type": "CourseInstance",
        courseMode: item.mode || "Blended",
        ...(workload ? { courseWorkload: workload } : {}),
        inLanguage: "ar",
      },
    };
  } else {
    main = {
      "@context": "https://schema.org",
      "@type": "Product",
      name: title,
      description: cut(item.desc || item.shortDesc || desc, 500),
      url: canonical,
      sku: item.id,
      ...(img ? { image: img } : { image: `${SITE}/logo.jpg` }),
      brand: { "@type": "Brand", name: BRAND },
      category: item.category || sec.one,
      offers: offer,
    };
  }
  if (updated) main.dateModified = updated;

  const bc = crumbs([
    { name: "الرئيسية", url: "/" },
    { name: sec.label, url: `/${sec.dir}/` },
    { name: cut(title, 60), url },
  ]);

  const tags = [
    item.category && isNaN(item.category) ? `📂 ${item.category}` : "",
    item.level && `🎯 ${item.level}`,
    item.duration && `⏱ ${item.duration}`,
    item.lessons && `📹 ${item.lessons}`,
    item.author && `✍️ ${item.author}`,
    item.pages && `📄 ${item.pages} صفحة`,
  ].filter(Boolean);

  const off = oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : 0;
  const waMsg = encodeURIComponent(`مرحباً 3ENG.s، أرغب في طلب: ${title}\n${canonical}`);
  const cover = img
    ? `<img src="${esc(img)}" alt="${esc(title)}" width="800" height="450" fetchpriority="high">`
    : `<div class="emoji-cover">${item.emoji || sec.emoji}</div>`;

  const learnTitle = sec.type === "Course" ? "🎯 ماذا ستتعلم" : "🎁 ماذا ستحصل عليه";
  const related = siblings.filter((s) => s.id !== item.id).slice(0, 3);

  const body = `
${bc.html}
<section class="hero">
  <div>${cover}</div>
  <div>
    <h1>${esc(title)}</h1>
    ${item.shortDesc ? `<p class="lead">${esc(clean(item.shortDesc))}</p>` : ""}
    <div class="tags">${tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>
    <div class="price">${price > 0 ? `<b>$${price}</b>` : `<b>مجاني</b>`}${oldPrice && oldPrice > price ? `<s>$${oldPrice}</s><span class="off">وفّر ${off}%</span>` : ""}</div>
    <div class="cta">
      <a class="btn main" href="/?open=${sec.col}:${item.id}">${price > 0 ? "🛒 اطلب الآن" : "📥 احصل عليه مجاناً"}</a>
      <a class="btn wa" href="https://wa.me/${WHATSAPP}?text=${waMsg}" rel="nofollow">💬 استفسار واتساب</a>
    </div>
  </div>
</section>

${item.desc ? `<section class="box"><h2>📖 التفاصيل</h2>${paragraphs(item.desc)}</section>` : ""}
<div class="grid2">
  ${list(learnTitle, item.learns)}
  ${list("🔧 المكونات المستخدمة", item.components, "•")}
  ${list("📝 المتطلبات المسبقة", item.requirements, "•")}
</div>
${list("📚 محاور الدورة", item.topics, "▸")}
${yt ? `<section class="box"><h2>🎬 فيديو ${esc(sec.one)}</h2><div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${yt}" title="${esc(title)}" loading="lazy" allowfullscreen></iframe></div></section>` : ""}

${related.length ? `<h2 class="sec-title">${sec.emoji} ${esc(sec.label)} أخرى قد تهمك</h2><div class="cards">${related.map((r) => card(sec, r)).join("")}</div>` : ""}
`;

  return layout({
    title: `${cut(title, 55)} | ${BRAND}`,
    description: desc,
    canonical,
    image: img,
    ogType: "product",
    schemas: [main, bc.schema],
    body,
  });
}

function card(sec, it) {
  const img = it.imageUrl || it.coverUrl || it.image;
  const price = num(it.price) ?? 0;
  return `<a class="card" href="/${sec.dir}/${it._slug}/">${img
    ? `<img src="${esc(img)}" alt="${esc(clean(it.title))}" loading="lazy" width="400" height="225">`
    : `<div class="ph">${it.emoji || sec.emoji}</div>`}<div class="b"><h3>${esc(cut(it.title, 70))}</h3><div class="p">${price > 0 ? "$" + price : "مجاني"}</div></div></a>`;
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
`;
  for (const sec of SECTIONS) {
    const items = data[sec.col] || [];
    if (!items.length) continue;
    t += `\n## ${sec.label}\n`;
    for (const it of items) {
      const price = num(it.price) ?? 0;
      t += `- [${clean(it.title)}](${SITE}/${sec.dir}/${it._slug}/): ${cut(it.shortDesc || it.desc || "", 140)} (${price > 0 ? "$" + price : "مجاني"})\n`;
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
  const entries = [{ loc: "/", priority: 1.0, lastmod: new Date().toISOString(), image: `${SITE}/logo.jpg`, title: BRAND }];
  const changed = [];
  let total = 0;

  for (const sec of SECTIONS) {
    const items = (data[sec.col] || []).filter((i) => clean(i.title) && i.hidden !== true && i.published !== false);
    // slugs فريدة
    const seen = new Set();
    for (const it of items) {
      it._updated ??= it.updatedAt;
      let s = slugify(it);
      while (seen.has(s)) s += "-" + it.id.slice(0, 4).toLowerCase();
      seen.add(s);
      it._slug = s;
    }
    data[sec.col] = items;
    if (!items.length) continue;

    // مسح الصفحات القديمة لعناصر انحذفت
    const dir = path.join(OUT_DIR, sec.dir);
    try {
      for (const d of await fs.readdir(dir, { withFileTypes: true }))
        if (d.isDirectory() && !seen.has(d.name)) await fs.rm(path.join(dir, d.name), { recursive: true });
    } catch {}

    if (await writeFile(`${sec.dir}/index.html`, hubPage(sec, items))) changed.push(`${SITE}/${sec.dir}/`);
    entries.push({ loc: `/${sec.dir}/`, priority: 0.9 });

    for (const it of items) {
      const rel = `${sec.dir}/${it._slug}/index.html`;
      if (await writeFile(rel, itemPage(sec, it, items))) changed.push(`${SITE}/${sec.dir}/${it._slug}/`);
      entries.push({ loc: `/${sec.dir}/${it._slug}/`, priority: 0.8, lastmod: isoDate(it._updated), image: it.imageUrl, title: clean(it.title) });
      total++;
    }
    console.log(`✅ ${sec.label}: ${items.length}`);
  }

  for (const e of EXTRA_URLS) entries.push({ priority: 0.3, ...e });
  await writeFile("sitemap.xml", sitemap(entries));
  await writeFile("llms.txt", llms(data));
  await indexNow(changed);

  console.log(`\n🎉 تم توليد ${total} صفحة + ${SECTIONS.length} فهارس + sitemap.xml + llms.txt`);
  console.log(`📝 صفحات تغيّرت: ${changed.length}`);
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
