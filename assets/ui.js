/* 3ENG.s — أدوات الواجهة المشتركة: الرموز، القائمة، رسومات بطاقات الفريق */
(function () {
  var esc = function (t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  function ic(n, c) { return '<svg class="i' + (c ? " " + c : "") + '" aria-hidden="true"><use href="/assets/icons.svg#' + n + '"/></svg>'; }
  // أول حرف من أول كلمتين (بدون «م.»)
  function initials(name) {
    var w = String(name || "").replace(/^م\.?\s*/, "").trim().split(/\s+/).filter(Boolean);
    return (w[0] ? w[0][0] : "") + (w[1] ? " " + w[1][0] : "");
  }
  // رمز كل رابط بالقائمة حسب وجهته
  function navIcon(h) {
    h = String(h || "");
    if (/^\/courses/.test(h)) return "module";
    if (/^\/projects/.test(h)) return "bench";
    if (/^\/products/.test(h)) return "package";
    if (/^\/books/.test(h)) return "book";
    if (/^\/tools/.test(h)) return "calc";
    if (/^\/cad/.test(h)) return "square";
    if (/^\/team/.test(h)) return "team";
    if (/workshop/.test(h)) return "workshop";
    if (/articles/.test(h)) return "article";
    if (/^\/topics/.test(h)) return "tag";
    if (/contact/.test(h)) return "chat";
    return "arrow";
  }
  var LIB = /^\/(books|products)\/?$/;
  function link(n, mob) {
    var sec = /^#[\w-]+$/.test(n.href) ? n.href.slice(1) : "";
    var on = sec ? ' onclick="scrollToSec(\'' + sec + "');" + (mob ? "closeMob();" : "") + 'return false"' : "";
    return '<a href="' + esc(n.href) + '"' + on + ">" + (mob ? ic(navIcon(n.href)) : "") + esc(n.label) + "</a>";
  }
  // القائمة: الكتب والمنتجات تحت «المكتبة» على الشاشات الكبيرة، وكل الروابط برموزها على الجوال
  function renderNav(items) {
    var d = document.getElementById("navLinks"), m = document.getElementById("mobLinks");
    if (!d || !items || !items.length) return;
    var lib = items.filter(function (n) { return LIB.test(n.href); }), out = [], placed = false;
    items.forEach(function (n) {
      if (LIB.test(n.href)) {
        if (placed) return; placed = true;
        if (lib.length < 2) { out.push("<li>" + link(n) + "</li>"); return; }
        out.push('<li class="nav-grp"><button type="button" class="nav-gbtn" aria-expanded="false" aria-controls="navLib">المكتبة' + ic("chev") + '</button><div class="nav-sub" id="navLib">' +
          lib.map(function (x) { return '<a href="' + esc(x.href) + '">' + ic(navIcon(x.href)) + esc(x.label) + "</a>"; }).join("") + "</div></li>");
        return;
      }
      out.push("<li>" + link(n) + "</li>");
    });
    d.innerHTML = out.join("");
    if (m) m.innerHTML = items.map(function (n) { return link(n, 1); }).join("");
  }
  // فتح «المكتبة» بالضغط أو بلوحة المفاتيح
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".nav-gbtn");
    document.querySelectorAll('.nav-gbtn[aria-expanded="true"]').forEach(function (x) { if (x !== b) x.setAttribute("aria-expanded", "false"); });
    if (b) b.setAttribute("aria-expanded", b.getAttribute("aria-expanded") === "true" ? "false" : "true");
  });

  // رسومات بطاقات المهندسين: لوحة ESP32، حسّاس، وعلبة نموذج أولي — بمسار نعناعي
  var TEAM_ART = [
    '<svg viewBox="0 0 240 120" aria-hidden="true"><g class="tl"><rect x="70" y="20" width="110" height="68" rx="6"/><rect x="128" y="28" width="44" height="52" rx="3"/><path d="M135 36h30M135 36v7h30v7h-30v7h30"/><circle cx="84" cy="34" r="3.5"/><path d="M80 88v9M92 88v9M104 88v9M116 88v9M128 88v9M140 88v9M152 88v9M164 88v9"/></g><path class="tm" d="M104 97v11H40V58H16"/><circle class="tmd" cx="16" cy="58" r="4"/></svg>',
    '<svg viewBox="0 0 240 120" aria-hidden="true"><g class="tl"><rect x="62" y="28" width="96" height="64" rx="6"/><circle cx="96" cy="60" r="17"/><circle cx="96" cy="60" r="8"/><path d="M158 44h10M158 54h10M158 66h10M158 76h10"/><circle cx="74" cy="38" r="2.5"/><circle cx="74" cy="82" r="2.5"/></g><path class="tm" d="M168 54c8 0 8-16 16-16s8 32 16 32 8-16 16-16 8 0 12 0"/><circle class="tmd" cx="228" cy="54" r="4"/></svg>',
    '<svg viewBox="0 0 240 120" aria-hidden="true"><g class="tl"><path d="M78 42l22-16h100l-22 16Z"/><path d="M178 42l22-16v54l-22 16Z"/><rect x="78" y="42" width="100" height="54" rx="3"/><rect x="92" y="62" width="18" height="12" rx="2"/><path d="M124 58h40M124 68h40M124 78h26"/></g><path class="tm" d="M92 68H60c-14 0-14 26-28 26H18"/><rect class="tmd" x="8" y="88" width="12" height="12" rx="2"/></svg>'
  ];

  window.ic = ic; window.initials = initials; window.renderNav = renderNav; window.TEAM_ART = TEAM_ART; window.navIcon = navIcon;
})();
