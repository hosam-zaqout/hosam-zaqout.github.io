/**
 * 3ENG.s — Firebase Cloud Functions
 * Crosspay لا يدعم Webhook — يعمل عبر return_url
 *
 * الـ Flow الصحيح:
 * 1. createPayment  → يبني URL ويحفظ order pending
 * 2. المستخدم يدفع على Crosspay
 * 3. Crosspay يرجع المستخدم لـ payment-success.html?invoice_id=X&is_paid=1&transaction_id=Y
 * 4. verifyPayment  → يتحقق من البيانات ويحدّث الـ order
 *
 * الأمان:
 * - apiKey على السيرفر فقط (Secret Manager)
 * - verifyPayment يتحقق إن invoice_id موجود في Firestore
 * - يتحقق إن userId يطابق المستخدم الحالي
 * - لا يمكن لأحد تزوير invoice غير موجود في النظام
 */
 const { defineString } = require("firebase-functions/params");
"use strict";

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret }       = require("firebase-functions/params");
const { initializeApp }      = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { URLSearchParams }    = require("url");
const logger                 = require("firebase-functions/logger");

initializeApp();
const db = getFirestore();

// ─────────────────────────────────────────────
// Secrets — في Google Secret Manager
// أضفهم بـ: firebase functions:secrets:set CROSSPAY_API_KEY
// ─────────────────────────────────────────────
const CROSSPAY_API_KEY = defineSecret("CROSSPAY_API_KEY");

// ثوابت
const API_DATA    = "82e4b4fd3a16ad99229af9911ce8e6d2";
const CURRENCY    = "USD";
const RETURN_BASE = "https://www.3engs.com/payment-success.html";
const ADMINS      = ["hosam2564491@gmail.com", "info@3engs.com"];

// ─────────────────────────────────────────────
// 1. createPayment
//    يبني رابط Crosspay ويحفظ order بحالة pending
// ─────────────────────────────────────────────
exports.createPayment = onCall(
  cors: ["https://www.3engs.com", "https://3engs.com"]
  
  { secrets: [CROSSPAY_API_KEY], region: "us-central1" },
  async (request) => {

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

    // Invoice ID فريد وغير قابل للتخمين
    const invoiceId =
      "3ENGS-" + Date.now() + "-" +
      Math.random().toString(36).substring(2, 11).toUpperCase();

    // بناء inv_details حسب توثيق Crosspay
    const invDetails = {
      inv_items: items.map((item) => ({
        name:       String(item.name || "منتج").substring(0, 100),
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
      user: {
        userName: String(customerName || "عميل 3ENG.s").substring(0, 80),
      },
    };

    // return_url — Crosspay سيضيف: ?invoice_id=X&is_paid=1&transaction_id=Y
    const returnUrl =
      RETURN_BASE + "?invoice_id=" + encodeURIComponent(invoiceId);

    // بناء الرابط الكامل (حسب توثيق Crosspay — GET request)
    const params = new URLSearchParams({
      api_data:    API_DATA,
      invoice_id:  invoiceId,
      apiKey:      CROSSPAY_API_KEY.value(),  // ← السيرفر فقط
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

    // حفظ الطلب في Firestore — status: "pending"
    await db.collection("orders").doc(invoiceId).set({
      invoiceId,
      userId:    request.auth.uid,
      userEmail: request.auth.token.email || "",
      items: items.map((i) => ({
        name:    String(i.name    || ""),
        price:   parseFloat(i.price || 0),
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

    logger.info("Order created:", invoiceId, "for:", request.auth.token.email);
    return { success: true, invoiceId, paymentUrl };
  }
);

// ─────────────────────────────────────────────
// 2. verifyPayment
//    يُستدعى من payment-success.html
//    بعد رجوع المستخدم من Crosspay
//
//    الأمان:
//    - يتحقق إن invoiceId موجود في Firestore (أنت أنشأته)
//    - يتحقق إن userId يطابق المستخدم الحالي
//    - لو is_paid=1 → يحدّث order إلى paid
//    - لا يمكن لأحد يزوّر invoice_id لم يُنشأ من createPayment
// ─────────────────────────────────────────────
exports.verifyPayment = onCall(
  cors: ["https://www.3engs.com", "https://3engs.com"]
  { region: "us-central1" },
  async (request) => {

    if (!request.auth) {
      throw new HttpsError("unauthenticated", "يجب تسجيل الدخول");
    }

    const { invoiceId, isPaid, transactionId } = request.data;

    if (!invoiceId) {
      throw new HttpsError("invalid-argument", "invoice_id مطلوب");
    }

    // اقرأ الطلب من Firestore
    const orderRef  = db.collection("orders").doc(invoiceId);
    const orderSnap = await orderRef.get();

    // إذا ما كان موجود → رفض (لا يمكن تزوير)
    if (!orderSnap.exists) {
      logger.warn("verifyPayment: invoice not found:", invoiceId);
      throw new HttpsError("not-found", "الطلب غير موجود");
    }

    const order = orderSnap.data();

    // تأكد إن الطلب يخص هذا المستخدم
    if (order.userId !== request.auth.uid) {
      logger.warn("verifyPayment: user mismatch:", invoiceId);
      throw new HttpsError("permission-denied", "غير مصرح");
    }

    // إذا كان مدفوعاً مسبقاً → أرجع البيانات مباشرة
    if (order.status === "paid") {
      return {
        success:       true,
        status:        "paid",
        invoiceId:     order.invoiceId,
        total:         order.total,
        currency:      order.currency,
        items:         (order.items || []).map((i) => ({ name: i.name, emoji: i.emoji })),
        downloadLinks: order.downloadLinks || [],
      };
    }

    // Crosspay يرسل is_paid=1 عند النجاح
    if (String(isPaid) === "1") {

      const downloadLinks = (order.items || []).map((item) => ({
        name:    item.name,
        emoji:   item.emoji   || "📦",
        fileUrl: item.fileUrl || "",
      }));

      await orderRef.update({
        status:        "paid",
        transactionId: String(transactionId || ""),
        paidAt:        FieldValue.serverTimestamp(),
        downloadReady: true,
        downloadLinks: downloadLinks,
      });

      logger.info("✅ Payment verified:", invoiceId, transactionId);

      return {
        success:       true,
        status:        "paid",
        invoiceId:     invoiceId,
        total:         order.total,
        currency:      order.currency,
        items:         (order.items || []).map((i) => ({ name: i.name, emoji: i.emoji })),
        downloadLinks: downloadLinks,
      };

    } else {

      // is_paid=0 → فشل الدفع
      await orderRef.update({
        status:    "failed",
        updatedAt: FieldValue.serverTimestamp(),
      });

      logger.info("❌ Payment failed:", invoiceId, "is_paid:", isPaid);

      return {
        success: false,
        status:  "failed",
        invoiceId,
      };
    }
  }
);

// ─────────────────────────────────────────────
// 3. getOrderStatus
//    للتحقق من حالة طلب موجود
// ─────────────────────────────────────────────
exports.getOrderStatus = onCall(
  cors: ["https://www.3engs.com", "https://3engs.com"]
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
  cors: ["https://www.3engs.com", "https://3engs.com"]
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
