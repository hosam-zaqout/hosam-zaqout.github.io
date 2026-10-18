"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// مفتاح بوابة Togo — محفوظ في Secret Manager:
//   firebase functions:secrets:set TOGO_API_KEY --project engs-website
const TOGO_API_KEY = defineSecret("TOGO_API_KEY");
const SMTP_PASS = defineSecret("SMTP_PASS");
const TOGO_BASE    = "https://api.togo.ps/api/v1";

const CURRENCY    = "USD";
const SITE        = "https://www.3engs.com";
const RETURN_BASE = SITE + "/payment-success.html";
const ADMINS      = ["hosam2564491@gmail.com", "info@3engs.com"];


// المجموعات اللي فيها عناصر قابلة للبيع
const SELLABLE = ["products", "books", "projects", "courses", "section_items"];

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function setCORS(req, res) {
  const allowed = ["https://www.3engs.com", "https://3engs.com"];
  const origin = req.headers.origin || "";
  if (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  } else {
    res.set("Access-Control-Allow-Origin", SITE);
  }
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Max-Age", "3600");
}

async function verifyIdToken(token) {
  if (!token) return null;
  try {
    return await getAuth().verifyIdToken(token);
  } catch (e) {
    return null;
  }
}

async function verifyToken(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? verifyIdToken(h.slice(7)) : null;
}

// الأدمن: الإيميلات الأساسية، أو حساب رفعه أدمن أساسي (users/{uid}.role == "admin") — والإيميل مؤكَّد دائماً
async function isAdmin(user) {
  if (!user || user.email_verified !== true) return false;
  if (ADMINS.includes(user.email || "")) return true;
  const u = await db.collection("users").doc(user.uid).get();
  return u.exists && u.data().role === "admin";
}

