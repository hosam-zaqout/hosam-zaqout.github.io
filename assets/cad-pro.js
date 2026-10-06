// 3ENG CAD — حفظ الدوائر في الحساب وتصديرها (ميزة "الأدوات المتقدمة")
// الصفحة تعرّف window.CadProConfig = { kind, slot, getData(), setData(str), title(), formats: [...], onPro(bool) }
// الصلاحية من entitlements/{uid}.toolsPro (يكتبها السيرفر بعد الدفع)، والقواعد تمنع الحفظ دونها
const FB = "https://www.gstatic.com/firebasejs/10.12.0/";
const CFG = { apiKey: "AIzaSyALJiF8l_wnk_6FU6etQpz44Z43lSORXQk", authDomain: "engs-website.firebaseapp.com", projectId: "engs-website", storageBucket: "engs-website.firebasestorage.app", messagingSenderId: "1028163586505", appId: "1:1028163586505:web:c09de00bb30a3369ca4018" };
const PRO_ID = "tools-pro";
const C = window.CadProConfig;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ar = () => document.documentElement.lang !== "en";
const L = (a, e) => (ar() ? a : e);

export function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type || "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
// تحويل SVG إلى PNG
export function svgToPng(svgText, w, h, bg) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const s = 2, cv = document.createElement("canvas"); cv.width = w * s; cv.height = h * s;
      const cx = cv.getContext("2d"); cx.fillStyle = bg || "#ffffff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => (b ? res(b) : rej(new Error("png"))), "image/png");
    };
    img.onerror = rej;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
  });
}
window.CadProUtil = { download, svgToPng };

if (C && document.getElementById(C.slot)) init();

