# 🔒 إعداد Webhook لـ Crosspay — دليل كامل

## 🏗️ المعمارية الآمنة

```
المستخدم يضغط "ادفع"
        ↓
createPayment (Function)
  → يحفظ order: status="pending"
  → يبني paymentUrl بـ apiKey (مخفي)
  → يرجع paymentUrl للموقع
        ↓
المستخدم يُحوَّل لـ Crosspay
        ↓
يدفع على Crosspay
        ↓
Crosspay يرسل POST لـ crosspayWebhook
  → يتحقق من secret
  → يحدّث order: status="paid"
  → يضيف downloadLinks
        ↓
Crosspay يحوّل المستخدم لـ payment-success.html
        ↓
payment-success.html
  → يستدعي getOrderStatus كل 3 ثواني
  → لما يصير "paid" → يعرض روابط التحميل
```

---

## 📋 خطوة 1 — نشر الـ Functions

```bash
# في مجلد المشروع
firebase deploy --only functions
```

بعد النشر ستحصل على URL الـ Webhook:
```
https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook
```

احفظ هذا الرابط — ستحتاجه في الخطوة التالية.

---

## 📋 خطوة 2 — إنشاء Webhook Secret

الـ secret هو كلمة سر يُرسلها Crosspay في كل Webhook
لكي تتحقق إن الطلب حقيقي من Crosspay

أنشئ كلمة سر عشوائية قوية، مثلاً:
```
3engs-wh-2024-xK9mP3qRvL8nT5
```

أضفها لـ Firebase:
```bash
firebase functions:config:set crosspay.webhook_secret="3engs-wh-2024-xK9mP3qRvL8nT5"
```

---

## 📋 خطوة 3 — إعداد Webhook في Crosspay

1. روح: https://dashboard.lahza.io/ (أو Crosspay Dashboard)
2. Settings ← Webhooks ← Add Webhook
3. أدخل:
   - **URL:** `https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook`
   - **Secret:** `3engs-wh-2024-xK9mP3qRvL8nT5` (نفس الـ secret أعلاه)
   - **Events:** تأكيد الدفع (payment.success أو ما يوفره Crosspay)
4. احفظ

---

## 📋 خطوة 4 — إضافة Webhook URL لـ Crosspay Return

في إعدادات Crosspay، أضف:
- **Return URL:** `https://www.3engs.com/payment-success.html`

---

## 📋 خطوة 5 — إعداد Environment Variables كاملة

```bash
# API Key الخاص بك
firebase functions:config:set crosspay.api_key="0ff3cb-79664f-a86bf6-62a897-e00517"

# api_data ثابتة من Crosspay
firebase functions:config:set crosspay.api_data="82e4b4fd3a16ad99229af9911ce8e6d2"

# العملة
firebase functions:config:set crosspay.currency="USD"

# Webhook Secret (أنشأته في الخطوة 2)
firebase functions:config:set crosspay.webhook_secret="3engs-wh-2024-xK9mP3qRvL8nT5"

# صفحة النجاح
firebase functions:config:set crosspay.return_base="https://www.3engs.com/payment-success.html"

# تحقق من كل القيم
firebase functions:config:get
```

---

## 📋 خطوة 6 — إعادة النشر

```bash
firebase deploy --only functions
```

---

## ✅ اختبار الـ Webhook

### أولاً: اختبار يدوي بـ curl

```bash
curl -X POST \
  https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: 3engs-wh-2024-xK9mP3qRvL8nT5" \
  -d '{
    "invoice_id": "3ENGS-TEST-123",
    "is_paid": "1",
    "transaction_id": "TEST-TXN-456"
  }'
```

الرد يجب أن يكون: `ok`

### ثانياً: اختبار كامل

1. أضف منتجاً للسلة
2. اضغط "الدفع الإلكتروني"
3. في Crosspay، استخدم بطاقة تجريبية:
   - `4111 1111 1111 1111`
   - Exp: أي تاريخ مستقبلي
   - CVV: `123`
4. بعد الدفع، يُفترض:
   - ✅ Crosspay يرسل Webhook → Function تحدّث `status: "paid"`
   - ✅ Crosspay يحوّلك لـ `payment-success.html`
   - ✅ الصفحة تعرض روابط التحميل

### ثالثاً: تحقق في Firebase Console

```
Firestore → orders → {invoiceId}
```

يجب أن يظهر:
```json
{
  "status": "paid",
  "transactionId": "TXN-...",
  "downloadReady": true,
  "paidAt": "...",
  "downloadLinks": [...]
}
```

---

## 🐛 حل المشاكل

### الـ Webhook لا يصل
- تأكد من URL صحيح (بدون مسافات)
- تأكد إن الـ Function نُشرت بنجاح
- راجع Firebase Console ← Functions ← Logs

### "Unauthorized" في الـ Webhook
- تأكد إن الـ webhook_secret في Firebase يطابق ما أدخلته في Crosspay
- ```bash
  firebase functions:config:get
  ```

### الطلب لا يتحدث لـ "paid"
- راجع Logs في Firebase Console
- تأكد إن `invoice_id` في الـ Webhook يطابق ما حفظته في Firestore

### Payment-success تبقى في "جاري التحقق"
- الـ Webhook لم يصل بعد (طبيعي يأخذ ثواني)
- إذا مر أكثر من دقيقة، تحقق من Firebase Logs

---

## 📊 متابعة الطلبات في Firebase Console

**Firebase Console ← Firestore ← orders**

| الحالة | المعنى |
|--------|--------|
| `pending` | تم إنشاء الطلب، ينتظر الدفع |
| `paid` | ✅ تم الدفع وتأكيده من Webhook |
| `failed` | ❌ فشل الدفع |

---

## 🔒 ملخص الأمان

✅ `apiKey` في Firebase Config فقط (ليس في أي كود)
✅ Webhook مُحمي بـ `webhook_secret`
✅ `orders` لا يمكن كتابتها من client
✅ روابط التحميل تظهر فقط بعد تأكيد Webhook
✅ كل طلب مرتبط بـ `userId` المستخدم
✅ المستخدم يرى طلباته فقط (ليس طلبات الآخرين)