// 🛒 الشراء بدون حساب (زائر): الطلب إله مفتاح سري accessKey بيوصل للزبون برابط الرجوع والإيصال
const crypto = require("crypto");
function keyOk(order, key) {
  const a = Buffer.from(String(order.accessKey || "")), b = Buffer.from(String(key || ""));
  return a.length >= 32 && a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function canAccess(order, user, key) {
  return (!!user && (order.userId === user.uid || await isAdmin(user))) || keyOk(order, key);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function orderLink(o) {
  return `${RETURN_BASE}?invoice_id=${encodeURIComponent(o.invoiceId)}&k=${encodeURIComponent(o.accessKey || "")}`;
}

function isFreeItem(d) {
  return d.isFree === true || !(Number(d.price) > 0);
}

async function getPaymentConfig() {
  const snap = await db.collection("site_config").doc("main").get();
  return (snap.exists && snap.data().payment) || {};
}

// روابط التحميل تُبنى على السيرفر فقط، ولطلبات مدفوعة فقط
// الملفات المدفوعة محفوظة في private_files/{col}__{id} (للأدمن فقط)
async function resolveDownloads(order) {
  const items = order.items || [];
  // طلبات قديمة (قبل التحديث) — الروابط محفوظة داخل الطلب
  if (!items.some((i) => i.col && i.id)) return order.downloadLinks || [];

  return Promise.all(items.map(async (item) => {
    let fileUrl = "", message = "", hasLessons = false;
    if (item.col && item.id) {
      const priv = await db.collection("private_files").doc(`${item.col}__${item.id}`).get();
      fileUrl = (priv.exists && priv.data().fileUrl) || "";
      // 🔒 رسالة بعد الدفع (مثل رابط جروب الورشة) — للمشتري فقط
      message = String((priv.exists && priv.data().message) || "").substring(0, 2000);
      hasLessons = !!(priv.exists && Array.isArray(priv.data().lessons) && priv.data().lessons.length);
      if (!fileUrl) {
        const pub = await db.collection(item.col).doc(item.id).get();
        fileUrl = (pub.exists && pub.data().fileUrl) || "";
      }
    }
    return { name: item.name, emoji: item.emoji || "📦", fileUrl, message, col: item.col, id: item.id, hasLessons };
  }));
}

function publicOrder(o, links) {
  return {
    invoiceId: o.invoiceId,
    status:    o.status,
    total:     o.total,
    currency:  o.currency,
    items:     (o.items || []).map((i) => ({ name: i.name, emoji: i.emoji })),
    downloadLinks: o.status === "paid" ? links : [],
    createdAt: o.createdAt?.toMillis?.() || null,
    paidAt:    o.paidAt?.toMillis?.() || null,
  };
}

function errorPage(res, code, msg) {
  const safe = String(msg).replace(/[<>&"]/g, "");
  res.status(code).set("Content-Type", "text/html; charset=utf-8").send(
    `<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>3ENG.s</title></head>` +
    `<body style="font-family:Tahoma,sans-serif;background:#0F172A;color:#E2E8F0;text-align:center;padding:60px 16px">` +
    `<h2>⚠️ تعذر إتمام الطلب</h2><p>${safe}</p>` +
    `<p><a style="color:#F59E0B" href="${SITE}">العودة للموقع</a></p></body></html>`
  );
}

// ─────────────────────────────────────────────
// Togo — بوابة الدفع (https://api.togo.ps/docs)
// ─────────────────────────────────────────────
async function togo(method, path, body) {
  const r = await fetch(TOGO_BASE + path, {
    method,
    headers: { "x-api-key": TOGO_API_KEY.value(), "Content-Type": "application/json", Accept: "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await r.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text.slice(0, 500) }; }
  if (!r.ok || json.success === false || json.error === true) {
    const err = new Error(json.message || `Togo HTTP ${r.status}`);
    err.status = r.status; err.body = json;
    throw err;
  }
  return json;
}
// أول قيمة موجودة من عدة أسماء محتملة (التوثيق ما بيحدد أسماء الحقول بالرد)
function pick(o, keys) {
  for (const k of keys) {
    const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
const clip = (o) => JSON.stringify(o).slice(0, 1500);

// حالة الدفع من رد Togo: paid | failed | pending
// نعتبره مدفوعاً فقط بإشارة صريحة — أي شي غامض يضل pending
function togoState(o) {
  if (!o || typeof o !== "object") return "pending";
  const flat = [];
  (function walk(x, path, depth) {
    if (depth > 3 || x == null) return;
    if (typeof x !== "object") { flat.push([path.toLowerCase(), x]); return; }
    for (const [k, v] of Object.entries(x)) walk(v, path ? path + "." + k : k, depth + 1);
  })(o, "", 0);
  // حقول الحالة فقط — بدون الروابط (payment_cancel_redirect_link فيها كلمة cancel)
  const rel = flat.filter(([k, v]) => /status|state|paid|payment|visa/.test(k) && !/link|url|redirect|email|phone|name|method|type|currency/.test(k) && !(typeof v === "string" && /^https?:/i.test(v)));
  const strs = rel.filter(([, v]) => typeof v === "string").map(([, v]) => v.toLowerCase().trim());
  if (strs.some((v) => /cancel|fail|reject|declin|expire|refund/.test(v))) return "failed";
  if (rel.some(([k, v]) => /(^|\.)(is_?paid|paid)$/.test(k) && (v === true || v === 1 || v === "1" || v === "true"))) return "paid";
  if (strs.some((v) => /^(paid|success|succeeded|successful|completed?|captured|approved|done)$/.test(v) || (v.includes("paid") && !/un_?paid|not_?paid|unpaid/.test(v)))) return "paid";
  if (rel.some(([k, v]) => /paid_?at|payment_?date/.test(k) && v)) return "paid";
  return "pending";
}

// يسأل Togo عن حالة الطلب ويحدّث Firestore — المصدر الوحيد لتأكيد الدفع
async function syncTogoOrder(orderRef, order) {
  if (order.method !== "togo" || !order.togoOrderId) return order;
  if (!["pending", "failed"].includes(order.status)) return order;
  let json;
  try {
    json = await togo("GET", `/orders?id=${encodeURIComponent(order.togoOrderId)}`);
  } catch (e) {
    logger.warn("Togo status check failed", { invoiceId: order.invoiceId, msg: e.message, body: e.body && clip(e.body) });
    return order;
  }
  // الرد الحقيقي: { data: { items: [ {id, status: "TO_PAY" | "CANCELLED" | ...} ], totalItems } }
  let data = json.data;
  const list = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (list) data = list.find((x) => String(pick(x, ["id", "_id", "order_id"])) === String(order.togoOrderId)) || null;
  if (!data) { logger.warn("Togo order not found in status response", { invoiceId: order.invoiceId, body: clip(json) }); return order; }
  const state = togoState(data);
  const update = { togoLastStatus: clip(data || json), togoCheckedAt: FieldValue.serverTimestamp() };
  let status = order.status;
  if (state === "paid") {
    // تأكد إنه المبلغ مطابق قبل ما نسلّم الملفات
    const value = Number(pick(data, ["value", "amount", "total", "order_value"]));
    const amountOk = !Number.isFinite(value) || value + 0.01 >= Number(order.total);
    const payCfg = await getPaymentConfig();
    status = !amountOk || payCfg.manualApproval ? "awaiting_approval" : "paid";
    Object.assign(update, { status, verification: "togo_api", ...(status === "paid" ? { paidAt: FieldValue.serverTimestamp() } : {}), ...(amountOk ? {} : { note: "⚠️ مبلغ Togo أقل من قيمة الطلب" }) });
  } else if (state === "failed") {
    status = "failed";
    update.status = "failed";
  }
  await orderRef.update(update);
  logger.info("Togo status", { invoiceId: order.invoiceId, state, status });
  return { ...order, ...update, status };
}

// كل الدول (functions/countries.js). المتصفح بيبعت رمز الدولة (ISO)، وإلا بنستنتجها من مقدمة الرقم
const { LIST: COUNTRY_LIST, BY_ISO } = require("./countries");
function countryOf(mobile, iso) {
  let c = BY_ISO[String(iso || "").toUpperCase()];
  if (!c || !mobile.startsWith(c.dial)) {
    c = null;
    for (const len of [4, 3, 2, 1]) { c = COUNTRY_LIST.find((x) => x.dial === mobile.slice(0, len)); if (c) break; }
  }
  if (!c) return ["PS", "Palestine"];
  // 972 من غزة والضفة والداخل ← فلسطين عند بوابة الدفع
  return c.iso === "IL" ? ["PS", "Palestine"] : [c.iso, c.en];
}

// عنوان المستلم عند Togo — بنعيد استخدامه لنفس الرقم
async function togoReceiver(user, mobile, name, city, iso) {
  // المسجّل: بنخزّن بحسابه. الزائر: togo_receivers/{mobile} (السيرفر بس)
  const userRef = user ? db.collection("users").doc(user.uid) : db.collection("togo_receivers").doc(mobile);
  const cached = (await userRef.get()).data()?.togoReceivers?.[mobile];
  if (cached) return cached;
  const [code, country] = countryOf(mobile, iso);
  const json = await togo("POST", "/receivers-addresses", {
    receiver_name: name,
    receiver_phone_number: "+" + mobile,
    country_code: code,
    country_name: country,
    city: city || (code === "PS" ? "Gaza" : country),
    // Togo بيطلب details حتى لطلبات الدفع فقط (مش مذكور بالتوثيق)
    details: `${city || (code === "PS" ? "Gaza" : country)}, ${country} — 3ENG.s online order`,
    phone_connected_to_whats: false,
  });
  const id = pick(json, ["data.id", "data._id", "data.address_id", "data.receiver_address_id", "id"]);
  if (!id) { logger.error("Togo receiver: no id", { body: clip(json) }); throw new Error("Togo: receiver id missing"); }
  await userRef.set({ togoReceivers: { [mobile]: String(id) } }, { merge: true });
  return String(id);
}

// ─────────────────────────────────────────────
// 1. createPayment — HTML form POST ← redirect 302 لصفحة الدفع في Togo
// Body: token, items=[{col,id}], mobile, name, city
// الأسعار تُقرأ من Firestore — لا نثق بأي سعر من المتصفح
// ─────────────────────────────────────────────
exports.createPayment = onRequest(
  { secrets: [TOGO_API_KEY, SMTP_PASS], region: "us-central1" },
  async (req, res) => {
    if (req.method === "OPTIONS") { setCORS(req, res); res.status(204).send(""); return; }
    if (req.method !== "POST") { errorPage(res, 405, "طريقة الطلب غير مسموحة"); return; }

    const q = req.body || {};
    // الحساب اختياري: بدون token ← شراء كزائر بالاسم والإيميل
    const user = q.token ? await verifyIdToken(String(q.token)) : null;
    if (q.token && !user) { errorPage(res, 401, "انتهت الجلسة — حدّث الصفحة وحاول مرة أخرى"); return; }
    const email = String((user && user.email) || q.email || "").trim().toLowerCase().substring(0, 120);
    if (!EMAIL_RE.test(email)) { errorPage(res, 400, "البريد الإلكتروني غير صحيح — عليه تصلك روابط التحميل والإيصال"); return; }

    const payCfg = await getPaymentConfig();
    if (!payCfg.togo?.active) { errorPage(res, 400, "الدفع الإلكتروني غير مفعّل حالياً — تواصل معنا عبر واتساب"); return; }

    let refs;
    try {
      refs = typeof q.items === "string" ? JSON.parse(q.items) : q.items;
    } catch (e) {
      refs = null;
    }
    if (!Array.isArray(refs) || !refs.length || refs.length > 30) {
      errorPage(res, 400, "السلة غير صالحة"); return;
    }

    const mobile = String(q.mobile || "").replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(mobile)) { errorPage(res, 400, "رقم الجوال غير صحيح"); return; }
    const city = String(q.city || "").trim().substring(0, 60);

    // اقرأ العناصر من Firestore (بدون تكرار)
    const seen = new Set();
    const items = [];
    for (const r of refs) {
      const col = String(r?.col || "");
      const id  = String(r?.id || "");
      const key = col + "/" + id;
      if (!SELLABLE.includes(col) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(key)) continue;
      seen.add(key);
      const snap = await db.collection(col).doc(id).get();
      if (!snap.exists) continue;
      const d = snap.data();
      if (isFreeItem(d)) continue;
      items.push({
        col, id,
        name:  String(d.title || d.name || "منتج").substring(0, 100),
        price: Math.round(Number(d.price) * 100) / 100,
        emoji: String(d.emoji || ""),
      });
    }
    if (!items.length) { errorPage(res, 400, "لا توجد منتجات مدفوعة صالحة في السلة"); return; }
    // الأدوات المتقدمة صلاحية مربوطة بحساب — لازم تسجيل دخول
    if (!user && items.some((i) => i.col === "products" && i.id === TOOLS_PRO_ID)) {
      errorPage(res, 400, "الأدوات المتقدمة تُفعَّل على حسابك في الموقع، لذلك سجّل الدخول أولاً ثم أكمل الشراء"); return;
    }

    const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    const customerName = String(q.name || (user && user.name) || "عميل 3ENG.s").trim().substring(0, 80) || "عميل 3ENG.s";
    const accessKey = crypto.randomBytes(24).toString("hex");
    const invoiceId =
      "3ENGS-" + Date.now() + "-" +
      Math.random().toString(36).substring(2, 11).toUpperCase();
    const back = orderLink({ invoiceId, accessKey });

    // 📝 كل محاولة دفع بتنحفظ فوراً (status: started) بكل بيانات الزبون — حتى لو ما كمّل أو فشلت البوابة
    const iso = String(q.country || "").toUpperCase().substring(0, 2);
    const [ccIso, ccName] = countryOf(mobile, iso);
    const orderRef = db.collection("orders").doc(invoiceId);
    const attempt = {
      invoiceId,
      userId:        user ? user.uid : null,
      guest:         !user,
      accessKey,
      buyerName:     customerName,
      userEmail:     email,
      userMobile:    mobile,
      city,
      country:       ccIso,
      countryName:   iso === "XX" ? "أخرى" : ccName,
      sourcePage:    String(q.source || req.headers.referer || "").substring(0, 300),
      items,
      total,
      currency:      CURRENCY,
      status:        "started",
      method:        "togo",
      createdAt:     FieldValue.serverTimestamp(),
    };
    await orderRef.set(attempt);
    // 🔔 تنبيه للأدمن (ما بيأخّر الزبون أكثر من 4 ثواني)
    await Promise.race([notifyAttempt({ ...attempt, createdAt: new Date() }), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});

    let togoOrderId, hashedId, created;
    try {
      const receiverId = await togoReceiver(user, mobile, customerName, city, String(q.country || "").substring(0, 2));
      created = await togo("POST", "/actions", {
        event: "Create_Visa",
        data: {
          type: "RFP",
          value: total,
          currency: CURRENCY,
          receiver_address_id: receiverId,
          receiver_email: email,
          source: "external_website",
          prevent_sms_link: true,
          payment_success_redirect_link: back,
          payment_cancel_redirect_link: back + "&cancel=1",
        },
      });
      const d = created.data || {};
      togoOrderId = pick(d, ["id", "_id", "order_id", "order.id", "orderId"]) ||
        (String(created.message || "").match(/order\s+([A-Za-z0-9_-]+)/i) || [])[1];
      hashedId = pick(d, ["hashed_id", "hashedId", "hash_id", "order.hashed_id", "hash"]);
    } catch (e) {
      logger.error("Togo create failed", { invoiceId, msg: e.message, body: e.body && clip(e.body) });
      await orderRef.update({ status: "gateway_error", note: ("بوابة الدفع: " + (e.message || "")).substring(0, 300) }).catch(() => {});
      errorPage(res, 502, "تعذر الاتصال ببوابة الدفع حالياً. حاول بعد قليل أو تواصل معنا عبر واتساب مع رقم الطلب: " + invoiceId);
      return;
    }
    if (!hashedId || !togoOrderId) {
      logger.error("Togo create: missing ids", { invoiceId, body: clip(created) });
      await orderRef.update({ status: "gateway_error", note: "بوابة الدفع: رد بدون رقم طلب", togoCreate: clip(created) }).catch(() => {});
      errorPage(res, 502, "تعذر تجهيز صفحة الدفع. تواصل معنا عبر واتساب مع رقم الطلب: " + invoiceId);
      return;
    }

    // وصل لبوابة الدفع ← pending لحد ما Togo يأكد
    await orderRef.update({
      status:        "pending",
      togoOrderId:   String(togoOrderId),
      togoHashedId:  String(hashedId),
      togoCreate:    clip(created.data || created),
    });

    logger.info("Order created (Togo)", { invoiceId, total, togoOrderId });
    const payUrl = `https://api.togo.ps/api/v1/direct-pay?orderId=${encodeURIComponent(hashedId)}&receiverEmail=${encodeURIComponent(email)}`;
    res.redirect(302, payUrl);
  }
);

// ─────────────────────────────────────────────
// 2. verifyPayment — من payment-success.html بعد الرجوع من Togo
// ما بنثق بأي شي من رابط الرجوع: بنسأل Togo مباشرة عن حالة الطلب
// ─────────────────────────────────────────────
exports.verifyPayment = onRequest(
  { secrets: [TOGO_API_KEY], region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    const { invoiceId, key } = req.body || {};
    if (!user && !key) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!invoiceId || typeof invoiceId !== "string") {
      res.status(400).json({ error: "invoice_id مطلوب" }); return;
    }

    const orderRef  = db.collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

    let order = orderSnap.data();
    if (!(await canAccess(order, user, key))) { res.status(403).json({ error: "غير مصرح" }); return; }

    order = await syncTogoOrder(orderRef, order);
    const links = order.status === "paid" ? await resolveDownloads(order) : [];
    res.status(200).json({ success: order.status === "paid", ...publicOrder(order, links) });
  }
);

// ─────────────────────────────────────────────
// فحص دوري: طلبات Togo المعلّقة (لو الزبون دفع وسكّر الصفحة قبل الرجوع)
// ─────────────────────────────────────────────
exports.syncTogoPayments = onSchedule(
  { schedule: "every 30 minutes", region: "us-central1", secrets: [TOGO_API_KEY], timeZone: "Asia/Gaza" },
  async () => {
    const snap = await db.collection("orders").where("method", "==", "togo").where("status", "==", "pending").limit(50).get();
    const cutoff = Date.now() - 3 * 24 * 3600 * 1000;
    let checked = 0;
    for (const doc of snap.docs) {
      const o = doc.data();
      if ((o.createdAt?.toMillis?.() || 0) < cutoff) continue;
      await syncTogoOrder(doc.ref, o);
      checked++;
    }
    logger.info("Togo sweep", { pending: snap.size, checked });
  }
);

// ─────────────────────────────────────────────
// adminTogo — اختبار الاتصال بالبوابة من لوحة التحكم (قراءة فقط)
// ─────────────────────────────────────────────
exports.adminTogo = onRequest(
  { secrets: [TOGO_API_KEY], region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const user = await verifyToken(req);
    if (!(await isAdmin(user))) { res.status(403).json({ error: "للأدمن فقط" }); return; }
    // dryrun: عنوان تجريبي + طلب دفع $1 ثم إلغاؤه فوراً — لمعرفة شكل ردود Togo الحقيقية
    if (req.body?.action === "dryrun") {
      const steps = [];
      const step = async (name, fn) => {
        try { const r = await fn(); steps.push({ name, ok: true, res: r }); return r; }
        catch (e) { steps.push({ name, ok: false, error: e.message, status: e.status || null, body: e.body || null }); return null; }
      };
      const rcv = await step("receiver", () => togo("POST", "/receivers-addresses", {
        receiver_name: "3ENG.s Test", receiver_phone_number: "+972592753159", country_code: "PS", country_name: "Palestine",
        city: "Gaza", details: "Gaza, Palestine — 3ENG.s gateway test", phone_connected_to_whats: false,
      }));
      const rcvId = rcv && pick(rcv, ["data.id", "data._id", "data.address_id", "data.receiver_address_id", "id"]);
      const created = rcvId && await step("create", () => togo("POST", "/actions", {
        event: "Create_Visa",
        data: { type: "RFP", value: 1, currency: CURRENCY, receiver_address_id: String(rcvId), receiver_email: user.email,
          source: "external_website", prevent_sms_link: true,
          payment_success_redirect_link: RETURN_BASE + "?invoice_id=TEST", payment_cancel_redirect_link: RETURN_BASE + "?invoice_id=TEST&cancel=1" },
      }));
      const d = created?.data || {};
      const oid = pick(d, ["id", "_id", "order_id", "order.id", "orderId"]) || (String(created?.message || "").match(/order\s+([A-Za-z0-9_-]+)/i) || [])[1];
      if (oid) {
        await step("status", () => togo("GET", `/orders?id=${encodeURIComponent(oid)}`));
        await step("cancel", () => togo("POST", "/actions", { event: "Cancel", orderId: String(oid) }));
        await step("statusAfterCancel", () => togo("GET", `/orders?id=${encodeURIComponent(oid)}`));
      }
      res.status(200).json({ receiverId: rcvId || null, orderId: oid || null, hashedId: pick(d, ["hashed_id", "hashedId", "hash_id", "order.hashed_id", "hash"]) || null, steps });
      return;
    }
    try {
      const json = await togo("GET", "/currency-exchange");
      res.status(200).json({ ok: true, rate: json.data ?? null });
    } catch (e) {
      res.status(200).json({ ok: false, error: e.message, status: e.status || null });
    }
  }
);

// ─────────────────────────────────────────────
// 3. getOrderStatus
// ─────────────────────────────────────────────
exports.getOrderStatus = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    const { invoiceId, key } = req.body || {};
    if (!user && !key) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!invoiceId || typeof invoiceId !== "string") {
      res.status(400).json({ error: "invoice_id مطلوب" }); return;
    }

    const snap = await db.collection("orders").doc(invoiceId).get();
    if (!snap.exists) { res.status(404).json({ error: "غير موجود" }); return; }

    const order = snap.data();
    if (!(await canAccess(order, user, key))) {
      res.status(403).json({ error: "غير مصرح" }); return;
    }

    const links = order.status === "paid" ? await resolveDownloads(order) : [];
    res.status(200).json(publicOrder(order, links));
  }
);

// ─────────────────────────────────────────────
// 4. getUserOrders — طلبات المستخدم، أو كل الطلبات للأدمن (all: true)
// ─────────────────────────────────────────────
exports.getUserOrders = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const admin = req.body?.all === true && await isAdmin(user);
    // طلبات المستخدم تُرتّب هنا بدل orderBy — عشان ما نحتاج composite index
    const q = admin
      ? db.collection("orders").orderBy("createdAt", "desc").limit(200)
      : db.collection("orders").where("userId", "==", user.uid).limit(100);

    const snap = await q.get();
    let own = snap.docs;
    // طلبات اشتراها كزائر بنفس الإيميل (بعد ما عمل حساب وأكّد إيميله)
    if (!admin && user.email && user.email_verified) {
      const g = await db.collection("orders").where("userEmail", "==", user.email.toLowerCase()).limit(100).get();
      const ids = new Set(own.map((d) => d.id));
      own = [...own, ...g.docs.filter((d) => d.data().guest === true && !ids.has(d.id))];
    }
    const docs = admin ? snap.docs : [...own]
      .filter((d) => ["paid", "awaiting_approval", "failed", "revoked"].includes(d.data().status))
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
    const orders = await Promise.all(docs.map(async (doc) => {
      const o = doc.data();
      if (admin) {
        return {
          ...publicOrder(o, []),
          userEmail:     o.userEmail || "",
          userMobile:    o.userMobile || "",
          buyerName:     o.buyerName || "",
          city:          o.city || "",
          country:       o.country || "",
          countryName:   o.countryName || "",
          sourcePage:    o.sourcePage || "",
          guest:         !!o.guest,
          receiptSentAt: o.receiptSentAt?.toMillis?.() || null,
          method:        o.method || "",
          transactionId: o.transactionId || "",
          verification:  o.verification || "",
          togoLastStatus: o.togoLastStatus || "",
          note:          o.note || "",
        };
      }
      const links = o.status === "paid" ? await resolveDownloads(o) : [];
      return publicOrder(o, links);
    }));

    res.status(200).json({ orders });
  }
);

// ─────────────────────────────────────────────
// 5. adminUpdateOrder — موافقة / إلغاء طلب من لوحة التحكم
// Body: { invoiceId, action: "approve" | "revoke" }
// ─────────────────────────────────────────────
exports.adminUpdateOrder = onRequest(
  { secrets: [TOGO_API_KEY], region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    if (!(await isAdmin(user))) { res.status(403).json({ error: "للأدمن فقط" }); return; }

    const { invoiceId, action } = req.body || {};
    if (!invoiceId || typeof invoiceId !== "string" || !["approve", "revoke", "recheck"].includes(action)) {
      res.status(400).json({ error: "بيانات غير صالحة" }); return;
    }

    const ref = db.collection("orders").doc(invoiceId);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

    if (action === "recheck") {
      const o = await syncTogoOrder(ref, snap.data());
      res.status(200).json({ success: true, invoiceId, status: o.status, togo: o.togoLastStatus || null });
      return;
    }

    const update = action === "approve"
      ? { status: "paid", paidAt: FieldValue.serverTimestamp(), approvedBy: user.email }
      : { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: user.email };
    await ref.update(update);

    logger.info("Order updated by admin", { invoiceId, action, by: user.email });
    res.status(200).json({ success: true, invoiceId, status: update.status });
  }
);

// ─────────────────────────────────────────────
// 6. adminCreateOrder — طلب يدوي (دفع عبر واتساب / PayPal / تحويل)
// الأدمن يختار الزبون (لازم يكون مسجّل بالموقع) والعناصر،
// والطلب ينحفظ "مدفوع" فوراً — والزبون يلاقي ملفاته في "مشترياتي"
// Body: { email, items: [{col,id}], method, amountPaid?, note? }
// ─────────────────────────────────────────────
const MANUAL_METHODS = ["whatsapp", "paypal", "transfer", "cash", "other"];

exports.adminCreateOrder = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const admin = await verifyToken(req);
    if (!(await isAdmin(admin))) { res.status(403).json({ error: "للأدمن فقط" }); return; }

    const { email, items: refs, method, amountPaid, note, name, mobile } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: "بريد الزبون غير صحيح" }); return;
    }
    if (!Array.isArray(refs) || !refs.length || refs.length > 30) {
      res.status(400).json({ error: "اختر عنصراً واحداً على الأقل" }); return;
    }

    // الزبون بدون حساب ← طلب زائر برابط خاص بيوصله بالإيصال
    let buyer = null;
    try { buyer = await getAuth().getUserByEmail(cleanEmail); } catch (e) { buyer = null; }
    const buyerMobile = String(mobile || "").replace(/\D/g, "").substring(0, 15);

    const seen = new Set();
    const items = [];
    for (const r of refs) {
      const col = String(r?.col || "");
      const id  = String(r?.id || "");
      const key = col + "/" + id;
      if (!SELLABLE.includes(col) || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || seen.has(key)) continue;
      seen.add(key);
      const snap = await db.collection(col).doc(id).get();
      if (!snap.exists) continue;
      const d = snap.data();
      items.push({
        col, id,
        name:  String(d.title || d.name || "منتج").substring(0, 100),
        price: isFreeItem(d) ? 0 : Math.round(Number(d.price) * 100) / 100,
        emoji: String(d.emoji || ""),
      });
    }
    if (!items.length) { res.status(400).json({ error: "العناصر غير موجودة" }); return; }

    const listTotal = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    const paid = Number(amountPaid);
    const total = Number.isFinite(paid) && paid >= 0 ? Math.round(paid * 100) / 100 : listTotal;
    const m = MANUAL_METHODS.includes(method) ? method : "other";
    const invoiceId =
      "3ENGS-M-" + Date.now() + "-" +
      Math.random().toString(36).substring(2, 8).toUpperCase();

    await db.collection("orders").doc(invoiceId).set({
      invoiceId,
      userId:       buyer ? buyer.uid : null,
      guest:        !buyer,
      accessKey:    crypto.randomBytes(24).toString("hex"),
      buyerName:    String(name || "").trim().substring(0, 80) || (buyer && buyer.displayName) || cleanEmail.split("@")[0],
      userEmail:    cleanEmail,
      userMobile:   buyerMobile,
      items,
      total,
      listTotal,
      currency:     CURRENCY,
      status:       "paid",
      method:       "manual-" + m,
      verification: "manual",
      note:         String(note || "").substring(0, 300),
      approvedBy:   admin.email,
      createdAt:    FieldValue.serverTimestamp(),
      paidAt:       FieldValue.serverTimestamp(),
    });

    logger.info("Manual order created", { invoiceId, by: admin.email, buyer: cleanEmail, guest: !buyer, total });
    res.status(200).json({ success: true, invoiceId, buyer: cleanEmail, guest: !buyer, items: items.length, total });
  }
);

