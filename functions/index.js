"use strict";

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

const CROSSPAY_API_KEY = defineSecret("CROSSPAY_API_KEY");

const API_DATA    = "82e4b4fd3a16ad99229af9911ce8e6d2";
const CURRENCY    = "USD";
const SITE        = "https://www.3engs.com";
const RETURN_BASE = SITE + "/payment-success.html";
const ADMINS      = ["hosam2564491@gmail.com", "info@3engs.com"];

const ENDPOINTS = {
  card:   "https://crosspayonline.com/api/createInvoiceByAccountPaySky",
  paypal: "https://crosspayonline.com/api/createInvoiceByAccountPaypal",
};

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
// 1. createPayment — HTML form POST ← redirect 302 إلى Crosspay
// Body: token, items=[{col,id}], mobile, name, provider=card|paypal
// الأسعار تُقرأ من Firestore — لا نثق بأي سعر من المتصفح
// ─────────────────────────────────────────────
exports.createPayment = onRequest(
  { secrets: [CROSSPAY_API_KEY], region: "us-central1" },
  async (req, res) => {
    if (req.method === "OPTIONS") { setCORS(req, res); res.status(204).send(""); return; }
    if (req.method !== "POST") { errorPage(res, 405, "طريقة الطلب غير مسموحة"); return; }

    const q = req.body || {};
    const user = await verifyIdToken(String(q.token || ""));
    if (!user) { errorPage(res, 401, "انتهت الجلسة — سجّل الدخول وحاول مرة أخرى"); return; }

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

    const payCfg = await getPaymentConfig();
    const provider = q.provider === "paypal" ? "paypal" : "card";
    if (provider === "paypal" && !payCfg.crosspayPaypal?.active) {
      errorPage(res, 400, "الدفع عبر PayPal غير مفعّل حالياً"); return;
    }

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

    const invDetails = {
      inv_items: items.map((i) => ({
        name:       i.name,
        quntity:    "1.00",
        unitPrice:  i.price.toFixed(2),
        totalPrice: i.price.toFixed(2),
        currency:   CURRENCY,
      })),
      inv_info: [
        { row_title: "Vat",       row_value: "0" },
        { row_title: "Delevery",  row_value: "0" },
        { row_title: "Discounts", row_value: "0" },
      ],
      user: { userName: customerName },
    };

    const params = new URLSearchParams({
      api_data:    API_DATA,
      invoice_id:  invoiceId,
      apiKey:      CROSSPAY_API_KEY.value(),
      total:       total.toFixed(2),
      currency:    CURRENCY,
      inv_details: JSON.stringify(invDetails),
      return_url:  RETURN_BASE + "?invoice_id=" + encodeURIComponent(invoiceId),
      email:       user.email || "",
      mobile:      mobile,
      mobail:      mobile, // Crosspay يستخدم الاسمين بحسب الـ endpoint
      name:        customerName,
    });

    await db.collection("orders").doc(invoiceId).set({
      invoiceId,
      userId:        user.uid,
      userEmail:     user.email || "",
      userMobile:    mobile,
      items,
      total,
      currency:      CURRENCY,
      status:        "pending",
      method:        provider === "paypal" ? "crosspay-paypal" : "paysky",
      createdAt:     FieldValue.serverTimestamp(),
    });

    logger.info("Order created", { invoiceId, total, provider });
    res.redirect(302, ENDPOINTS[provider] + "?" + params.toString());
  }
);

// ─────────────────────────────────────────────
// 2. verifyPayment — من payment-success.html بعد الرجوع من Crosspay
//
// ⚠️ Crosspay لا يوفّر API للتحقق من حالة الفاتورة، فالنتيجة تأتي
// من رابط الرجوع (is_paid). لذلك:
//  - الطلب يتحول مرة واحدة فقط، ولا يرجع من paid إلى failed
//  - transaction_id لا يُقبل مرتين
//  - إذا فُعّل "المراجعة اليدوية" من لوحة التحكم ← awaiting_approval
//    والأدمن يوافق بعد مطابقة الدفع مع لوحة Crosspay
// ─────────────────────────────────────────────
exports.verifyPayment = onRequest(
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const { invoiceId, isPaid, transactionId } = req.body || {};
    if (!invoiceId || typeof invoiceId !== "string") {
      res.status(400).json({ error: "invoice_id مطلوب" }); return;
    }

    const orderRef  = db.collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

    const order = orderSnap.data();
    if (order.userId !== user.uid) { res.status(403).json({ error: "غير مصرح" }); return; }

    if (order.status !== "pending" && order.status !== "failed") {
      const links = order.status === "paid" ? await resolveDownloads(order) : [];
      res.status(200).json({ success: order.status === "paid", ...publicOrder(order, links) });
      return;
    }

    if (String(isPaid) !== "1") {
      await orderRef.update({ status: "failed", updatedAt: FieldValue.serverTimestamp() });
      logger.info("Payment failed", { invoiceId });
      res.status(200).json({ success: false, status: "failed", invoiceId });
      return;
    }

    const txId = String(transactionId || "").substring(0, 120);
    if (txId) {
      const dup = await db.collection("orders").where("transactionId", "==", txId).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== invoiceId) {
        logger.warn("Duplicate transaction id", { invoiceId, txId });
        res.status(409).json({ error: "رقم العملية مستخدم مسبقاً" });
        return;
      }
    }

    const payCfg = await getPaymentConfig();
    const status = payCfg.manualApproval ? "awaiting_approval" : "paid";

    await orderRef.update({
      status,
      transactionId: txId,
      verification:  "return_url",
      returnedAt:    FieldValue.serverTimestamp(),
      ...(status === "paid" ? { paidAt: FieldValue.serverTimestamp() } : {}),
    });
    logger.info("Payment returned", { invoiceId, status, txId });

    const updated = { ...order, status };
    const links = status === "paid" ? await resolveDownloads(updated) : [];
    res.status(200).json({ success: status === "paid", ...publicOrder(updated, links) });
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
    const q = admin
      ? db.collection("orders").orderBy("createdAt", "desc").limit(200)
      : db.collection("orders").where("userId", "==", user.uid).orderBy("createdAt", "desc").limit(50);

    const snap = await q.get();
    const orders = await Promise.all(snap.docs.map(async (doc) => {
      const o = doc.data();
      if (admin) {
        return {
          ...publicOrder(o, []),
          userEmail:     o.userEmail || "",
          userMobile:    o.userMobile || "",
          method:        o.method || "",
          transactionId: o.transactionId || "",
          verification:  o.verification || "",
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
  { region: "us-central1" },
  async (req, res) => {
    setCORS(req, res);
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }

    const user = await verifyToken(req);
    if (!isAdmin(user)) { res.status(403).json({ error: "للأدمن فقط" }); return; }

    const { invoiceId, action } = req.body || {};
    if (!invoiceId || typeof invoiceId !== "string" || !["approve", "revoke"].includes(action)) {
      res.status(400).json({ error: "بيانات غير صالحة" }); return;
    }

    const ref = db.collection("orders").doc(invoiceId);
    const snap = await ref.get();
    if (!snap.exists) { res.status(404).json({ error: "الطلب غير موجود" }); return; }

    const update = action === "approve"
      ? { status: "paid", paidAt: FieldValue.serverTimestamp(), approvedBy: user.email }
      : { status: "revoked", revokedAt: FieldValue.serverTimestamp(), revokedBy: user.email };
    await ref.update(update);

    logger.info("Order updated by admin", { invoiceId, action, by: user.email });
    res.status(200).json({ success: true, invoiceId, status: update.status });
  }
);
