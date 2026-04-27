# 🚀 دليل نشر Firebase Functions - خطوة بخطوة

---

## 📁 هيكل المجلد المطلوب

```
مجلد-موقعك/
├── index.html
├── admin.html
├── auth.html
├── payment-success.html
├── logo.jpg
├── sitemap.xml
├── robots.txt
├── firebase.json          ← ملف جديد
├── firestore.rules        ← ملف جديد
└── functions/             ← مجلد جديد
    ├── index.js           ← الـ Cloud Function
    └── package.json       ← ملف جديد
```

---

## 🖥️ الخطوات على جهازك

### الخطوة 1 — تثبيت Firebase CLI

افتح **CMD** أو **PowerShell** واكتب:

```bash
npm install -g firebase-tools
```

تحقق إنه اتثبت:
```bash
firebase --version
# يجب أن يظهر: 13.x.x أو أعلى
```

---

### الخطوة 2 — تسجيل الدخول لـ Firebase

```bash
firebase login
```

سيفتح متصفح — سجل دخول بـ hosam2564491@gmail.com

---

### الخطوة 3 — إعداد المشروع

انتقل لمجلد الموقع:
```bash
cd C:\Users\اسمك\Desktop\موقع-3engs
```

ثم اربط المجلد بمشروع Firebase:
```bash
firebase use engs-website
```

إذا ما عمل جرب:
```bash
firebase projects:list
# سيظهر لك اسم المشروع — انسخه واستخدمه
firebase use engs-website
```

---

### الخطوة 4 — تثبيت Dependencies للـ Functions

```bash
cd functions
npm install
cd ..
```

---

### الخطوة 5 — إضافة الـ API Key بشكل آمن

هذه أهم خطوة! الـ API Key لا يُكتب في الكود أبداً:

```bash
firebase functions:config:set crosspay.api_key="0ff3cb-79664f-a86bf6-62a897-e00517"
firebase functions:config:set crosspay.api_data="82e4b4fd3a16ad99229af9911ce8e6d2"
```

تحقق إنهم اتحفظوا:
```bash
firebase functions:config:get
```

يجب أن يظهر:
```json
{
  "crosspay": {
    "api_key": "0ff3cb-79664f-a86bf6-62a897-e00517",
    "api_data": "82e4b4fd3a16ad99229af9911ce8e6d2"
  }
}
```

---

### الخطوة 6 — تفعيل Billing في Firebase

⚠️ **مهم:** Cloud Functions تتطلب Blaze Plan (Pay as you go)
الاستخدام المجاني كافٍ للبداية (125K function calls مجاناً/شهر)

روح: **Firebase Console ← Upgrade ← Blaze Plan**
أدخل بطاقة الائتمان (لن تُشحن إلا إذا تجاوزت الحد المجاني)

---

### الخطوة 7 — نشر كل شي

```bash
# نشر Functions فقط أول مرة للتحقق
firebase deploy --only functions

# بعد نجاحها، انشر كل شي
firebase deploy
```

انتظر 2-3 دقائق حتى تنتهي...

إذا نجحت ستظهر:
```
✔ Deploy complete!

Project Console: https://console.firebase.google.com/project/engs-website
Hosting URL: https://engs-website.web.app
```

---

### الخطوة 8 — إضافة Domain مخصص (اختياري)

في Firebase Console:
**Hosting ← Add custom domain ← www.3engs.com**

اتبع التعليمات لإضافة DNS records عند مزود الدومين.

---

## ✅ اختبار الدفع

### أولاً — اختبار في وضع التطوير

```bash
firebase emulators:start --only functions
```

### ثانياً — اختبار حقيقي

1. افتح الموقع
2. أضف منتجاً للسلة
3. افتح السلة
4. اضغط "الدفع الإلكتروني (Lahza)"
5. يجب أن تُحوَّل لصفحة Crosspay
6. أدخل بيانات بطاقة تجريبية:
   - Card: `4111 1111 1111 1111`
   - Exp: أي تاريخ مستقبلي
   - CVV: `123`
7. بعد الدفع يجب أن ترجع لـ `payment-success.html`
8. تحقق في Firebase Console ← Firestore ← orders

---

## 🐛 حل المشاكل الشائعة

### "Error: Functions not found"
```bash
# تأكد إنك في المجلد الصح
ls functions/index.js  # يجب أن يظهر الملف
```

### "Error: Billing required"
روح Firebase Console وفعّل Blaze Plan

### "CORS Error" في المتصفح
أضف هذا في أول `functions/index.js`:
```javascript
const cors = require("cors")({origin: true});
```
ثم:
```bash
cd functions && npm install cors && cd ..
firebase deploy --only functions
```

### "functions:config not found"
```bash
firebase functions:config:set crosspay.api_key="YOUR_KEY"
firebase deploy --only functions
```

### الدفع يعمل لكن الطلب لا يُحفظ في Firestore
تحقق من Firestore Rules — يجب أن تسمح للـ Cloud Function بالكتابة.

---

## 📊 متابعة الطلبات

بعد نجاح أول عملية دفع:

**Firebase Console ← Firestore ← orders**

كل طلب فيه:
```json
{
  "invoiceId": "3ENGS-1234567890-ABC123",
  "userId": "uid...",
  "userEmail": "customer@email.com",
  "items": [...],
  "total": 29.00,
  "currency": "USD",
  "status": "paid",
  "transactionId": "TXN...",
  "createdAt": "...",
  "paidAt": "..."
}
```

---

## 🔒 تذكير أمني مهم

✅ الـ API Key محفوظ في Firebase Config (آمن)
✅ الـ apiKey لا يظهر في أي ملف HTML أو JS
✅ الـ Cloud Function تتحقق من هوية المستخدم قبل الدفع
✅ الطلبات تُكتب من السيرفر فقط (ليس من المتصفح)

❌ لا تشارك الـ API Key في أي مكان عام
❌ لا تضعه في GitHub أو أي repository عام

---

**أي مشكلة — أرسل لي الخطأ وأساعدك فوراً! 🚀**