// ─────────────────────────────────────────────
// 📧 الإيميلات — عبر Gmail (Google Workspace) من info@3engs.com
// كلمة مرور التطبيق في Secret Manager:
//   firebase functions:secrets:set SMTP_PASS --project engs-website
// ─────────────────────────────────────────────
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const MAIL_FROM = "info@3engs.com";
let _mailer = null;
function mailer() {
  if (!_mailer) {
    const nodemailer = require("nodemailer");
    _mailer = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: MAIL_FROM, pass: SMTP_PASS.value() } });
  }
  return _mailer;
}
const escMail = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function mailLayout(title, inner) {
  return `<!DOCTYPE html><html lang="ar" dir="rtl"><body style="margin:0;background:#f1f5f9;font-family:Tahoma,Arial,sans-serif">
<div style="max-width:560px;margin:24px auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0" dir="rtl">
<div style="background:#0F172A;padding:18px 22px;color:#F59E0B;font-size:20px;font-weight:bold">3ENG.s <span style="color:#94A3B8;font-size:13px;font-weight:normal">— المهندسون الثلاثة</span></div>
<div style="padding:22px;color:#0f172a;font-size:15px;line-height:1.9;text-align:right"><h2 style="margin:0 0 12px;font-size:18px">${escMail(title)}</h2>${inner}</div>
<div style="padding:14px 22px;background:#f8fafc;color:#64748b;font-size:12px;text-align:right">📧 ${MAIL_FROM} • 💬 واتساب +972592753159 • <a href="${SITE}" style="color:#D97706">www.3engs.com</a></div>
</div></body></html>`;
}
async function sendMail(to, subject, title, inner, text) {
  return mailer().sendMail({ from: `"3ENG.s المهندسون الثلاثة" <${MAIL_FROM}>`, replyTo: MAIL_FROM, to, subject, html: mailLayout(title, inner), text });
}

