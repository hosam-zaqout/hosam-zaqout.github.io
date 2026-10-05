// 3ENG.s — الأدوات المتقدمة: حفظ الحسابات بالحساب وتصدير تقرير PDF
// الصلاحية من entitlements/{uid} (بيكتبها السيرفر بعد الدفع) — والقواعد بتمنع الحفظ بدونها
const FB = "https://www.gstatic.com/firebasejs/10.12.0/";
const CFG = { apiKey: "AIzaSyALJiF8l_wnk_6FU6etQpz44Z43lSORXQk", authDomain: "engs-website.firebaseapp.com", projectId: "engs-website", storageBucket: "engs-website.firebasestorage.app", messagingSenderId: "1028163586505", appId: "1:1028163586505:web:c09de00bb30a3369ca4018" };
const PRO_ID = "tools-pro";
const calc = document.querySelector(".calc[data-tool]");
if (calc) init();

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function init() {
  const tool = calc.dataset.tool;
  const toolName = document.querySelector("h1")?.textContent.trim() || tool;
  const bar = document.createElement("div");
  bar.className = "pro-bar";
  bar.innerHTML = `<button type="button" class="pro-btn" data-act="save">💾 حفظ الحساب</button><button type="button" class="pro-btn" data-act="pdf">📄 تقرير PDF</button><span class="pro-tag">⭐ الأدوات المتقدمة</span>
<div class="pro-msg" hidden></div><div class="pro-list" hidden></div>`;
  calc.appendChild(bar);
  const msg = bar.querySelector(".pro-msg"), list = bar.querySelector(".pro-list");

  const [{ initializeApp }, A, F] = await Promise.all([import(FB + "firebase-app.js"), import(FB + "firebase-auth.js"), import(FB + "firebase-firestore.js")]);
  const app = initializeApp(CFG);
  const auth = A.getAuth(app), db = F.getFirestore(app);
  let user = null, pro = false, price = null;

  F.getDoc(F.doc(db, "products", PRO_ID)).then((s) => { if (s.exists()) price = s.data().price; }).catch(() => {});

  const show = (html) => { msg.innerHTML = html; msg.hidden = !html; };
  const upsell = () => {
    if (!user) {
      const back = encodeURIComponent(location.href.startsWith("https://www.3engs.com/") ? location.href : "https://www.3engs.com" + location.pathname);
      return show(`🔐 حفظ الحسابات وتصدير التقارير جزء من <b>الأدوات المتقدمة</b>. يُرجى <a href="/auth.html?redirect=${back}">تسجيل الدخول</a> أولاً.`);
    }
    show(`⭐ <b>الأدوات المتقدمة</b>${price ? ` — <b>$${esc(price)}</b> لمرة واحدة` : ""}: احفظ حساباتك في حسابك وارجع إليها في أي وقت، وصدّر تقريراً منسّقاً بصيغة PDF لكل حاسبة. <a class="pro-buy" href="/?open=products:${PRO_ID}">🛒 اشترِ الآن</a>`);
  };

  // المدخلات: كل الحقول بترتيبها — الحقول المحسوبة (auto) ما بتنحفظ
  const fields = () => [...calc.querySelectorAll("[name]")].filter((el) => !el.closest(".pro-bar"));
  const snapshot = () => fields().map((el) => ({ n: el.name, v: el.type === "checkbox" ? (el.checked ? "1" : "") : el.classList.contains("auto") ? "" : String(el.value).slice(0, 200) }));
  const results = () => [...calc.querySelectorAll(".out .r")].map((r) => ({ k: r.querySelector("span")?.textContent || "", v: r.querySelector("b")?.textContent || "" })).slice(0, 40);
  const labelOf = (el) => el.getAttribute("aria-label") || el.closest("label")?.querySelector("span")?.textContent || el.name;

  function restore(inputs) {
    // جدول الأحمال (المنظومة الشمسية): نطابق عدد الصفوف أولاً
    const need = inputs.filter((x) => x.n === "ln").length, tbody = calc.querySelector("tbody");
    if (tbody && need) {
      while (tbody.rows.length < need) calc.querySelector(".add").click();
      while (tbody.rows.length > need) tbody.rows[tbody.rows.length - 1].remove();
    }
    calc.querySelectorAll(".auto").forEach((el) => { if (!el.readOnly) { el.value = ""; el.classList.remove("auto"); } });
    const els = fields();
    inputs.forEach((x, i) => { const el = els[i]; if (!el || el.name !== x.n) return; if (el.type === "checkbox") el.checked = !!x.v; else el.value = x.v; });
    calc.dispatchEvent(new Event("change", { bubbles: true }));
    calc.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function loadList() {
    if (!pro) { list.hidden = true; return; }
    const snap = await F.getDocs(F.query(F.collection(db, "tool_saves", user.uid, "items"), F.where("tool", "==", tool)));
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    list.hidden = false;
    list.innerHTML = `<b>📁 حساباتي المحفوظة (${items.length})</b>` + (items.length ? items.map((it) => `<div class="pro-item"><span>${esc(it.title)}<small>${it.createdAt?.toDate?.().toLocaleDateString("ar") || ""}</small></span><button type="button" data-load="${it.id}">↩️ فتح</button><button type="button" data-del="${it.id}">🗑️</button></div>`).join("") : `<p class="hint">لا توجد حسابات محفوظة لهذه الحاسبة بعد.</p>`);
    list.querySelectorAll("[data-load]").forEach((b) => (b.onclick = () => { const it = items.find((x) => x.id === b.dataset.load); restore(it.inputs || []); calc.scrollIntoView({ behavior: "smooth" }); }));
    list.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { if (!confirm("حذف هذا الحساب؟")) return; await F.deleteDoc(F.doc(db, "tool_saves", user.uid, "items", b.dataset.del)); loadList(); }));
  }

  A.onAuthStateChanged(auth, async (u) => {
    user = u; pro = false;
    if (u) { try { const e = await F.getDoc(F.doc(db, "entitlements", u.uid)); pro = e.exists() && e.data().toolsPro === true; } catch (e) { console.warn(e); } }
    bar.classList.toggle("is-pro", pro);
    show("");
    loadList().catch(console.error);
  });

  bar.addEventListener("click", async (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (!pro) return upsell();
    const res = results();
    if (!res.length) return show("⚠️ أدخل القيم أولاً حتى تظهر النتيجة.");
    if (act === "save") {
      const title = prompt("اسم الحساب:", `${toolName.replace(/^\S+\s/, "")} — ${new Date().toLocaleDateString("ar")}`);
      if (!title) return;
      try {
        await F.addDoc(F.collection(db, "tool_saves", user.uid, "items"), { tool, title: title.slice(0, 120), inputs: snapshot(), results: res, createdAt: F.serverTimestamp() });
        show("✅ حُفظ الحساب");
        loadList();
      } catch (err) { console.error(err); show("⚠️ تعذّر الحفظ، حاول مرة أخرى"); }
    } else report(res);
  });

  function report(res) {
    const ins = fields().filter((el) => el.type !== "checkbox" || el.checked).filter((el) => String(el.value).trim() !== "")
      .map((el) => `<tr><th>${esc(labelOf(el))}</th><td dir="ltr">${esc(el.tagName === "SELECT" ? el.options[el.selectedIndex]?.text : el.type === "checkbox" ? "✔" : el.value)}</td></tr>`).join("");
    const svg = calc.querySelector(".vd, .rsvg");
    let fig = "";
    if (svg) {
      // نسخة من الرسمة مع القيم الحالية (value كـ attribute عشان تظهر بالتقرير)
      const clone = svg.cloneNode(true), src = svg.querySelectorAll("input");
      clone.querySelectorAll("input").forEach((el, i) => { el.setAttribute("value", src[i].value); el.setAttribute("readonly", ""); });
      fig = `<div class="fig${svg.classList.contains("vd") ? "" : " plain"}">${clone.outerHTML}</div>`;
    }
    const w = window.open("", "_blank");
    if (!w) return show("⚠️ منع المتصفح فتح نافذة التقرير؛ اسمح بالنوافذ المنبثقة لهذا الموقع");
    w.document.write(`<!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8"><title>تقرير — ${esc(toolName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700&display=swap" rel="stylesheet">
<style>body{font-family:Cairo,Tahoma,sans-serif;color:#0f172a;max-width:760px;margin:24px auto;padding:0 18px}header{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #F59E0B;padding-bottom:10px;margin-bottom:18px}header b{font-size:1.4rem;color:#D97706}h1{font-size:1.25rem}h2{font-size:1rem;color:#D97706;margin:18px 0 8px}table{width:100%;border-collapse:collapse;font-size:.92rem}th,td{border:1px solid #e2e8f0;padding:7px 10px;text-align:right}th{background:#f8fafc;width:45%}.fig{max-width:520px;margin:10px auto;position:relative;aspect-ratio:480/300;color:#334155}.fig svg{width:100%;height:100%}.fig .lbl{fill:#D97706}.fig input{position:absolute;width:21%;text-align:center;border:1.5px solid #F59E0B;border-radius:8px;padding:4px;font:inherit;font-size:.85rem;background:#fff}.fig input.auto{border-color:#10B981;color:#047857}.fig.plain{aspect-ratio:auto;max-width:300px}footer{margin-top:24px;font-size:.78rem;color:#64748b;border-top:1px solid #e2e8f0;padding-top:8px}@media print{.noprint{display:none}}</style></head><body>
<header><b>3ENG.s</b><span>${esc(new Date().toLocaleString("ar"))}</span></header>
<h1>${esc(toolName)}</h1>${fig}
<h2>المدخلات</h2><table>${ins}</table>
<h2>النتائج</h2><table>${res.map((r) => `<tr><th>${esc(r.k)}</th><td dir="ltr">${esc(r.v)}</td></tr>`).join("")}</table>
<footer>تقرير من حاسبات 3ENG.s — www.3engs.com${location.pathname}. النتائج للتعلّم والتقدير المبدئي.</footer>
<p class="noprint" style="text-align:center;margin-top:16px"><button onclick="print()" style="font:inherit;padding:8px 18px;border-radius:8px;border:0;background:#F59E0B;font-weight:700;cursor:pointer">🖨️ حفظ PDF / طباعة</button></p>
<script>setTimeout(()=>print(),600)<\/script></body></html>`);
    w.document.close();
  }
}