async function init() {
  const slot = document.getElementById(C.slot);
  slot.innerHTML = `<button type="button" class="btn" data-pro="save"></button><button type="button" class="btn" data-pro="list"></button><button type="button" class="btn" data-pro="export"></button>`;
  const modal = document.createElement("div");
  modal.className = "pro-modal"; modal.hidden = true;
  modal.innerHTML = `<div class="pro-box" role="dialog" aria-modal="true"><button type="button" class="pro-x" aria-label="×">✕</button><div class="pro-body"></div></div>`;
  document.body.appendChild(modal);
  const body = modal.querySelector(".pro-body");
  const open = (html) => { body.innerHTML = html; modal.hidden = false; };
  const close = () => { modal.hidden = true; };
  modal.querySelector(".pro-x").onclick = close;
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  const labels = () => {
    slot.querySelector('[data-pro="save"]').textContent = L("💾 حفظ", "💾 Save");
    slot.querySelector('[data-pro="list"]').textContent = L("📂 دوائري", "📂 My circuits");
    slot.querySelector('[data-pro="export"]').textContent = L("📤 تصدير", "📤 Export");
  };
  labels();
  new MutationObserver(labels).observe(document.documentElement, { attributes: true, attributeFilter: ["lang"] });

  const [{ initializeApp }, A, F] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  const app = initializeApp(CFG, "cadpro");
  const auth = A.getAuth(app), db = F.getFirestore(app);
  let user = null, pro = false, price = null;
  F.getDoc(F.doc(db, "products", PRO_ID)).then((s) => { if (s.exists()) price = s.data().price; }).catch(() => {});
  A.onAuthStateChanged(auth, async (u) => {
    user = u; pro = false;
    if (u) { try { const e = await F.getDoc(F.doc(db, "entitlements", u.uid)); pro = e.exists() && e.data().toolsPro === true; } catch (e) { console.warn(e); } }
    slot.classList.toggle("is-pro", pro);
    if (C.onPro) C.onPro(pro);
  });

  // نافذة الاشتراك لغير المشتركين
  const upsell = () => {
    const back = encodeURIComponent("https://www.3engs.com" + location.pathname + location.search);
    if (!user) return open(`<h3>🔐 ${L("الحفظ والتصدير للمشتركين", "Saving & export are for members")}</h3><p>${L("حفظ الدوائر في حسابك وتصديرها ملفاتٍ وصوراً جزء من <b>الأدوات المتقدمة</b>. سجّل الدخول أولاً.", "Saving circuits to your account and exporting them as files and images is part of <b>Advanced Tools</b>. Please sign in first.")}</p><a class="btn main" href="/auth.html?redirect=${back}">${L("تسجيل الدخول", "Sign in")}</a>`);
    open(`<h3>⭐ ${L("الأدوات المتقدمة", "Advanced Tools")}${price ? ` — $${esc(price)}` : ""}</h3>
<ul class="pro-list"><li>${L("احفظ دوائرك ولوحات التجارب في حسابك وافتحها من أي جهاز", "Save your circuits and breadboards to your account and open them anywhere")}</li>
<li>${L("صدّر الدائرة ملفاً، أو صورة PNG و SVG، أو رابط مشاركة", "Export as a file, PNG and SVG images, or a share link")}</li>
<li>${L("احفظ نتائج الحاسبات وصدّرها تقارير PDF", "Save calculator results and export PDF reports")}</li></ul>
<p class="pro-note">${L("دفعة واحدة — بلا اشتراك شهري.", "One-time payment — no monthly subscription.")}</p>
<a class="btn main" href="/?open=products:${PRO_ID}">🛒 ${L("اشترِ الآن", "Buy now")}</a>`);
  };

  const toast = (msg) => { let t = document.querySelector(".pro-toast"); if (!t) { t = document.createElement("div"); t.className = "pro-toast"; document.body.appendChild(t); } t.textContent = msg; t.classList.add("on"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600); };

  async function save() {
    if (!pro) return upsell();
    const title = prompt(L("اسم الدائرة:", "Circuit name:"), C.title());
    if (!title) return;
    const data = await C.getData();
    if (!data || data.length > 900000) return toast(L("⚠️ الدائرة كبيرة جداً للحفظ", "⚠️ Circuit is too large to save"));
    try {
      await F.addDoc(F.collection(db, "cad_saves", user.uid, "items"), { kind: C.kind, title: title.slice(0, 120), data, createdAt: F.serverTimestamp() });
      toast(L("✅ حُفظت الدائرة في حسابك", "✅ Circuit saved to your account"));
    } catch (e) { console.error(e); toast(L("⚠️ تعذّر الحفظ", "⚠️ Could not save")); }
  }

  async function list() {
    // فتح ملف من الجهاز متاح للجميع؛ قائمة الدوائر المحفوظة للمشتركين
    let html = `<h3>📂 ${L("دوائري", "My circuits")}</h3><label class="btn pro-file">📁 ${L("فتح ملف من الجهاز", "Open a file")}<input type="file" accept="${C.fileAccept || ".txt"}" hidden></label>`;
    if (!pro) html += `<p class="pro-note">${L("قائمة الدوائر المحفوظة في الحساب متاحة لمشتركي الأدوات المتقدمة.", "Saved circuits in your account are available to Advanced Tools members.")} <a href="#" class="pro-up">${L("اعرف المزيد", "Learn more")}</a></p>`;
    open(html + `<div class="pro-items"></div>`);
    body.querySelector('input[type="file"]').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { await C.setData(await f.text()); close(); toast(L("✅ فُتح الملف", "✅ File opened")); } catch (er) { toast(L("⚠️ الملف غير صالح", "⚠️ Invalid file")); }
    };
    const up = body.querySelector(".pro-up"); if (up) up.onclick = (e) => { e.preventDefault(); upsell(); };
    if (!pro) return;
    const box = body.querySelector(".pro-items");
    box.innerHTML = `<p class="pro-note">⏳</p>`;
    try {
      const snap = await F.getDocs(F.query(F.collection(db, "cad_saves", user.uid, "items"), F.where("kind", "==", C.kind)));
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      box.innerHTML = items.length ? items.map((it) => `<div class="pro-item"><span>${esc(it.title)}<small>${it.createdAt?.toDate?.().toLocaleDateString(ar() ? "ar" : "en") || ""}</small></span><button type="button" class="btn" data-open="${it.id}">↩️ ${L("فتح", "Open")}</button><button type="button" class="btn" data-del="${it.id}">🗑️</button></div>`).join("") : `<p class="pro-note">${L("لا توجد دوائر محفوظة بعد.", "No saved circuits yet.")}</p>`;
      box.querySelectorAll("[data-open]").forEach((b) => (b.onclick = async () => { const it = items.find((x) => x.id === b.dataset.open); await C.setData(it.data); close(); toast(L("✅ فُتحت الدائرة", "✅ Circuit opened")); }));
      box.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm(L("حذف هذه الدائرة؟", "Delete this circuit?"))) return; await F.deleteDoc(F.doc(db, "cad_saves", user.uid, "items", b.dataset.del)); list(); }));
    } catch (e) { console.error(e); box.innerHTML = `<p class="pro-note">⚠️</p>`; }
  }

  function exportMenu() {
    if (!pro) return upsell();
    open(`<h3>📤 ${L("تصدير", "Export")}</h3><div class="pro-formats">${C.formats.map((f, i) => `<button type="button" class="btn" data-fmt="${i}">${L(f.ar, f.en)}</button>`).join("")}</div>`);
    body.querySelectorAll("[data-fmt]").forEach((b) => (b.onclick = async () => {
      try { await C.formats[+b.dataset.fmt].run(); close(); } catch (e) { console.error(e); toast(L("⚠️ تعذّر التصدير", "⚠️ Export failed")); }
    }));
  }

  slot.addEventListener("click", (e) => {
    const a = e.target.closest("[data-pro]")?.dataset.pro;
    if (a === "save") save(); else if (a === "list") list(); else if (a === "export") exportMenu();
  });
}