const METHOD_AR = { togo: "بطاقة بنكية (Togo)", "manual-whatsapp": "واتساب", "manual-paypal": "PayPal", "manual-transfer": "تحويل بنكي / محفظة", "manual-cash": "نقداً", "manual-other": "أخرى" };

// نص الإيصال قابل للتعديل من لوحة التحكم (site_config/emails) — جدول الطلب ثابت
// المتغيرات: {name} {invoice} {total}
const DEFAULT_RECEIPT = {
  receiptSubject: "🧾 إيصال الدفع — طلب {invoice}",
  receiptTitle: "🧾 إيصال الدفع",
  receiptIntro: "أهلاً {name}،\nشكراً لك! تم استلام دفعتك بنجاح ✅",
  receiptFooter: "لأي استفسار، يُرجى الرد على هذا البريد مع ذكر رقم الطلب.",
};
async function receiptTemplate() {
  const c = (await db.collection("site_config").doc("emails").get()).data() || {};
  const t = {};
  for (const k of Object.keys(DEFAULT_RECEIPT)) t[k] = String(c[k] || "").trim() || DEFAULT_RECEIPT[k];
  return t;
}
async function buyerName(email) {
  try { const u = await getAuth().getUserByEmail(email); return u.displayName || email.split("@")[0]; }
  catch { return String(email || "").split("@")[0]; }
}
// extras: [{name, message}] — 🔒 رسائل ما بعد الدفع (مثل رابط جروب الواتساب)
function buildReceipt(o, tpl, name, extras = []) {
  const total = `$${Number(o.total || 0).toFixed(2)}`;
  const fill = (s) => String(s).replace(/\{name\}/g, name).replace(/\{invoice\}/g, o.invoiceId).replace(/\{total\}/g, total);
  const para = (s) => `<p style="white-space:pre-line">${escMail(fill(s))}</p>`;
  const paidAt = (o.paidAt?.toDate?.() || new Date()).toLocaleString("en-GB", { timeZone: "Asia/Gaza" });
  const rows = (o.items || []).map((i) => `<tr><td style="padding:6px 0;border-bottom:1px solid #e2e8f0">${escMail(i.emoji || "")} ${escMail(i.name)}</td><td style="padding:6px 0;border-bottom:1px solid #e2e8f0;text-align:left" dir="ltr">$${Number(i.price || 0).toFixed(2)}</td></tr>`).join("");
  const inner = `${para(tpl.receiptIntro)}
<table style="width:100%;font-size:14px;margin:10px 0"><tr><td style="color:#64748b">رقم الطلب</td><td style="text-align:left" dir="ltr"><b>${escMail(o.invoiceId)}</b></td></tr>
<tr><td style="color:#64748b">التاريخ</td><td style="text-align:left" dir="ltr">${escMail(paidAt)}</td></tr>
<tr><td style="color:#64748b">طريقة الدفع</td><td style="text-align:left">${escMail(METHOD_AR[o.method] || o.method || "—")}</td></tr></table>
<table style="width:100%;font-size:14px;border-collapse:collapse;margin:10px 0">${rows}
<tr><td style="padding:8px 0"><b>الإجمالي</b></td><td style="padding:8px 0;text-align:left" dir="ltr"><b>${total} ${escMail(o.currency || CURRENCY)}</b></td></tr></table>
${o.guest ? `<p>📦 مشترياتك جاهزة للتحميل: <a href="${escMail(orderLink(o))}" style="color:#D97706;font-weight:bold">افتح صفحة التحميل</a><br><span style="font-size:13px;color:#64748b">احتفظ بهذا البريد؛ الرابط خاص بك ويمكنك العودة إليه في أي وقت.</span></p>` : `<p>📦 مشترياتك جاهزة الآن في حسابك: <a href="${SITE}/?myorders=1" style="color:#D97706;font-weight:bold">افتح مشترياتي</a></p>`}
${msgsHtml(extras)}
${para(tpl.receiptFooter)}
<p style="font-size:13px;color:#64748b">↩️ يمكنك طلب الاسترداد خلال 7 أيام حسب <a href="${SITE}/privacy.html#refund" style="color:#D97706">سياسة الاسترداد</a>.</p>`;
  const text = `${fill(tpl.receiptIntro)}\n\nرقم الطلب: ${o.invoiceId}\nالتاريخ: ${paidAt}\n${(o.items || []).map((i) => `- ${i.name}: $${Number(i.price || 0).toFixed(2)}`).join("\n")}\nالإجمالي: ${total}${extras.filter((x) => x.message || x.learnUrl).map((x) => `\n\n🔒 ${x.name}:${x.learnUrl ? "\n▶️ المحاضرات: " + x.learnUrl : ""}${x.message ? "\n" + x.message : ""}`).join("")}\nمشترياتك: ${o.guest ? orderLink(o) : SITE + "/?myorders=1"}\n\n${fill(tpl.receiptFooter)}`;
  return { subject: fill(tpl.receiptSubject).substring(0, 200), title: fill(tpl.receiptTitle), inner, text };
}

