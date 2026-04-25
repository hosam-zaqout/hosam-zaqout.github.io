# 🚀 دليل الإعداد الكامل لموقع 3ENG.s

السلام عليكم حسام! هاد دليل خطوة بخطوة لإعداد الموقع بشكل كامل.

---

## 📁 الملفات الموجودة

```
/outputs/
├── index.html              ← الصفحة الرئيسية
├── admin.html              ← لوحة التحكم
├── auth.html               ← صفحة تسجيل الدخول
├── payment-success.html    ← صفحة نجاح الدفع (مهمة لـ Lahza)
├── sitemap.xml             ← خريطة الموقع لـ Google
├── robots.txt              ← تعليمات لمحركات البحث
└── logo.jpg                ← الشعار
```

---

## 🔥 1. إعدادات Firebase الإلزامية

### أ) Firestore Rules
روح: **Firebase Console ← Firestore Database ← Rules**

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // قراءة عامة للجميع
    match /{document=**} {
      allow read: if true;
    }

    // الكتابة للمسجلين فقط
    match /contact_messages/{doc} {
      allow create: if true;
    }
    match /newsletter_subscribers/{doc} {
      allow create: if true;
    }
    match /users/{userId} {
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    match /orders/{orderId} {
      allow create: if request.auth != null;
      allow read: if request.auth != null;
    }

    // المحتوى للأدمن فقط
    match /products/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /courses/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /books/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /projects/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /testimonials/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /custom_sections/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /section_items/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
    match /site_config/{doc} { allow write: if request.auth != null && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']; }
  }
}
```

### ب) Firebase Storage Rules
روح: **Firebase Console ← Storage ← Rules**

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // قراءة عامة
    match /{allPaths=**} {
      allow read: if true;
    }

    // رفع للأدمن فقط
    match /{folder}/{file} {
      allow write: if request.auth != null
        && request.auth.token.email in ['hosam2564491@gmail.com', 'info@3engs.com']
        && request.resource.size < 100 * 1024 * 1024;  // 100MB max
    }
  }
}
```

### ج) تفعيل طرق التسجيل
**Firebase Console ← Authentication ← Sign-in method**

- ✅ Email/Password → Enable
- ✅ Google → Enable

### د) Authorized Domains
**Authentication ← Settings ← Authorized domains**

أضف:
- `localhost`
- `3engs.com`
- `www.3engs.com`
- نطاق Hosting الخاص بك

---

## 💳 2. إعداد Lahza للدفع

### أ) إنشاء الحساب
1. روح: https://dashboard.lahza.io/
2. سجل حسابك
3. اطلب تفعيل الحساب (Live Mode) من فريقهم

### ب) الحصول على المفاتيح
**Dashboard ← Settings ← API Keys**

سيظهر لك:
- **Public Key:** يبدأ بـ `pk_live_...` أو `pk_test_...`
- **Secret Key:** ⚠️ لا تشاركه أبداً

### ج) إعدادات Lahza في Dashboard
- **Callback URL:** `https://3engs.com/payment-success.html`
- **Webhook URL:** (اختياري لاحقاً)
- **Domain:** أضف نطاق موقعك

### د) الإعداد في لوحة الأدمن
روح: **admin.html ← إعدادات الدفع ← Lahza**
- ✅ تفعيل
- Public Key: الصق مفتاحك
- العملة: ILS / USD / JOD
- Mode: Test (للاختبار) → Live (للمباشر)
- Callback: `https://3engs.com/payment-success.html`

---

## 🔍 3. SEO وظهور الشعار في Google

### أ) Google Search Console
1. روح: https://search.google.com/search-console
2. أضف موقعك: `https://www.3engs.com`
3. اختر طريقة التحقق: **HTML tag**
4. انسخ الكود (يبدأ بـ `<meta name="google-site-verification" ...`)
5. خد الجزء بعد `content="..."` (مثلاً: `abc123xyz...`)
6. الصقه في: **admin.html ← SEO ← Google Search Console Verification Code**

