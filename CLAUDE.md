# 3ENG.s — المهندسون الثلاثة (www.3engs.com)

منصة تعليمية هندسية (دورات، مشاريع، كتب، مقالات، حاسبات). المالك: م. حسام زقوت (hosam2564491@gmail.com). المحادثة بلهجة فلسطينية، لكن **كل نص يراه زائر الموقع بالفصحى**، والمعادلات في أسطر مستقلة من اليسار لليمين.

## البنية
- **هذا المجلد هو المصدر الوحيد**: `E:\3engs\website\codes\3engs-live` = مستودع `hosam-zaqout/hosam-zaqout.github.io` (فرع `main`، GitHub Pages، CNAME www.3engs.com، وفيه `.nojekyll`). مجلد `v9_02` قديم — لا تعدّل عليه. مستودع `hosam-zaqout/3engs` قديم وخاص.
- Frontend: HTML/JS vanilla — `index.html`، `admin.html`، `auth.html`، `payment-success.html`، `privacy.html`، `404.html` (ذكية: تعرض المقالات الجديدة من Firestore قبل توليد صفحتها)، `register/index.html` (تسجيل الورشات).
- Backend: Firebase project `engs-website` — Firestore + Auth + Storage + Functions v2 (Node 22, us-central1) في `functions/index.js`.
- النشر: `firebase deploy --only functions:<name> --project engs-website` (على ويندوز: `FUNCTIONS_DISCOVERY_TIMEOUT=60`؛ استخدم `firebase` المثبت وليس `npx` لأنه يعلق). القواعد: `firebase deploy --only firestore:rules`. الموقع: `git push origin main`.
- **الدفع إلى main يتعارض غالباً مع commits البناء التلقائي** ("Update SEO pages and sitemap"): `git pull --rebase`، ولو تعارضت ملفات مولّدة خذ نسختك (`git checkout --theirs`) ثم أعد `node build-static-pages.mjs` وادفع.
- معاينة محلية: `.claude/launch.json` (اسم `site`) يشغّل `.claude/serve.mjs` على المنفذ 8080 (مجلد `.claude/` مستثنى من git).

## توليد الصفحات (SEO/GEO)
- `build-static-pages.mjs` يشتغل **كل ساعة** (الدقيقة 17) عبر `.github/workflows/build-pages.yml`، أو يدوياً: `node build-static-pages.mjs` (يحتاج `npm install --no-save --no-package-lock sharp@0.34`). `INCLUDE_DRAFTS=1` للمعاينة المحلية. العناصر الجديدة تظهر بعد أول بناء (حتى ساعة)، أو شغّل الـ workflow يدوياً من GitHub Actions.
- يولّد: صفحات `/courses|projects|products|books/{slug}/`، `/sections/{slug}/`، `/topics/{tag}/` (تصنيف ≥2 عناصر)، `/team/{slug}/`، `/about/`، `/tools/` و `/tools/{slug}/`، `sitemap.xml`، `llms.txt`، صور WebP في `/img/`، وكتل `<!--SSR:x-->` داخل index.html (منها أعداد المنتجات والدورات الحقيقية).
- كل صفحة: "✅ باختصار"، Schema، meta description 130-155 حرف. الروابط القديمة تتحول تلقائياً (redirect stubs). رابط العنصر = `slug` من لوحة التحكم أو slug تلقائي من العنوان + أول 6 أحرف من id (زر 🔗 في لوحة التحكم ينسخه).
- `assets/md.js`: محوّل Markdown مشترك. الفريق (TEAM في السكربت): حسام زقوت، إسراء الطويل، فرات الطويل؛ صورهم في `img/team/{slug}.jpg` (ناقصة).

## الحاسبات `/tools/` (15 حاسبة)
- المحتوى في `tools-data.mjs` (نصوص، نماذج، رسومات SVG للمؤقت 555 تُبنى وقت التوليد، و`eq()` للمعادلات)، والحساب في `assets/tools.js` (يعمل بالمتصفح فقط). الصفحات يولّدها `toolPage()` في سكربت البناء، والدالة `ltr()` تعزل الرموز اللاتينية داخل النص العربي.
- حاسبات "على الرسمة" (قانون أوم، LED، مقسّم الجهد): المستخدم يعبّئ الخانات والمحسوب يتلوّن بالأخضر (class `auto`). التوالي/التوازي يرسم الدائرة ديناميكياً، والـ 555 فيه رسمة لكل وضع.
- **الأدوات المتقدمة** (مدفوعة، افتراضياً $7، السعر من لوحة التحكم ← 💳 إعدادات الدفع): منتج `products/tools-pro` (slug `advanced-tools`). بعد الدفع تكتب الدالة `grantToolsPro` في `entitlements/{uid}.toolsPro`، و`assets/tools-pro.js` يتيح الحفظ في `tool_saves/{uid}/items` وتقرير PDF (نافذة طباعة). القواعد تمنع الحفظ دون الصلاحية.
- جداول الأسلاك (IEC 60364-5-52 B.52.4 طريقة C، و NEC 310.16 عمود 75°C) وافتراضات المنظومة الشمسية **بانتظار مراجعة حسام الهندسية**.

