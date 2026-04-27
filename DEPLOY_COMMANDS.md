# ⚡ أوامر النشر الصحيحة — Firebase Functions v2

## المشكلة اللي صارت وحلها

| المشكلة | الحل |
|---------|------|
| `functions.config()` deprecated | استبدلناه بـ `defineSecret` |
| ESLint errors | أصلحنا الكود + شلنا lint من firebase.json |
| مسار فيه مسافة | شوف الحل أدناه |

---

## 🖥️ مشكلة المسار (مهمة لـ Windows)

المجلد عندك: `C:\Users\AL.BADER PC\functions`

المسافة في "AL.BADER PC" بتسبب مشكلة!

**الحل — انقل المجلد لمكان بدون مسافات:**

```
C:\3engs\
    ├── index.html
    ├── admin.html
    ├── firebase.json
    ├── firestore.rules
    └── functions\
        ├── index.js
        └── package.json
```

أو استخدم PowerShell مع quotes:
```powershell
cd "C:\Users\AL.BADER PC"
firebase deploy --only functions
```

---

## 📋 الأوامر الصحيحة بالترتيب

### الخطوة 1 — تثبيت dependencies

```bash
cd functions
npm install
cd ..
```

### الخطوة 2 — إضافة Secrets (الجديد — بدل config)

```bash
# API Key الخاص بك
firebase functions:secrets:set CROSSPAY_API_KEY
# سيطلب منك الإدخال — اكتب:
# 0ff3cb-79664f-a86bf6-62a897-e00517

# Webhook Secret (اختار كلمة سر عشوائية)
firebase functions:secrets:set CROSSPAY_WEBHOOK_SECRET
# سيطلب منك الإدخال — مثلاً:
# 3engs-secure-webhook-2024-xK9mP
```

### الخطوة 3 — نشر Functions فقط أولاً

```bash
firebase deploy --only functions
```

### الخطوة 4 — نشر كل شي

```bash
firebase deploy
```

---

## ✅ تحقق من نجاح النشر

بعد النشر ستظهر روابط مثل:
```
✔  functions[us-central1-createPayment]: ...deployed
✔  functions[us-central1-crosspayWebhook]: ...deployed
✔  functions[us-central1-getOrderStatus]: ...deployed
✔  functions[us-central1-getUserOrders]: ...deployed
```

انسخ رابط `crosspayWebhook`:
```
https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook
```

---

## 🔑 إعداد Secrets في Crosspay Dashboard

1. روح Crosspay Dashboard → Settings → Webhooks
2. **Webhook URL:** `https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook`
3. **Secret:** نفس ما أدخلته في `CROSSPAY_WEBHOOK_SECRET`

---

## 🧪 اختبار سريع

```bash
# اختبار الـ Webhook يدوياً
curl -X POST ^
  "https://us-central1-engs-website.cloudfunctions.net/crosspayWebhook" ^
  -H "Content-Type: application/json" ^
  -H "x-webhook-secret: كلمة-السر-اللي-اخترتها" ^
  -d "{\"invoice_id\":\"TEST-123\",\"is_paid\":\"1\",\"transaction_id\":\"TXN-456\"}"
```

الرد يجب: `ok`

---

## 🐛 مشاكل شائعة بعد التحديث

### "Secret not found"
```bash
firebase functions:secrets:set CROSSPAY_API_KEY
# أدخل: 0ff3cb-79664f-a86bf6-62a897-e00517
```

### "Cannot find module firebase-functions/v2/https"
```bash
cd functions
npm install firebase-functions@latest
cd ..
firebase deploy --only functions
```

### "ENOENT spawn npm"
انقل مجلد المشروع لمسار بدون مسافات مثل `C:\3engs\`

### ESLint errors
الـ lint شلناه من firebase.json — ما يجب تظهر هاي المشكلة مرة ثانية.
إذا ظهرت:
```bash
cd functions
npm remove eslint
cd ..
```
