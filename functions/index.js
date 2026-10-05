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

function isAdmin(user) {
  return !!user && user.email_verified === true && ADMINS.includes(user.email || "");
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
    let fileUrl = "";
    if (item.col && item.id) {
      const priv = await db.collection("private_files").doc(`${item.col}__${item.id}`).get();
      fileUrl = (priv.exists && priv.data().fileUrl) || "";
      if (!fileUrl) {
        const pub = await db.collection(item.col).doc(item.id).get();
        fileUrl = (pub.exists && pub.data().fileUrl) || "";
      }
    }
    return { name: item.name, emoji: item.emoji || "📦", fileUrl };
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

const COUNTRIES = {
  "970": ["PS", "Palestine"], "972": ["PS", "Palestine"], "962": ["JO", "Jordan"], "966": ["SA", "Saudi Arabia"],
  "20": ["EG", "Egypt"], "971": ["AE", "United Arab Emirates"], "974": ["QA", "Qatar"], "965": ["KW", "Kuwait"],
  "90": ["TR", "Turkey"], "1": ["US", "United States"], "44": ["GB", "United Kingdom"], "49": ["DE", "Germany"],
};
function countryOf(mobile) {
  for (const len of [3, 2, 1]) { const c = COUNTRIES[mobile.slice(0, len)]; if (c) return c; }
  return ["PS", "Palestine"];
}

// عنوان المستلم عند Togo — بنعيد استخدامه لنفس الرقم
async function togoReceiver(user, mobile, name, city) {
  const userRef = db.collection("users").doc(user.uid);
  const cached = (await userRef.get()).data()?.togoReceivers?.[mobile];
  if (cached) return cached;
  const [code, country] = countryOf(mobile);
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
  { secrets: [TOGO_API_KEY], region: "us-central1" },
  async (req, res) => {
    if (req.method === "OPTIONS") { setCORS(req, res); res.status(204).send(""); return; }
    if (req.method !== "POST") { errorPage(res, 405, "طريقة الطلب غير مسموحة"); return; }

    const q = req.body || {};
    const user = await verifyIdToken(String(q.token || ""));
    if (!user) { errorPage(res, 401, "انتهت الجلسة — سجّل الدخول وحاول مرة أخرى"); return; }
    if (!user.email) { errorPage(res, 400, "حسابك بدون بريد إلكتروني — سجّل الدخول بحساب فيه بريد"); return; }

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

    const total = Math.round(items.reduce((s, i) => s + i.price, 0) * 100) / 100;
    const customerName = String(q.name || user.name || "عميل 3ENG.s").substring(0, 80);
    const invoiceId =
      "3ENGS-" + Date.now() + "-" +
      Math.random().toString(36).substring(2, 11).toUpperCase();
    const back = RETURN_BASE + "?invoice_id=" + encodeURIComponent(invoiceId);

    let togoOrderId, hashedId, created;
    try {
      const receiverId = await togoReceiver(user, mobile, customerName, city);
      created = await togo("POST", "/actions", {
        event: "Create_Visa",
        data: {
          type: "RFP",
          value: total,
          currency: CURRENCY,
          receiver_address_id: receiverId,
          receiver_email: user.email,
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
      errorPage(res, 502, "تعذر الاتصال ببوابة الدفع حالياً. حاول بعد قليل أو تواصل معنا عبر واتساب.");
      return;
    }
    if (!hashedId || !togoOrderId) {
      logger.error("Togo create: missing ids", { invoiceId, body: clip(created) });
      errorPage(res, 502, "تعذر تجهيز صفحة الدفع. تواصل معنا عبر واتساب مع رقم الطلب: " + invoiceId);
      return;
    }

    await db.collection("orders").doc(invoiceId).set({
      invoiceId,
      userId:        user.uid,
      userEmail:     user.email || "",
      userMobile:    mobile,
      items,
      total,
      currency:      CURRENCY,
      status:        "pending",
      method:        "togo",
      togoOrderId:   String(togoOrderId),
      togoHashedId:  String(hashedId),
      togoCreate:    clip(created.data || created),
      createdAt:     FieldValue.serverTimestamp(),
    });

    logger.info("Order created (Togo)", { invoiceId, total, togoOrderId });
    const payUrl = `https://api.togo.ps/api/v1/direct-pay?orderId=${encodeURIComponent(hashedId)}&receiverEmail=${encodeURIComponent(user.email)}`;
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
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { invoiceId } = req.body || {};
    if (!invoiceId || typeof invoiceId !== "string") {
      res.status(400).json({ error: "invoice_id مطلوب" }); return;
    }

    const orderRef  = db.collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

    let order = orderSnap.data();
    if (order.userId !== user.uid && !isAdmin(user)) { res.status(403).json({ error: "غير مصرح" }); return; }

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
    if (!isAdmin(user)) { res.status(403).json({ error: "للأدمن فقط" }); return; }
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
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { invoiceId } = req.body || {};
    if (!invoiceId || typeof invoiceId !== "string") {
      res.status(400).json({ error: "invoice_id مطلوب" }); return;
    }

    const snap = await db.collection("orders").doc(invoiceId).get();
    if (!snap.exists) { res.status(404).json({ error: "غير موجود" }); return; }

    const order = snap.data();
    if (order.userId !== user.uid && !isAdmin(user)) {
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

    const admin = isAdmin(user) && req.body?.all === true;
    // طلبات المستخدم تُرتّب هنا بدل orderBy — عشان ما نحتاج composite index
    const q = admin
      ? db.collection("orders").orderBy("createdAt", "desc").limit(200)
      : db.collection("orders").where("userId", "==", user.uid).limit(100);

    const snap = await q.get();
    const docs = admin ? snap.docs : [...snap.docs]
      .filter((d) => d.data().status !== "pending")
      .sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
    const orders = await Promise.all(docs.map(async (doc) => {
      const o = doc.data();
      if (admin) {
        return {
          ...publicOrder(o, []),
          userEmail:     o.userEmail || "",
          userMobile:    o.userMobile || "",
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
    if (!isAdmin(user)) { res.status(403).json({ error: "للأدمن فقط" }); return; }

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
    if (!isAdmin(admin)) { res.status(403).json({ error: "للأدمن فقط" }); return; }

    const { email, items: refs, method, amountPaid, note } = req.body || {};
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      res.status(400).json({ error: "بريد الزبون غير صحيح" }); return;
    }
    if (!Array.isArray(refs) || !refs.length || refs.length > 30) {
      res.status(400).json({ error: "اختر عنصراً واحداً على الأقل" }); return;
    }

    let buyer;
    try {
      buyer = await getAuth().getUserByEmail(cleanEmail);
    } catch (e) {
      res.status(404).json({ error: "هذا البريد غير مسجّل بالموقع — اطلب من الزبون يعمل حساب أولاً" });
      return;
    }

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
      userId:       buyer.uid,
      userEmail:    buyer.email || cleanEmail,
      userMobile:   "",
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

    logger.info("Manual order created", { invoiceId, by: admin.email, buyer: buyer.email, total });
    res.status(200).json({ success: true, invoiceId, buyer: buyer.email, items: items.length, total });
  }
);

// ─────────────────────────────────────────────
// 📧 الإيميلات — عبر Gmail (Google Workspace) من info@3engs.com
// كلمة مرور التطبيق في Secret Manager:
//   firebase functions:secrets:set SMTP_PASS --project engs-website
// ─────────────────────────────────────────────
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const SMTP_PASS = defineSecret("SMTP_PASS");
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
function buildReceipt(o, tpl, name) {
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
<p>📦 مشترياتك جاهزة الآن في حسابك: <a href="${SITE}/?myorders=1" style="color:#D97706;font-weight:bold">افتح مشترياتي</a></p>
${para(tpl.receiptFooter)}
<p style="font-size:13px;color:#64748b">↩️ يمكنك طلب الاسترداد خلال 7 أيام حسب <a href="${SITE}/privacy.html#refund" style="color:#D97706">سياسة الاسترداد</a>.</p>`;
  const text = `${fill(tpl.receiptIntro)}\n\nرقم الطلب: ${o.invoiceId}\nالتاريخ: ${paidAt}\n${(o.items || []).map((i) => `- ${i.name}: $${Number(i.price || 0).toFixed(2)}`).join("\n")}\nالإجمالي: ${total}\nمشترياتك: ${SITE}/?myorders=1\n\n${fill(tpl.receiptFooter)}`;
  return { subject: fill(tpl.receiptSubject).substring(0, 200), title: fill(tpl.receiptTitle), inner, text };
}

// 🧪 إيصال تجريبي لإيميل الأدمن — لمعاينة النص المحفوظ
exports.adminTestReceipt = onRequest(
  { region: "us-central1", secrets: [SMTP_PASS] },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    const admin = await verifyToken(req);
    if (!isAdmin(admin)) { res.status(403).json({ error: "للأدمن فقط" }); return; }
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
    const r = buildReceipt(o, await receiptTemplate(), await buyerName(o.userEmail));
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
    if (!isAdmin(admin)) { res.status(403).json({ error: "للأدمن فقط" }); return; }

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