const linkify = (t) => escMail(t).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#D97706;font-weight:bold;word-break:break-all">${u}</a>`);
function msgsHtml(extras) {
  const m = (extras || []).filter((x) => x.message || x.learnUrl);
  return m.length ? `<div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;padding:12px 14px;margin:12px 0"><b>🔒 معلومات خاصة بطلبك</b>${m.map((x) => `<p style="margin:8px 0 0;white-space:pre-line"><b>${escMail(x.name)}:</b>${x.learnUrl ? `\n<a href="${escMail(x.learnUrl)}" style="background:#10B981;color:#fff;padding:7px 14px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block;margin:6px 0">▶️ افتح محاضرات الورشة</a>` : ""}${x.message ? "\n" + linkify(x.message) : ""}</p>`).join("")}</div>` : "";
}

// 🔔 تنبيه للأدمن عند كل محاولة دفع
async function notifyAttempt(o) {
  const items = (o.items || []).map((i) => `${i.emoji || ""} ${i.name} — ${Number(i.price || 0).toFixed(2)}`).join("\n");
  const wa = o.userMobile ? `https://wa.me/${o.userMobile}` : "";
  const rows = [
    ["الاسم", o.buyerName], ["واتساب / جوال", o.userMobile ? "+" + o.userMobile : "—"], ["الإيميل", o.userEmail],
    ["الدولة / المدينة", [o.countryName, o.city].filter(Boolean).join(" — ") || "—"], ["المبلغ", "$" + Number(o.total || 0).toFixed(2)],
    ["من صفحة", o.sourcePage || "—"], ["رقم الطلب", o.invoiceId],
  ].map(([k, v]) => `<tr><td style="color:#64748b;padding:4px 0;width:120px">${escMail(k)}</td><td style="padding:4px 0" dir="auto">${escMail(v)}</td></tr>`).join("");
  const inner = `<p>شخص بدأ عملية دفع على الموقع. إذا ما وصلك إيصال دفع ناجح بعد شوي، تواصل معه وكمّل البيع.</p>
<table style="width:100%;font-size:14px">${rows}</table>
<p style="white-space:pre-line;background:#f8fafc;border-radius:8px;padding:10px">${escMail(items)}</p>
${wa ? `<p><a href="${wa}" style="background:#25D366;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:bold">💬 راسله واتساب</a></p>` : ""}
<p><a href="${SITE}/admin.html" style="color:#D97706">🧾 افتح الطلبات بلوحة التحكم</a></p>`;
  const text = `محاولة دفع جديدة\n${o.buyerName} | +${o.userMobile} | ${o.userEmail}\n${o.countryName || ""} ${o.city || ""}\n${items}\nالمجموع: ${o.total}\nمن: ${o.sourcePage || "—"}\n${o.invoiceId}`;
  try {
    await sendMail(MAIL_FROM, `🛒 محاولة دفع: ${o.buyerName} — ${Number(o.total || 0).toFixed(2)}`, "🛒 محاولة دفع جديدة", inner, text);
  } catch (e) { logger.warn("Attempt notify failed", { invoiceId: o.invoiceId, msg: e.message }); }
}