### ب) رفع sitemap.xml
1. ارفع ملف `sitemap.xml` و `robots.txt` لجذر الموقع
2. في Search Console: **Sitemaps ← Add → `sitemap.xml`**

### ج) Google Business Profile
1. روح: https://business.google.com
2. أنشئ ملف لـ "3ENG.s"
3. أضف الشعار، الوصف، الموقع، رقم الهاتف
4. هاد بيخلي الشعار يظهر في نتائج البحث

### د) JSON-LD Schema (موجود تلقائياً في الموقع)
الموقع يحتوي على Schema للـ Organization تلقائياً.

### هـ) SEO في لوحة الأدمن
روح: **admin.html ← SEO و Search**
- العنوان: "3ENG.s | المنصة الأولى للهندسة الكهربائية في فلسطين"
- الوصف: 150-160 حرف
- الكلمات المفتاحية
- صورة Open Graph (1200×630 px)

---

## 🔒 4. SSL Certificate

### إذا تستخدم Firebase Hosting:
- SSL مجاني تلقائياً ✅

### إذا تستخدم استضافة أخرى:
1. **Cloudflare (مجاني):**
   - سجل في Cloudflare
   - أضف نطاقك
   - غير DNS Nameservers
   - فعّل SSL: Always Use HTTPS

2. **Hostinger / غيرها:**
   - عادةً يوفروا Let's Encrypt مجاناً
   - فعّله من Control Panel

---

## 📤 5. رفع الموقع

### الخيار الأسهل: Firebase Hosting
```bash
npm install -g firebase-tools
firebase login
firebase init hosting
# اختر: engs-website
# Public dir: . (نقطة)
firebase deploy
```

### الخيار البديل: Hostinger / Cpanel
- ارفع كل الملفات بالـ FTP لمجلد `public_html`

---

## 🎯 6. اختبار شامل بعد الرفع

### قائمة التحقق:
- [ ] الموقع يفتح بـ https:// (SSL يعمل)
- [ ] تسجيل دخول بـ Google يعمل
- [ ] تسجيل دخول بإيميل يعمل
- [ ] لوحة الأدمن تفتح للحسابات الإدارية فقط
- [ ] إضافة منتج جديد + رفع صورة + رفع ملف ZIP
- [ ] إضافة دورة جديدة + ماذا ستتعلم + المحاور
- [ ] إضافة مشروع جديد + فيديو يوتيوب
- [ ] إضافة كتاب + رفع PDF
- [ ] السلة تشتغل
- [ ] أزرار الدفع تظهر (Lahza, PayPal, واتساب)
- [ ] Lahza Test Mode: ادفع بـ بطاقة وهمية
- [ ] الـ Light Mode / Dark Mode / Default يبدلوا
- [ ] الموقع responsive على الموبايل
- [ ] عرض المنتجات والمشاريع - يتم تحميل الصور
- [ ] رسائل التواصل تصل لـ Firestore
- [ ] الاشتراك في النشرة يشتغل

### اختبار SEO:
- [ ] افتح: https://search.google.com/test/rich-results — لاختبار Schema
- [ ] افتح: https://developers.facebook.com/tools/debug/ — لاختبار OG
- [ ] افتح: https://www.opengraph.xyz/ — معاينة المشاركة

---

## 🐛 مشاكل شائعة

### "auth/operation-not-allowed"
✅ الحل: فعّل Email/Password في Firebase Console

### الملفات لا تُرفع
✅ تأكد من Storage Rules
✅ تأكد إنك مسجل دخول كأدمن

### Lahza لا تفتح
✅ تأكد إنك حاطط Public Key (مش Secret)
✅ تأكد إن النطاق مضاف في Lahza Dashboard

### الصور لا تظهر
✅ تأكد إن Storage مفعّل
✅ تحقق من Storage Rules (read: if true)

### الموقع بطيء
✅ فعّل Cloudflare (تخزين مؤقت)
✅ ضغط الصور قبل الرفع

---

## 📞 الدعم

أي مشكلة، تواصل معي وأنا جاهز للمساعدة! 🚀

---
**صُنع بـ ❤️ لحسام و 3ENG.s**
