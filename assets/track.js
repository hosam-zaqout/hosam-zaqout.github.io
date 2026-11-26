/* 3ENG.s — عداد زيارات خاص (بدون كوكيز وبدون بيانات شخصية).
   يرسل: المسار، ومصدر الزيارة عند بدء الجلسة، وهل الزائر جديد/فريد اليوم، ونوع الجهاز.
   الأحداث: window.track3("buy", "courses:abc") — أو تلقائياً للنقرات على واتساب والشراء والتنزيل وأول استخدام لحاسبة. */
(function () {
  "use strict";
  var URL_ = "https://us-central1-engs-website.cloudfunctions.net/track";
  var ls = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var ss = { get: function (k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  if (ls.get("3e-notrack") === "1" || !/(^|\.)3engs\.com$/.test(location.hostname) || navigator.webdriver) { window.track3 = function () {}; return; }
  function send(o) {
    var b = JSON.stringify(o);
    try { if (navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([b], { type: "text/plain" }))) return; } catch (e) {}
    try { fetch(URL_, { method: "POST", body: b, keepalive: true, mode: "no-cors", headers: { "Content-Type": "text/plain" } }); } catch (e) {}
  }
  var day = new Date(Date.now() + 2 * 3600e3).toISOString().slice(0, 10);
  var v = { p: location.pathname };
  if (!ls.get("3e-v")) { ls.set("3e-v", day); v.n = 1; }
  if (ls.get("3e-day") !== day) { ls.set("3e-day", day); v.u = 1; v.m = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? 1 : 0; }
  if (!ss.get("3e-s")) {
    ss.set("3e-s", "1"); v.s = 1;
    var r = document.referrer || "";
    try { if (r && new URL(r).hostname.replace(/^www\./, "") === location.hostname.replace(/^www\./, "")) r = ""; } catch (e) {}
    if (r) v.r = r.slice(0, 200);
    var c = new URLSearchParams(location.search).get("utm_source");
    if (c) v.c = c.slice(0, 40);
  }
  send(v);

  var once = {};
  window.track3 = function (e, x) { if (!e) return; send({ p: location.pathname, e: String(e), x: x ? String(x).slice(0, 80) : undefined }); };
  document.addEventListener("click", function (ev) {
    var a = ev.target && ev.target.closest && ev.target.closest("a,button");
    if (!a) return;
    var h = a.getAttribute("href") || "";
    if (/wa\.me|whatsapp\.com/.test(h)) return window.track3("wa", location.pathname.split("/")[1] || "home");
    var m = h.match(/[?&]buy=([^&]+)/);
    if (m) return window.track3("buy", decodeURIComponent(m[1]));
    if (a.hasAttribute("download") || /\.(exe|zip|pdf|rar)(\?|$)/i.test(h)) return window.track3("download", h.split("/").pop().split("?")[0]);
  }, true);
  document.addEventListener("input", function (ev) {
    var c = ev.target && ev.target.closest && ev.target.closest(".calc[data-tool]");
    if (c && !once[c.dataset.tool]) { once[c.dataset.tool] = 1; window.track3("tool", c.dataset.tool); }
  }, true);
})();
