# 3ENG.s — المهندسون الثلاثة (www.3engs.com)

منصة تعليمية هندسية (دورات، مشاريع، كتب، مقالات). المالك: م. حسام زقوت (hosam2564491@gmail.com). اللغة: عربي (لهجة فلسطينية بالمحادثة).

## البنية
- **هذا المجلد هو المصدر الوحيد**: `E:\3engs\website\codes\3engs-live` = مستودع `hosam-zaqout/hosam-zaqout.github.io` (فرع `main`، GitHub Pages، CNAME www.3engs.com). مجلد `v9_02` قديم — لا تعدّل عليه. مستودع `hosam-zaqout/3engs` قديم وخاص.
- Frontend: HTML/JS vanilla — `index.html`، `admin.html`، `auth.html`، `payment-success.html`، `privacy.html`، `404.html` (ذكية: تعرض المقالات الجديدة من Firestore قبل توليد صفحتها).
- Backend: Firebase project `engs-website` — Firestore + Auth + Storage + Functions v2 (Node 22, us-central1) في `functions/index.js`.
- النشر: `firebase deploy --only functions --project engs-website` (على ويندوز لو timeout: `FUNCTIONS_DISCOVERY_TIMEOUT=60`). الموقع: `git push origin main`.

## توليد الصفحات (SEO/GEO)
- `build-static-pages.mjs` يشتغل **كل ساعة** عبر `.github/workflows/build-pages.yml` (أو يدوياً: `node build-static-pages.mjs`، ويحتاج `npm install --no-save --no-package-lock sharp@0.34`). `INCLUDE_DRAFTS=1` للمعاينة المحلية.
- يولّد: صفحات `/courses|projects|products|books/{slug}/`، `/sections/{slug}/` (أقسام مخصصة ومقالات)، `/topics/{tag}/` (تصنيف ≥2 عناصر)، `/team/{slug}/`، `sitemap.xml`، `llms.txt`، صور WebP في `/img/`، وكتل `<!--SSR:x-->` داخل index.html.
- كل صفحة: فقرة "✅ باختصار"، ملخص سريع، Schema (Course/Product+Book/BlogPosting/FAQPage/Person/Review)، meta description 130-155 حرف. الروابط القديمة تتحول تلقائياً (redirect stubs).
- `assets/md.js`: محوّل Markdown مشترك (عناوين، قوائم، جداول، روابط) — للبناء ولوحة التحكم و404.
- الفريق (TEAM في السكربت): حسام زقوت، إسراء الطويل، فرات الطويل. صور الفريق تُوضع في `img/team/{slug}.jpg` (لسا ناقصة).

## الدفع — بوابة Togo (https://api.togo.ps/docs)
- المفتاح في Secret Manager: `TOGO_API_KEY` (لا يُكتب بالكود أبداً).
- التدفق: `createPayment` (POST form) → يقرأ الأسعار من Firestore → receiver address (مخزّن بـ `users/{uid}.togoReceivers`) → `POST /api/v1/actions` (Create_Visa, type RFP, USD, prevent_sms_link) → redirect إلى `direct-pay?orderId=<hashed_id>`.
- التأكيد **من سيرفر Togo فقط** (`GET /orders?id=` → `data.items[]`، الحالة `status`: `TO_PAY` / `CANCELLED` / غالباً `PAID`) عبر `syncTogoOrder`؛ `verifyPayment` + `syncTogoPayments` (كل 30 دقيقة) + زر "🔄 تحقق" للأدمن. **قيمة status بعد الدفع الناجح لم تُرَ بعد** — أول دفعة حقيقية تؤكدها (راجع `togoLastStatus` بالطلب).
- ملاحظات Togo غير موثقة: receiver-address يتطلب حقل `details`. أداة `adminTogo {action:"dryrun"}` تنشئ طلب $1 وتلغيه وتعرض الردود.
- الملفات المدفوعة في `private_files/{col}__{id}` (أدمن فقط)، تُسلَّم عبر "📦 مشترياتي" بعد الدفع. طلبات يدوية (واتساب/PayPal) عبر `adminCreateOrder`.
- Crosspay القديم أُلغي نهائياً.

## الحالة الحالية / المهام المفتوحة
1. **اختبار دفع حقيقي $1** بمنتج "🧪 منتج تجريبي" (slug `payment-test`, id `SOg0mjSW2RuPdcAxmiIT`) — ثم **حذف المنتج التجريبي** وتأكيد قيمة status المدفوعة.
2. بعد الاختبار: عناوين أنظف (`/login/` بدل auth.html، `/payment/` بدل payment-success.html — انتبه لروابط الرجوع في createPayment).
3. صور وروابط LinkedIn لـ م. إسراء و م. فرات (م. حسام: LinkedIn/ResearchGate/YouTube مضافة).
4. إضافة الـ 10 دورات والورش الحقيقية (الإحصائيات بالموقع "+10 دورة").
5. مقالات: منشور "ESP32 أم Arduino"؛ مسودات: التخصصات الهندسية، اللابتوب، PWM vs MPPT (بانتظار مراجعة حسام ونشرها من لوحة التحكم ← 📝 المقالات).
6. دومين `3engs.com` بدون www كان على Namecheap URL Redirect (بلا https) — المطلوب 4 سجلات A لـ GitHub Pages (185.199.108-111.153). تأكد إنه انصلح.

## قواعد مهمة
- لا تثق بأي سعر أو حالة دفع من المتصفح. الأدمن يتطلب `email_verified`.
- لا تكتب مفاتيح/أسرار بالكود أو المحادثة. قبل النشر للموقع أو Firebase أكّد مع حسام.
- محتوى المقالات: لا تخترع خبرات أو أرقام للفريق — استخدم فقط الموجود بالموقع.
