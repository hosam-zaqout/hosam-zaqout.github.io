/**
 * 3ENG.s — Firebase Cloud Functions v2
 * يستخدم defineSecret بدل functions.config() المهجور
 */

"use strict";

const { onCall, onRequest, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { initializeApp }    = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { URLSearchParams }  = require("url");
const logger = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// ─────────────────────────────────────────────
// Secrets — تُخزَّن في Google Secret Manager
// أضفها بالأمر: firebase functions:secrets:set CROSSPAY_API_KEY
// ─────────────────────────────────────────────
const CROSSPAY_API_KEY      = defineSecret("CROSSPAY_API_KEY");
const CROSSPAY_WEBHOOK_SECRET = defineSecret("CROSSPAY_WEBHOOK_SECRET");

// ثوابت (غير حساسة)
const API_DATA    = "82e4b4fd3a16ad99229af9911ce8e6d2";
const CURRENCY    = "USD";
const RETURN_BASE = "https://www.3engs.com/payment-success.html";
const ADMINS      = ["hosam2564491@gmail.com", "info@3engs.com"];

// ─────────────────────────────────────────────
// 1. createPayment
// ─────────────────────────────────────────────
exports.createPayment = onCall(
  { secrets: [CROSSPAY_API_KEY], region: "us-central1" },
  async (request) => {
    // تحقق من تسجيل الدخول
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول أولاً");
    }

    const { items, total, customerName, customerPhone } = request.data;

    if (!Array.isArray(items) || items.length === 0) {
      throw new HttpsError("invalid-argument", "السلة فارغة");
    }

    const totalNum = parseFloat(total);
    if (isNaN(totalNum) || totalNum <= 0) {
      throw new HttpsError("invalid-argument", "المبلغ غير صحيح");
    }

    // Invoice ID فريد
    const invoiceId =
      "3ENGS-" + Date.now() + "-" +
      Math.random().toString(36).substring(2, 11).toUpperCase();

    // بناء inv_details
    const invDetails = {
      inv_items: items.map((item) => ({
        name:       String(item.name  || "منتج").substring(0, 100),
        quntity:    "1.00",
        unitPrice:  parseFloat(item.price || 0).toFixed(2),
        totalPrice: parseFloat(item.price || 0).toFixed(2),
        currency:   CURRENCY,
      })),
      inv_info: [
        { row_title: "Vat",       row_value: "0" },
        { row_title: "Delevery",  row_value: "0" },
        { row_title: "Discounts", row_value: "0" },
      ],
      user: { userName: String(customerName || "عميل 3ENG.s").substring(0, 80) },
    };

    const returnUrl = RETURN_BASE + "?invoice_id=" + encodeURIComponent(invoiceId);

    const params = new URLSearchParams({
      api_data:    API_DATA,
      invoice_id:  invoiceId,
      apiKey:      CROSSPAY_API_KEY.value(), // ← السيرفر فقط
      total:       totalNum.toFixed(2),
      currency:    CURRENCY,
      inv_details: JSON.stringify(invDetails),
      return_url:  returnUrl,
      email:       request.auth.token.email || "",
      mobail:      String(customerPhone || ""),
      name:        String(customerName  || "عميل 3ENG.s"),
    });

    const paymentUrl =
      "https://crosspayonline.com/api/createInvoiceByAccountLahza?" +
      params.toString();

    // حفظ الطلب — status: "pending"
    await db.collection("orders").doc(invoiceId).set({
      invoiceId,
      userId:        request.auth.uid,
      userEmail:     request.auth.token.email || "",
      items: items.map((i) => ({
        name:    String(i.name    || ""),
        price:   parseFloat(i.price  || 0),
        emoji:   String(i.emoji   || ""),
        fileUrl: String(i.fileUrl || ""),
      })),
      total:         totalNum,
      currency:      CURRENCY,
      status:        "pending",
      method:        "lahza",
      downloadReady: false,
      createdAt:     FieldValue.serverTimestamp(),
    });

    logger.info("Order created:", invoiceId);
    return { success: true, invoiceId, paymentUrl };
  }
);