// 🧪 إيصال تجريبي لإيميل الأدمن — لمعاينة النص المحفوظ
exports.adminTestReceipt = onRequest(
  { region: "us-central1", secrets: [SMTP_PASS] },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const admin = await verifyToken(req);
    if (!(await isAdmin(admin))) { res.status(403).json({ error: "للأدمن فقط" }); return; }
    const sample = { invoiceId: "3ENGS-TEST-0000", method: "togo", total: 25, currency: CURRENCY, items: [{ emoji: "🎓", name: "دورة تجريبية", price: 25 }] };
    const r = buildReceipt(sample, await receiptTemplate(), await buyerName(admin.email));
    try {
      await sendMail(admin.email, "[تجربة] " + r.subject, r.title, r.inner, r.text);
      res.status(200).json({ success: true, to: admin.email });
    } catch (e) {
      logger.error("Test receipt failed", { msg: e.message });
      res.status(500).json({ error: "فشل الإرسال: " + String(e.message || e).substring(0, 200) });
    }
  }
);

// 🧾 إيصال تلقائي لما يصير الطلب "paid" — Togo أو موافقة الأدمن أو طلب يدوي
exports.sendReceipt = onDocumentWritten(
  { document: "orders/{orderId}", region: "us-central1", secrets: [SMTP_PASS] },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after || after.status !== "paid" || before?.status === "paid") return;
    if (!after.userEmail || after.receiptSentAt) return;
    const ref = event.data.after.ref;
    // نحجز الإرسال بمعاملة — ما بيطلع إيصالين لنفس الطلب
    const claimed = await db.runTransaction(async (t) => {
      const s = (await t.get(ref)).data() || {};
      if (s.receiptSentAt || s.receiptClaimedAt) return false;
      t.update(ref, { receiptClaimedAt: FieldValue.serverTimestamp() });
      return true;
    });
    if (!claimed) return;
    const o = after;
    const extras = (await resolveDownloads(o).catch(() => [])).map((x) => ({ ...x,
      learnUrl: x.hasLessons ? `${SITE}/learn/?item=${encodeURIComponent(x.col)}:${encodeURIComponent(x.id)}&inv=${encodeURIComponent(o.invoiceId)}&k=${encodeURIComponent(o.accessKey || "")}` : "" }));
    const r = buildReceipt(o, await receiptTemplate(), o.buyerName || await buyerName(o.userEmail), extras);
    try {
      await sendMail(o.userEmail, r.subject, r.title, r.inner, r.text);
      await ref.update({ receiptSentAt: FieldValue.serverTimestamp(), receiptError: FieldValue.delete() });
      logger.info("Receipt sent", { invoiceId: o.invoiceId, to: o.userEmail });
    } catch (e) {
      await ref.update({ receiptError: String(e.message || e).substring(0, 300), receiptClaimedAt: FieldValue.delete() });
      logger.error("Receipt failed", { invoiceId: o.invoiceId, msg: e.message });
    }
  }
);

