// 🛒 الدفع من أي صفحة (الدورات، المشاريع، الورش...) بدون الانتقال للرئيسية
// - زر "اشترِ الآن" (a[data-buy="col:id"]) يفتح نموذج الدفع فوق نفس الصفحة لهالعنصر لحاله
// - أيقونة 🛒 بالهيدر تظهر لما يكون بالسلة عناصر (نفس سلة الرئيسية: localStorage 3engs_cart)
// - النموذج: الاسم، الإيميل، الدولة والجوال، المدينة ← createPayment ← بوابة Togo
// الأسعار والتحقق كلها على السيرفر؛ هون بس عرض
(function () {
  "use strict";
  var FN = "https://us-central1-engs-website.cloudfunctions.net/createPayment";
  var KEY = "3engs_cart";
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || "[]").filter(function (i) { return i && i.col && i.id; }); } catch (e) { return []; } }
  function save(c) { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) {} }
  function money(n) { return "$" + (Math.round(Number(n || 0) * 100) / 100).toFixed(2); }

  var CSS = [
    ".ck3-cart{position:relative;background:none;border:1px solid var(--line,#232c47);color:var(--txt,#e9edf7);border-radius:10px;padding:6px 12px;font:inherit;cursor:pointer;margin-inline-start:10px}",
    ".ck3-cart b{background:var(--acc,#F59E0B);color:#0b1020;border-radius:20px;padding:0 7px;font-size:.75rem;margin-inline-start:4px}",
    ".ck3-ov{position:fixed;inset:0;background:rgba(5,10,25,.88);backdrop-filter:blur(10px);z-index:1000;display:none;align-items:center;justify-content:center;padding:14px}",
    ".ck3-ov.show{display:flex}",
    ".ck3-box{background:var(--card,#131a2e);border:1px solid var(--line,#232c47);border-radius:18px;width:100%;max-width:420px;max-height:94vh;overflow-y:auto;overflow-x:hidden;padding:22px;color:var(--txt,#e9edf7);font-family:Cairo,system-ui,Tahoma,sans-serif}",
    ".ck3-box h3{font-size:1.1rem;margin:0 0 4px;text-align:center}.ck3-sub{font-size:.82rem;color:var(--mut,#98a2bf);text-align:center;margin-bottom:14px}",
    ".ck3-box label{display:block;font-size:.76rem;font-weight:700;color:var(--mut,#98a2bf);margin:10px 0 5px}",
    ".ck3-box input,.ck3-box select{width:100%;padding:10px 12px;background:#0a0f1d;border:1px solid var(--line,#232c47);border-radius:9px;color:var(--txt,#e9edf7);font:inherit;font-size:.88rem;outline:none;box-sizing:border-box}",
    ".ck3-box input:focus,.ck3-box select:focus{border-color:var(--acc,#F59E0B)}",
    ".ck3-row{display:flex;gap:8px;direction:ltr}.ck3-row select{width:46%;flex-shrink:0;min-width:0}.ck3-row input{min-width:0}",
    ".ck3-items{background:#0a0f1d;border-radius:10px;padding:8px 12px;margin:8px 0;font-size:.86rem}",
    ".ck3-it{display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px solid var(--line,#232c47)}.ck3-it:last-child{border:0}",
    ".ck3-it button{background:none;border:0;color:#ef4444;cursor:pointer;font-size:.9rem}",
    ".ck3-tot{display:flex;justify-content:space-between;font-weight:900;margin:12px 0;font-size:1rem}.ck3-tot span:last-child{color:var(--acc,#F59E0B)}",
    ".ck3-btns{display:flex;gap:8px;margin-top:6px}.ck3-btns button{flex:1;padding:12px;border-radius:10px;border:0;font:inherit;font-weight:800;cursor:pointer}",
    ".ck3-go{background:linear-gradient(135deg,var(--acc,#F59E0B),#D97706);color:#0b1020;flex:2!important}.ck3-no{background:#ffffff12;color:var(--mut,#98a2bf)}",
    ".ck3-err{color:#f87171;font-size:.8rem;margin-top:8px;min-height:1em;text-align:center}",
    ".ck3-note{font-size:.72rem;color:var(--mut,#98a2bf);margin-top:10px;text-align:center;line-height:1.7}",
  ].join("");

  function countryOptions() {
    var L = window.COUNTRIES3 || [["PS", "970", "فلسطين"]];
    var flag = function (iso) { return iso.replace(/./g, function (c) { return String.fromCodePoint(127397 + c.charCodeAt(0)); }); };
    return L.map(function (c) { return '<option value="' + c[0] + '" data-dial="' + c[1] + '"' + (c[0] === "PS" ? " selected" : "") + ">" + (c[0] === "IL" ? "🇵🇸" : flag(c[0])) + " " + esc(c[2]) + " +" + c[1] + "</option>"; }).join("")
      + '<option value="XX" data-dial="">🌍 دولة أخرى / مقدمة أخرى</option>';
  }

  var payItems = [];
  function build() {
    var st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
    var ov = document.createElement("div"); ov.className = "ck3-ov"; ov.id = "ck3Pay";
    ov.innerHTML = '<div class="ck3-box" role="dialog" aria-modal="true">'
      + '<h3>🛒 إتمام الشراء</h3><div class="ck3-sub">دفع آمن بالبطاقة عبر بوابة Togo — بدون إنشاء حساب</div>'
      + '<div class="ck3-items" id="ck3Items"></div>'
      + '<label>الاسم الكامل</label><input id="ck3Name" maxlength="80" autocomplete="name">'
      + '<label>البريد الإلكتروني (تصلك عليه روابط التحميل والإيصال)</label><input id="ck3Email" type="email" maxlength="120" dir="ltr" autocomplete="email" placeholder="name@example.com">'
      + '<label>رقم الجوال / الواتساب</label><div class="ck3-row"><select id="ck3Cc">' + countryOptions() + '</select><input id="ck3Phone" type="tel" inputmode="tel" maxlength="15" placeholder="592753159" autocomplete="tel-national"></div>'
      + '<div id="ck3OtherWrap" style="display:none;margin-top:8px" class="ck3-row"><input id="ck3Other" type="tel" inputmode="numeric" maxlength="4" placeholder="مقدمة الدولة مثل 49"></div>'
      + '<label>المدينة</label><input id="ck3City" maxlength="60" placeholder="مدينتك">'
      + '<div class="ck3-tot"><span>المجموع</span><span id="ck3Total"></span></div>'
      + '<div class="ck3-btns"><button type="button" class="ck3-no" id="ck3Cancel">إلغاء</button><button type="button" class="ck3-go" id="ck3Go">انتقل للدفع ⚡</button></div>'
      + '<div class="ck3-err" id="ck3Err"></div>'
      + '<div class="ck3-note">🔒 بيانات بطاقتك تُدخل في صفحة بوابة الدفع ولا تصل إلينا • ↩️ <a href="/privacy.html#refund" style="color:inherit">استرداد خلال 7 أيام</a><br>طلاب فلسطين بدون بطاقة: <a href="https://wa.me/972592753159" style="color:#25D366">تواصل معنا عبر واتساب</a></div>'
      + "</div>";
    document.body.appendChild(ov);
    ov.addEventListener("click", function (e) { if (e.target === ov) close(); });
    $("ck3Cancel").onclick = close;
    $("ck3Go").onclick = submit;
    $("ck3Cc").onchange = function () { $("ck3OtherWrap").style.display = this.value === "XX" ? "flex" : "none"; };
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    // تعبئة البيانات من آخر مرة (على نفس الجهاز)
    try { var p = JSON.parse(localStorage.getItem("3engs_buyer") || "{}"); ["Name", "Email", "Phone", "City"].forEach(function (k) { if (p[k]) $("ck3" + k).value = p[k]; }); if (p.Cc) $("ck3Cc").value = p.Cc; } catch (e) {}
  }
  function close() { var o = $("ck3Pay"); if (o) o.classList.remove("show"); }

  function renderItems(fromCart) {
    $("ck3Items").innerHTML = payItems.map(function (i, k) {
      return '<div class="ck3-it"><span>' + esc(i.emoji || "📦") + " " + esc(i.name) + '</span><span>' + money(i.price)
        + (fromCart ? ' <button type="button" data-k="' + k + '" title="حذف">✕</button>' : "") + "</span></div>";
    }).join("") || '<div style="text-align:center;color:var(--mut)">السلة فارغة</div>';
    $("ck3Total").textContent = money(payItems.reduce(function (s, i) { return s + Number(i.price || 0); }, 0));
    Array.prototype.forEach.call($("ck3Items").querySelectorAll("button[data-k]"), function (b) {
      b.onclick = function () { var c = load(); var it = payItems[+b.dataset.k]; c = c.filter(function (x) { return !(x.col === it.col && x.id === it.id); }); save(c); payItems = c; renderItems(true); updateCartBtn(); if (!c.length) close(); };
    });
  }
  var _fromCart = false;
  function open(items, fromCart) {
    if (!$("ck3Pay")) build();
    payItems = items; _fromCart = !!fromCart;
    renderItems(fromCart);
    $("ck3Err").textContent = "";
    $("ck3Go").disabled = false; $("ck3Go").textContent = "انتقل للدفع ⚡";
    $("ck3Pay").classList.add("show");
    setTimeout(function () { ($("ck3Name").value ? $("ck3Phone") : $("ck3Name")).focus(); }, 200);
  }

  function submit() {
    var err = function (t, el) { $("ck3Err").textContent = "⚠️ " + t; if (el) el.focus(); };
    var name = $("ck3Name").value.trim(), email = $("ck3Email").value.trim(), city = $("ck3City").value.trim();
    var sel = $("ck3Cc"), iso = sel.value, dial = iso === "XX" ? $("ck3Other").value.replace(/\D/g, "") : sel.selectedOptions[0].dataset.dial;
    var num = $("ck3Phone").value.replace(/[٠-٩]/g, function (c) { return "٠١٢٣٤٥٦٧٨٩".indexOf(c); }).replace(/\D/g, "").replace(/^0+/, "");
    if (!payItems.length) return err("السلة فارغة");
    if (name.length < 2) return err("اكتب اسمك", $("ck3Name"));
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return err("البريد الإلكتروني غير صحيح", $("ck3Email"));
    if (!/^[1-9]\d{0,3}$/.test(dial || "")) return err("اكتب مقدمة دولتك (أرقام فقط)", $("ck3Other"));
    if (num.length < 6) return err("اكتب رقم الجوال بدون مقدمة الدولة", $("ck3Phone"));
    if (num.indexOf(dial) === 0 && (dial + num).length > 13) num = num.slice(dial.length); // لو كتب المقدمة مرتين
    try { localStorage.setItem("3engs_buyer", JSON.stringify({ Name: name, Email: email, Phone: $("ck3Phone").value, City: city, Cc: iso })); } catch (e) {}
    var fields = {
      items: JSON.stringify(payItems.map(function (i) { return { col: i.col, id: i.id }; })),
      mobile: dial + num, name: name, email: email, city: city, country: iso, provider: "togo",
      source: location.href.split("#")[0],
    };
    var f = document.createElement("form"); f.method = "POST"; f.action = FN; f.style.display = "none";
    Object.keys(fields).forEach(function (k) { var i = document.createElement("input"); i.type = "hidden"; i.name = k; i.value = fields[k]; f.appendChild(i); });
    document.body.appendChild(f);
    $("ck3Go").disabled = true; $("ck3Go").textContent = "⏳ جاري التحويل لبوابة الدفع...";
    f.submit();
  }

  // أيقونة السلة بالهيدر — بتظهر بس لما يكون فيها عناصر
  function updateCartBtn() {
    var c = load(), b = $("ck3CartBtn");
    if (!b) {
      var host = document.querySelector("header.top .wrap"); if (!host) return;
      b = document.createElement("button"); b.type = "button"; b.id = "ck3CartBtn"; b.className = "ck3-cart"; b.title = "السلة";
      b.onclick = function () { var c2 = load(); if (c2.length) open(c2, true); };
      host.appendChild(b);
    }
    b.style.display = c.length ? "" : "none";
    b.innerHTML = "🛒<b>" + c.length + "</b>";
  }

  function init() {
    // زر "اشترِ الآن" بصفحات العناصر
    Array.prototype.forEach.call(document.querySelectorAll("a[data-buy]"), function (a) {
      var p = a.dataset.buy.split(":");
      if (p[0] === "products" && p[1] === "tools-pro") return; // الأدوات المتقدمة بتحتاج حساب ← الرئيسية
      a.addEventListener("click", function (e) {
        e.preventDefault();
        open([{ col: p[0], id: p[1], name: a.dataset.name || document.title, price: Number(a.dataset.price || 0), emoji: a.dataset.emoji || "🛒" }], false);
      });
    });
    updateCartBtn();
    window.addEventListener("storage", function (e) { if (e.key === KEY) updateCartBtn(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