// ─────────────────────────────────────────────
// 2. crosspayWebhook
// URL: https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook
// ─────────────────────────────────────────────
exports.crosspayWebhook = onRequest(
  { secrets: [CROSSPAY_WEBHOOK_SECRET], region: "us-central1" },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // التحقق من هوية Crosspay
    const secret   = CROSSPAY_WEBHOOK_SECRET.value();
    const received =
      req.headers["x-webhook-secret"] ||
      req.headers["x-api-secret"]     ||
      req.body?.webhook_secret         || "";

    if (secret && received !== secret) {
      logger.warn("Webhook: rejected — invalid secret");
      res.status(401).send("Unauthorized");
      return;
    }

    const body = req.body || {};
    logger.info("Webhook received:", JSON.stringify(body));

    const invoiceId     = String(body.invoice_id     || body.order_id || "").trim();
    const isPaid        = String(body.is_paid         || body.status   || "").trim();
    const transactionId = String(body.transaction_id  || body.trx_id   || "").trim();

    if (!invoiceId) {
      res.status(200).send("ok");
      return;
    }

    const orderRef  = db.collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      logger.warn("Webhook: order not found:", invoiceId);
      res.status(200).send("ok");
      return;
    }

    const order = orderSnap.data();

    // منع المعالجة المكررة
    if (order.status === "paid") {
      res.status(200).send("ok");
      return;
    }

    const paidStatuses = ["1", "paid", "success", "completed"];

    if (paidStatuses.includes(isPaid.toLowerCase())) {
      const downloadLinks = (order.items || []).map((item) => ({
        name:    item.name,
        emoji:   item.emoji   || "📦",
        fileUrl: item.fileUrl || "",
      }));

      await orderRef.update({
        status:        "paid",
        transactionId: transactionId,
        paidAt:        FieldValue.serverTimestamp(),
        downloadReady: true,
        downloadLinks: downloadLinks,
      });

      logger.info("✅ Payment confirmed:", invoiceId, transactionId);
    } else {
      await orderRef.update({
        status:    "failed",
        updatedAt: FieldValue.serverTimestamp(),
      });
      logger.warn("❌ Payment failed:", invoiceId, isPaid);
    }

    res.status(200).send("ok");
  }
);

// ─────────────────────────────────────────────
// 3. getOrderStatus
// ─────────────────────────────────────────────
exports.getOrderStatus = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
    }

    const { invoiceId } = request.data;
    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "invoice_id مطلوب");
    }

    const orderSnap = await db.collection("orders").doc(invoiceId).get();

    if (!orderSnap.exists) {
      throw new HttpsError("not-found", "الطلب غير موجود");
    }

    const order = orderSnap.data();

    if (order.userId !== request.auth.uid) {
      throw new HttpsError("permission-denied", "غير مصرح");
    }

    return {
      invoiceId:     order.invoiceId,
      status:        order.status,
      total:         order.total,
      currency:      order.currency,
      items:         (order.items || []).map((i) => ({ name: i.name, emoji: i.emoji })),
      downloadLinks: order.status === "paid" ? (order.downloadLinks || []) : [],
      paidAt:        order.paidAt || null,
    };
  }
);

// ─────────────────────────────────────────────
// 4. getUserOrders
// ─────────────────────────────────────────────
exports.getUserOrders = onCall(
  { region: "us-central1" },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
    }

    const isAdmin = ADMINS.includes(request.auth.token.email || "");

    let q;
    if (isAdmin && request.data.all) {
      q = db.collection("orders").orderBy("createdAt", "desc").limit(200);
    } else {
      q = db.collection("orders")
        .where("userId", "==", request.auth.uid)
        .orderBy("createdAt", "desc")
        .limit(50);
    }

    const snap   = await q.get();
    const orders = [];

    snap.forEach((doc) => {
      const o = doc.data();
      orders.push({
        invoiceId:     o.invoiceId,
        status:        o.status,
        total:         o.total,
        currency:      o.currency,
        items:         (o.items || []).map((i) => ({ name: i.name, emoji: i.emoji })),
        downloadLinks: o.status === "paid" ? (o.downloadLinks || []) : [],
        createdAt:     o.createdAt?.toMillis?.() || null,
        paidAt:        o.paidAt?.toMillis?.()    || null,
      });
    });

    return { orders };
  }
);