// ✉️ إيميل جماعي لمسجلي ورشة — للأدمن فقط. {name} بيتبدّل باسم الطالب
exports.adminWorkshopEmail = onRequest(
  { region: "us-central1", secrets: [SMTP_PASS], timeoutSeconds: 540 },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const admin = await verifyToken(req);
    if (!(await isAdmin(admin))) { res.status(403).json({ error: "للأدمن فقط" }); return; }

    const { workshopId, subject, message, test } = req.body || {};
    const subj = String(subject || "").trim().substring(0, 150);
    const msg = String(message || "").trim().substring(0, 5000);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(workshopId || ""))) { res.status(400).json({ error: "ورشة غير صحيحة" }); return; }
    if (!subj || !msg) { res.status(400).json({ error: "العنوان والنص مطلوبان" }); return; }
    const ws = await db.collection("workshops").doc(workshopId).get();
    if (!ws.exists) { res.status(404).json({ error: "الورشة غير موجودة" }); return; }
    const wsTitle = ws.data().title || "";

    const regs = (await db.collection("workshop_registrations").where("workshopId", "==", workshopId).get()).docs.map((d) => d.data());
    const seen = new Set();
    let targets = regs.filter((r) => {
      const e = String(r.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || seen.has(e)) return false;
      seen.add(e); return true;
    });
    const noEmail = regs.length - targets.length;
    // تجربة ← لإيميل الأدمن فقط، باسم أول مسجّل
    if (test) targets = [{ name: targets[0]?.name || "اسم الطالب", email: admin.email }];

    let sent = 0; const failed = [];
    for (const r of targets) {
      const body = msg.replace(/\{name\}/g, r.name || "");
      try {
        await sendMail(r.email, subj.replace(/\{name\}/g, r.name || ""), wsTitle, `<div style="white-space:pre-line">${escMail(body)}</div>`, body);
        sent++;
      } catch (e) {
        failed.push(r.email);
        logger.warn("Workshop email failed", { workshopId, to: r.email, msg: e.message });
      }
    }
    if (!test) {
      await db.collection("workshop_emails").add({ workshopId, subject: subj, message: msg, sent, failed, noEmail, by: admin.email, createdAt: FieldValue.serverTimestamp() });
    }
    logger.info("Workshop email", { workshopId, test: !!test, sent, failed: failed.length, by: admin.email });
    res.status(200).json({ success: true, sent, failed: failed.length, noEmail: test ? 0 : noEmail });
  }
);