## الدفع — بوابة Togo (https://api.togo.ps/docs)
- المفتاح في Secret Manager: `TOGO_API_KEY` (لا يُكتب بالكود أبداً).
- التدفق: `createPayment` (POST form) → يقرأ الأسعار من Firestore → receiver address (مخزّن بـ `users/{uid}.togoReceivers`) → `POST /api/v1/actions` (Create_Visa, type RFP, USD, prevent_sms_link) → redirect إلى `direct-pay?orderId=<hashed_id>`.
- التأكيد **من سيرفر Togo فقط** (`GET /orders?id=` → `data.items[]`، الحالة `status`: `TO_PAY` / `CANCELLED` / غالباً `PAID`) عبر `syncTogoOrder`؛ `verifyPayment` + `syncTogoPayments` (كل 30 دقيقة) + زر "🔄 تحقق" للأدمن. **قيمة status بعد الدفع الناجح لم تُرَ بعد** — أول دفعة حقيقية تؤكدها (راجع `togoLastStatus` بالطلب).
- ملاحظات Togo غير موثقة: receiver-address يتطلب حقل `details`. أداة `adminTogo {action:"dryrun"}` تنشئ طلب $1 وتلغيه وتعرض الردود.
- الملفات المدفوعة في `private_files/{col}__{id}` (أدمن فقط)، تُسلَّم عبر "📦 مشترياتي" (والرابط `/?myorders=1` يفتحها). طلبات يدوية (واتساب/PayPal) عبر `adminCreateOrder`.
- بجانب أزرار الشراء سطر "🔒 دفع آمن عبر Togo • استرداد خلال 7 أيام" يربط بـ `/privacy.html#refund`.

## الإيميلات (من info@3engs.com — Google Workspace)
- nodemailer عبر Gmail SMTP؛ كلمة مرور التطبيق في Secret Manager: `SMTP_PASS`.
- `sendReceipt` (trigger على `orders/{id}`): إيصال تلقائي عند تحوّل الطلب إلى `paid` (مرة واحدة: `receiptClaimedAt` / `receiptSentAt`، والخطأ في `receiptError`). النص قابل للتعديل من `site_config/emails` (لوحة التحكم ← 💳 إعدادات الدفع) بالمتغيرات `{name}` `{invoice}` `{total}`، و`adminTestReceipt` يرسل نسخة تجريبية.
- `adminWorkshopEmail`: إيميل جماعي لمسجلي ورشة (`{name}` لكل طالب، وزر تجربة)، والسجل في `workshop_emails`.
- **لم يُختبر وصول أي إيميل فعلياً بعد.**

## الورشات
- `workshops/{id}` (title, slug, date, desc, open) و`workshop_registrations/{workshopId}__{phone}` (الاسم، الواتساب بصيغة دولية دون +، الإيميل، الدولة، التخصص، uid اختياري). التسجيل دون حساب؛ الرقم لا يتكرر في نفس الورشة.
- صفحة التسجيل: `/register/?w={slug}`. لوحة التحكم ← 🎟️ الورشات: إنشاء، فتح/إغلاق، نسخ الرابط، المسجلون، تصدير Excel (SheetJS من cdnjs، الرقم نصّي + رابط wa.me) و CSV، وإيميل جماعي.

## الحالة الحالية / المهام المفتوحة
1. **اختبار دفع حقيقي $1** بمنتج "🧪 منتج تجريبي" (slug `payment-test`) — ثم حذفه وتأكيد قيمة status المدفوعة.
2. **اختبار الإيميلات** (الإيصال التجريبي + تجربة إيميل الورشة) و**الأدوات المتقدمة** (طلب يدوي بمبلغ 0 لحساب حسام ثم حفظ/تقرير).
3. `https://3engs.com` بدون www: سجلات A الأربعة صحيحة و http يحوّل، لكن شهادة SSL للدومين بدون www لم تصدر بعد — إن استمر: إزالة الدومين من GitHub Pages وإعادة إضافته ثم Enforce HTTPS.
4. بعد اختبار الدفع: عناوين أنظف (`/login/` بدل auth.html، `/payment/` بدل payment-success.html — انتبه لروابط الرجوع في createPayment).
5. المحاكي الرسومي (CircuitJS، ترخيص GPL) بواجهة عربية ودوائر جاهزة — آخر مرحلة من قسم الحاسبات.
6. صور وروابط LinkedIn لـ م. إسراء و م. فرات؛ الدورات الحقيقية (الموقع الآن يعرض العدد الفعلي)؛ مراجعة المقالات المسودّة ونشرها؛ Google Business Profile وتقييمات حقيقية.

## قواعد مهمة
- لا تثق بأي سعر أو حالة دفع من المتصفح. الأدمن يتطلب `email_verified`.
- لا تكتب مفاتيح/أسرار بالكود أو المحادثة. قبل النشر للموقع أو Firebase أكّد مع حسام.
- المحتوى: لا تخترع خبرات أو أرقام للفريق — استخدم فقط الموجود بالموقع. الأرقام المعروضة يجب أن تكون حقيقية.
- نصوص الموقع للزوار بالفصحى ومرتبة؛ لوحة التحكم (لحسام فقط) يمكن أن تكون بالعامية.