// ─────────────────────────────────────────────
// 🧮 الأدوات المتقدمة (حفظ وتصدير الحاسبات) — صلاحية بتنفتح بعد شراء المنتج products/tools-pro
// entitlements/{uid} للقراءة فقط من المستخدم؛ الكتابة من السيرفر بس
// ─────────────────────────────────────────────
const TOOLS_PRO_ID = "tools-pro";
exports.grantToolsPro = onDocumentWritten(
  { document: "orders/{orderId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after || !after.userId) return;
    const hasPro = (after.items || []).some((i) => i.col === "products" && i.id === TOOLS_PRO_ID);
    if (!hasPro || before?.status === after.status) return;
    const ref = db.collection("entitlements").doc(after.userId);
    if (after.status === "paid") {
      await ref.set({ toolsPro: true, toolsProInvoice: after.invoiceId, toolsProSince: FieldValue.serverTimestamp() }, { merge: true });
      logger.info("Tools Pro granted", { uid: after.userId, invoiceId: after.invoiceId });
    } else if (before?.status === "paid" && ["revoked", "failed"].includes(after.status)) {
      await ref.set({ toolsPro: false, toolsProRevokedAt: FieldValue.serverTimestamp() }, { merge: true });
      logger.info("Tools Pro revoked", { uid: after.userId, invoiceId: after.invoiceId });
    }
  }
);

// ─────────────────────────────────────────────
// 🎟️ المشتري بينضاف تلقائياً لمسجلي الورشة المربوطة بالعنصر (الحقل workshopId بالعنصر)
// ─────────────────────────────────────────────
exports.registerWorkshopBuyer = onDocumentWritten(
  { document: "orders/{orderId}", region: "us-central1" },
  async (event) => {
    const after = event.data?.after?.data();
    const before = event.data?.before?.data();
    if (!after || after.status !== "paid" || before?.status === "paid") return;
    for (const it of after.items || []) {
      if (!it.col || !it.id) continue;
      const item = (await db.collection(it.col).doc(it.id).get()).data() || {};
      const wid = String(item.workshopId || "");
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(wid)) continue;
      const ws = (await db.collection("workshops").doc(wid).get()).data();
      if (!ws) continue;
      const key = after.userMobile || ("e" + crypto.createHash("sha1").update(String(after.userEmail || after.invoiceId)).digest("hex").slice(0, 14));
      await db.collection("workshop_registrations").doc(`${wid}__${key}`).set({
        workshopId: wid, workshopTitle: ws.title || "", name: after.buyerName || String(after.userEmail || "").split("@")[0],
        phone: after.userMobile || "", email: after.userEmail || "", uid: after.userId || "", country: "", major: "",
        paid: true, invoiceId: after.invoiceId, amount: Number(after.total) || 0, timestamp: FieldValue.serverTimestamp(),
      }, { merge: true });
      logger.info("Workshop buyer registered", { wid, invoiceId: after.invoiceId });
    }
  }
);

// ─────────────────────────────────────────────
// 🎬 محاضرات الورشة/الدورة المدفوعة — للمشتري بس
// private_files/{col}__{id}.lessons = [{title, desc, video, files:[{name,url}]}] و allowEmails = [...]
// الصلاحية: أدمن، أو إيميل مؤكَّد بقائمة المسموح لهم، أو طلب مدفوع فيه العنصر (بالحساب أو الإيميل المؤكَّد أو رابط الطلب الخاص)
// ─────────────────────────────────────────────
function lessonVideo(url = "") {
  const u = String(url);
  const yt = (u.match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([\w-]{11})/) || [])[1];
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1`;
  const d = (u.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/) || [])[1];
  if (d) return `https://drive.google.com/file/d/${d}/preview`;
  const v = (u.match(/vimeo\.com\/(?:video\/)?(\d+)/) || [])[1];
  if (v) return `https://player.vimeo.com/video/${v}`;
  return /^https:\/\//.test(u) ? u : "";
}
async function hasPaidItem(col, id, { user, invoiceId, key }) {
  const has = (o) => o && o.status === "paid" && (o.items || []).some((i) => i.col === col && i.id === id);
  if (invoiceId && key) {
    const o = (await db.collection("orders").doc(String(invoiceId).substring(0, 80)).get()).data();
    if (o && keyOk(o, key) && has(o)) return true;
  }
  if (!user) return false;
  const byUid = await db.collection("orders").where("userId", "==", user.uid).limit(100).get();
  if (byUid.docs.some((d) => has(d.data()))) return true;
  if (user.email && user.email_verified) {
    const byEmail = await db.collection("orders").where("userEmail", "==", user.email.toLowerCase()).limit(100).get();
    if (byEmail.docs.some((d) => has(d.data()))) return true;
  }
  return false;
}
exports.getLessons = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const { col, id, invoiceId, key, code } = req.body || {};
    if (!SELLABLE.includes(String(col)) || !/^[A-Za-z0-9_-]{1,64}$/.test(String(id || ""))) { res.status(400).json({ error: "عنصر غير صحيح" }); return; }
    const user = await verifyToken(req);
    const itemSnap = await db.collection(col).doc(id).get();
    if (!itemSnap.exists) { res.status(404).json({ error: "غير موجود" }); return; }
    const item = itemSnap.data();
    const priv = (await db.collection("private_files").doc(`${col}__${id}`).get()).data() || {};
    const email = String((user && user.email) || "").toLowerCase();
    // 🔑 كود الدخول (من لوحة التحكم) — مقارنة بدون فرق أحرف كبيرة/صغيرة أو مسافات
    const norm = (c) => String(c || "").trim().toLowerCase();
    let codeOk = false;
    if (code && norm(priv.accessCode).length >= 4) {
      const A = Buffer.from(norm(priv.accessCode)), B = Buffer.from(norm(code).substring(0, 100));
      codeOk = A.length === B.length && crypto.timingSafeEqual(A, B);
      if (!codeOk) { logger.warn("Wrong access code", { col, id }); await new Promise((r) => setTimeout(r, 1200)); }
    }
    const allowed = codeOk || (user && await isAdmin(user)) ||
      (!!email && user.email_verified === true && (priv.allowEmails || []).map((e) => String(e).toLowerCase()).includes(email)) ||
      await hasPaidItem(col, id, { user, invoiceId, key });
    const head = { title: item.title || item.name || "", emoji: item.emoji || "🎓", signedIn: !!user, email, hasCode: norm(priv.accessCode).length >= 4, codeWrong: !!code && !codeOk };
    if (!allowed) { res.status(403).json({ ...head, error: "غير مصرح" }); return; }
    const lessons = (Array.isArray(priv.lessons) ? priv.lessons : []).map((l) => ({
      title: String(l.title || "").substring(0, 200),
      desc: String(l.desc || "").substring(0, 3000),
      video: lessonVideo(l.video),
      files: (Array.isArray(l.files) ? l.files : []).filter((f) => /^https?:\/\//.test(f.url || "")).map((f) => ({ name: String(f.name || "ملف").substring(0, 120), url: f.url })),
    }));
    logger.info("Lessons opened", { col, id, by: email || (invoiceId ? "order-link" : "?") });
    res.status(200).json({ ...head, lessons, fileUrl: /^https?:\/\//.test(priv.fileUrl || "") ? priv.fileUrl : "", message: String(priv.message || "") });
  }
);
