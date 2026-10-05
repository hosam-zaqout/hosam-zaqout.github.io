/* 3ENG.s — حاسبات كهربائية. كل حاسبة: <div class="calc" data-tool="id">…</div>
   الحساب كله بالمتصفح — بدون سيرفر. */
(function () {
  "use strict";
  const $ = (root, sel) => root.querySelector(sel);
  const $$ = (root, sel) => [...root.querySelectorAll(sel)];
  const num = (root, name) => {
    const el = $(root, `[name="${name}"]`);
    if (!el || el.value.trim() === "") return NaN;
    return parseFloat(String(el.value).replace(/[٠-٩]/g, (c) => "٠١٢٣٤٥٦٧٨٩".indexOf(c)).replace(",", "."));
  };
  const val = (root, name) => $(root, `[name="${name}"]`)?.value;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 4700 → "4.7 k" — بادئات SI
  function si(v, unit, digits = 3) {
    if (!isFinite(v)) return "—";
    if (v === 0) return "0 " + unit;
    const P = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
    const a = Math.abs(v);
    for (const [f, p] of P) if (a >= f * 0.9995) return `${+(v / f).toPrecision(digits)} ${p}${unit}`;
    return `${+(v / 1e-12).toPrecision(digits)} p${unit}`;
  }
  const fx = (v, d = 2) => (isFinite(v) ? (+v.toFixed(d)).toLocaleString("en-US") : "—");

  function out(root, rows, note) {
    const box = $(root, ".out");
    if (!box) return;
    if (!rows) { box.innerHTML = `<p class="hint">${esc(note || "أدخل القيم لعرض النتيجة")}</p>`; return; }
    box.innerHTML = `<div class="res">${rows.map(([k, v, main]) => `<div class="r${main ? " main" : ""}"><span>${esc(k)}</span><b dir="ltr">${esc(v)}</b></div>`).join("")}</div>${note ? `<p class="hint">${note}</p>` : ""}`;
  }
  function bind(root, fn) {
    const run = () => { try { fn(); } catch (e) { console.error(e); out(root, null, "تحقق من القيم المدخلة"); } };
    root.addEventListener("input", run);
    root.addEventListener("change", run);
    run();
  }

  // سلاسل المقاومات القياسية
  const E12 = [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2];
  const E24 = [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1];
  function eSeries(r, series, dir) { // dir: 1 = أكبر أو يساوي، -1 = أصغر أو يساوي، 0 = الأقرب
    if (!(r > 0)) return NaN;
    let best = NaN, bestErr = Infinity;
    const d0 = Math.floor(Math.log10(r));
    for (let d = d0 - 1; d <= d0 + 1; d++) for (const b of series) {
      const c = +(b * 10 ** d).toPrecision(3);
      if (dir === 1 && c < r * 0.9999) continue;
      if (dir === -1 && c > r * 1.0001) continue;
      const err = Math.abs(c - r);
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return best;
  }
  const WATTS = [0.125, 0.25, 0.5, 1, 2, 3, 5, 10];
  const ratingFor = (p) => WATTS.find((w) => w >= p * 2) || NaN; // هامش أمان ×2
  const wName = (w) => ({ 0.125: "1/8 W", 0.25: "1/4 W", 0.5: "1/2 W" }[w] || (isFinite(w) ? w + " W" : "أكبر من 10 W"));

  const T = {};

  // ───────── قانون أوم والقدرة: أدخل أي قيمتين ─────────
  // على الرسمة: أي خانتين ← الخانتين الباقيات بينحسبوا (auto)
  T["ohms-law"] = (root) => {
    const KEYS = ["v", "i", "r", "p"], inp = (k) => $(root, `[name=${k}]`);
    let autos = [];
    const clearAutos = () => { autos.forEach((k) => { inp(k).value = ""; inp(k).classList.remove("auto"); }); autos = []; };
    root.addEventListener("input", (e) => { if (autos.includes(e.target.name)) { autos = autos.filter((k) => k !== e.target.name); e.target.classList.remove("auto"); } }, true);
    $(root, ".clr").onclick = () => { autos = []; KEYS.forEach((k) => { inp(k).value = ""; inp(k).classList.remove("auto"); }); root.dispatchEvent(new Event("input")); };
    bind(root, () => {
    const filled = KEYS.filter((k) => !autos.includes(k) && inp(k).value.trim() !== "");
    if (filled.length < 2) { clearAutos(); return out(root, null, "أدخل أي قيمتين من القيم الأربع على الرسمة"); }
    if (filled.length > 2) { clearAutos(); return out(root, null, "أدخل قيمتين فقط، واترك الخانتين المطلوب حسابهما فارغتين"); }
    const g = (k) => (filled.includes(k) ? num(root, k) : NaN);
    let V = g("v"), I = g("i"), R = g("r"), P = g("p");
    if (isFinite(V) && isFinite(I)) { R = V / I; P = V * I; }
    else if (isFinite(V) && isFinite(R)) { I = V / R; P = V * I; }
    else if (isFinite(V) && isFinite(P)) { I = P / V; R = V / I; }
    else if (isFinite(I) && isFinite(R)) { V = I * R; P = V * I; }
    else if (isFinite(I) && isFinite(P)) { V = P / I; R = V / I; }
    else { V = Math.sqrt(P * R); I = V / R; }
    if (![V, I, R, P].every((x) => isFinite(x) && x > 0)) { clearAutos(); return out(root, null, "القيم غير صالحة؛ يجب أن تكون موجبة"); }
    const vals = { v: V, i: I, r: R, p: P };
    autos = KEYS.filter((k) => !filled.includes(k));
    autos.forEach((k) => { inp(k).value = +vals[k].toPrecision(4); inp(k).classList.add("auto"); });
    out(root, [["الجهد V", si(V, "V")], ["التيار I", si(I, "A")], ["المقاومة R", si(R, "Ω")], ["القدرة P", si(P, "W")]]);
    });
  };

  // ───────── مقاومة الـ LED ─────────
  T["led-resistor"] = (root) => {
    const sel = $(root, "[name=color]"), vf = $(root, "[name=vf]");
    sel.addEventListener("change", () => { if (sel.value) vf.value = sel.value; });
    bind(root, () => {
      $(root, "[name=r]").value = "";
      const Vs = num(root, "vs"), Vf = num(root, "vf"), If = num(root, "if") / 1000, n = Math.max(1, Math.round(num(root, "n") || 1));
      if (![Vs, Vf, If].every(isFinite) || If <= 0) return out(root, null);
      const drop = Vs - n * Vf;
      if (drop <= 0) return out(root, null, `يجب أن يكون جهد المصدر (${Vs} V) أكبر من مجموع جهود الثنائيات (${fx(n * Vf)} V)؛ قلّل عدد الثنائيات على التوالي أو ارفع الجهد`);
      const R = drop / If, Rstd = eSeries(R, E24, 1), Ireal = drop / Rstd, P = drop * Ireal;
      $(root, "[name=r]").value = si(Rstd, "Ω");
      out(root, [
        ["المقاومة المحسوبة", si(R, "Ω")],
        ["أقرب قيمة قياسية (E24، أكبر)", si(Rstd, "Ω"), true],
        ["التيار الفعلي بها", si(Ireal, "A")],
        ["قدرة المقاومة", si(P, "W")],
        ["قدرة المقاومة المقترحة", wName(ratingFor(P))],
        ["القدرة الكلية من المصدر", si(Vs * Ireal, "W")],
      ], "اختيرت القيمة القياسية الأكبر حتى لا يتجاوز التيار المطلوب، واقتُرحت قدرة للمقاومة بهامش أمان مضاعف.");
    });
  };

  // ───────── مقسّم الجهد ─────────
  // على الرسمة: أي 3 من Vin و R1 و R2 و Vout ← الرابعة بتنحسب (auto)
  T["voltage-divider"] = (root) => {
    const KEYS = ["vin", "r1", "r2", "vout"];
    const inp = (k) => $(root, `[name=${k}]`);
    let auto = null;
    root.addEventListener("input", (e) => { if (e.target.name === auto) { auto = null; e.target.classList.remove("auto"); } }, true);
    $(root, ".clr").onclick = () => { KEYS.forEach((k) => { inp(k).value = ""; inp(k).classList.remove("auto"); }); auto = null; root.dispatchEvent(new Event("input")); };
    bind(root, () => {
      const filled = KEYS.filter((k) => k !== auto && inp(k).value.trim() !== "");
      const clearAuto = () => { if (auto) { inp(auto).value = ""; inp(auto).classList.remove("auto"); auto = null; } };
      if (filled.length < 3) { clearAuto(); return out(root, null, "أدخل ثلاث قيم من القيم الأربع على الرسمة"); }
      if (filled.length > 3) return out(root, null, "أدخل ثلاث قيم فقط، واترك الخانة المطلوب حسابها فارغة");
      const miss = KEYS.find((k) => !filled.includes(k));
      let Vin = num(root, "vin"), R1 = num(root, "r1") * 1000, R2 = num(root, "r2") * 1000, Vout = num(root, "vout");
      if (miss === "vout") Vout = Vin * R2 / (R1 + R2);
      else if (miss === "vin") Vin = Vout * (R1 + R2) / R2;
      else if (miss === "r1") R1 = R2 * (Vin - Vout) / Vout;
      else R2 = R1 * Vout / (Vin - Vout);
      const ok = [Vin, R1, R2, Vout].every((x) => isFinite(x) && x > 0) && Vout < Vin;
      if (!ok) { clearAuto(); return out(root, null, "القيم غير صالحة؛ يجب أن تكون جميعها موجبة، وأن يكون جهد الخرج أقل من جهد الدخل"); }
      if (auto && auto !== miss) clearAuto();
      auto = miss;
      const v = { vin: Vin, r1: R1 / 1000, r2: R2 / 1000, vout: Vout }[miss];
      inp(miss).value = +v.toPrecision(4);
      inp(miss).classList.add("auto");
      const I = Vin / (R1 + R2);
      const rows = [[{ vin: "Vin المحسوب", vout: "Vout المحسوب", r1: "R1 المحسوبة", r2: "R2 المحسوبة" }[miss], { vin: si(Vin, "V"), vout: si(Vout, "V"), r1: si(R1, "Ω"), r2: si(R2, "Ω") }[miss], true]];
      if (miss === "r1" || miss === "r2") {
        const s = eSeries(miss === "r1" ? R1 : R2, E24, 0);
        const Vs = miss === "r1" ? Vin * R2 / (s + R2) : Vin * s / (R1 + s);
        rows.push([`أقرب ${miss.toUpperCase()} قياسية (E24)`, si(s, "Ω")], ["Vout بالقيمة القياسية", `${si(Vs, "V")} (${fx((Vs - Vout) / Vout * 100, 2)} %)`]);
      }
      rows.push(["النسبة Vout/Vin", fx(Vout / Vin, 4)], ["تيار المقسّم", si(I, "A")], ["قدرة R1", si(I * I * R1, "W")], ["قدرة R2", si(I * I * R2, "W")]);
      out(root, rows, "النتيجة دون حِمل؛ وإذا وُصل بالخرج حِمل لا تزيد مقاومته على عشرة أضعاف R2 فسينخفض الجهد.");
    });
  };

  // ───────── ألوان المقاومات ─────────
  const COLORS = [
    ["black", "أسود", "#111", 0], ["brown", "بني", "#7b3f00", 1], ["red", "أحمر", "#d32f2f", 2], ["orange", "برتقالي", "#f57c00", 3],
    ["yellow", "أصفر", "#fbc02d", 4], ["green", "أخضر", "#388e3c", 5], ["blue", "أزرق", "#1976d2", 6], ["violet", "بنفسجي", "#7b1fa2", 7],
    ["grey", "رمادي", "#9e9e9e", 8], ["white", "أبيض", "#f5f5f5", 9], ["gold", "ذهبي", "#c9a227", -1], ["silver", "فضي", "#c0c0c0", -2],
  ];
  const TOL = { brown: 1, red: 2, green: 0.5, blue: 0.25, violet: 0.1, grey: 0.05, gold: 5, silver: 10, none: 20 };
  const C = Object.fromEntries(COLORS.map((c) => [c[0], c]));
  T["resistor-color-code"] = (root) => {
    const opts = (list) => list.map((k) => `<option value="${k}">${C[k] ? C[k][1] : "بدون"}</option>`).join("");
    const digits = COLORS.filter((c) => c[3] >= 0).map((c) => c[0]);
    const fill = (name, list, def) => { const s = $(root, `[name=${name}]`); s.innerHTML = opts(list); s.value = def; };
    fill("b1", digits.filter((d) => d !== "black"), "brown"); fill("b2", digits, "black"); fill("b3", digits, "black");
    fill("mul", [...digits, "gold", "silver"], "red"); fill("tol", ["brown", "red", "green", "blue", "violet", "grey", "gold", "silver", "none"], "gold");
    const svg = $(root, ".rsvg");
    const draw = (bands) => {
      const xs = bands.length === 4 ? [70, 100, 130, 190] : [64, 90, 116, 142, 196];
      svg.innerHTML = `<line x1="0" y1="40" x2="40" y2="40" stroke="#aaa" stroke-width="4"/><line x1="220" y1="40" x2="260" y2="40" stroke="#aaa" stroke-width="4"/>
<rect x="40" y="16" width="180" height="48" rx="20" fill="#e8d3a3" stroke="#b89c64"/>` +
        bands.map((b, i) => `<rect x="${xs[i]}" y="16" width="12" height="48" fill="${b === "none" ? "transparent" : C[b][2]}"${b === "white" ? ' stroke="#999"' : ""}/>`).join("");
    };
    // من الألوان ← القيمة
    bind(root, () => {
      const five = val(root, "bands") === "5";
      $(root, "[name=b3]").closest("label").hidden = !five;
      const ds = five ? [val(root, "b1"), val(root, "b2"), val(root, "b3")] : [val(root, "b1"), val(root, "b2")];
      const base = +ds.map((d) => C[d][3]).join("");
      const R = base * 10 ** C[val(root, "mul")][3], tol = TOL[val(root, "tol")];
      draw([...ds, val(root, "mul"), val(root, "tol")]);
      out(root, [["القيمة", si(R, "Ω"), true], ["السماحية", "± " + tol + " %"], ["المدى", `${si(R * (1 - tol / 100), "Ω")} — ${si(R * (1 + tol / 100), "Ω")}`]]);
    });
    // من القيمة ← الألوان
    const rev = $(root, "[name=rv]"), rout = $(root, ".rev-out");
    const doRev = () => {
      const R = num(root, "rv") * ({ "Ω": 1, "kΩ": 1e3, "MΩ": 1e6 }[val(root, "rvu")] || 1);
      if (!(R >= 0.1)) { rout.textContent = ""; return; }
      const five = val(root, "bands") === "5", nd = five ? 3 : 2;
      let exp = Math.floor(Math.log10(R)) - (nd - 1);
      let sig = Math.round(R / 10 ** exp);
      if (sig >= 10 ** nd) { sig /= 10; exp += 1; }
      if (exp < -2 || exp > 9) { rout.textContent = "القيمة خارج مدى الألوان"; return; }
      const ds = String(sig).padStart(nd, "0").split("").map((d) => COLORS[+d][1]);
      const mul = exp >= 0 ? COLORS[exp][1] : exp === -1 ? "ذهبي" : "فضي";
      const exact = Math.abs(sig * 10 ** exp - R) / R < 1e-6;
      rout.innerHTML = `الألوان: <b>${ds.join(" • ")} • ${mul}</b> + لون السماحية${exact ? "" : ` <span class="hint">(تقريب لـ ${si(sig * 10 ** exp, "Ω")})</span>`}`;
    };
    rev.addEventListener("input", doRev); $(root, "[name=rvu]").addEventListener("change", doRev);
  };

  // ───────── مقطع السلك + هبوط الجهد + القاطع (IEC / NEC) ─────────
  // IEC 60364-5-52، الجدول B.52.4، طريقة التركيب C، نحاس عزل PVC، حرارة محيط 30°C
  const IEC = [[1.5, 19.5, 17.5], [2.5, 27, 24], [4, 36, 32], [6, 46, 41], [10, 63, 57], [16, 85, 76], [25, 112, 96], [35, 138, 119],
    [50, 171, 144], [70, 219, 184], [95, 265, 223], [120, 308, 259], [150, 354, 299], [185, 407, 341], [240, 480, 403]];
  // NEC 310.16، نحاس، عمود 75°C (THHN/THWN) + حدود 240.4(D) للمقاطع الصغيرة
  const AWG = [["14", 2.08, 20, 15], ["12", 3.31, 25, 20], ["10", 5.26, 35, 30], ["8", 8.37, 50], ["6", 13.3, 65], ["4", 21.2, 85], ["3", 26.7, 100],
    ["2", 33.6, 115], ["1", 42.4, 130], ["1/0", 53.5, 150], ["2/0", 67.4, 175], ["3/0", 85.0, 200], ["4/0", 107.2, 230]];
  const MCB_IEC = [6, 10, 13, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400];
  const OCPD_NEC = [15, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 110, 125, 150, 175, 200, 225, 250];
  const RHO = 0.0225; // نحاس Ω·mm²/m عند حرارة التشغيل
  T["wire-size"] = (root) => {
    const pf = $(root, "[name=pf]").closest("label");
    bind(root, () => {
      const sys = val(root, "sys"), std = val(root, "std");
      pf.hidden = sys === "dc";
      const V = num(root, "v"), L = num(root, "len"), vdMax = num(root, "vd");
      const cos = sys === "dc" ? 1 : Math.min(1, Math.max(0.1, num(root, "pf") || 1));
      let I = num(root, "i");
      const Pw = num(root, "pw");
      if (!isFinite(I) && isFinite(Pw)) I = sys === "ac3" ? Pw / (Math.sqrt(3) * V * cos) : Pw / (V * cos);
      if (![V, L, vdMax, I].every(isFinite) || I <= 0 || V <= 0 || L <= 0) return out(root, null, "أدخل الجهد والطول ونسبة الهبوط، والتيار أو القدرة");
      const k = sys === "ac3" ? Math.sqrt(3) * cos : 2 * cos; // مسار الذهاب والإياب
      const vdOf = (A) => k * RHO * L * I / A;
      const Amin = k * RHO * L * I / (V * vdMax / 100);
      const rows = [["تيار الحِمل", si(I, "A")], ["أقل مقطع حسب هبوط الجهد", fx(Amin, 2) + " mm²"]];
      if (std === "iec") {
        const loaded = sys === "ac3" ? 2 : 1;
        const pick = IEC.find((r) => r[loaded] >= I && vdOf(r[0]) <= V * vdMax / 100);
        if (!pick) return out(root, rows.concat([["النتيجة", "التيار أو الطول كبير جداً؛ استخدم كوابل متوازية أو استشر مهندساً مختصاً"]]));
        const Iz = pick[loaded], In = MCB_IEC.find((b) => b >= I && b <= Iz);
        const vd = vdOf(pick[0]);
        out(root, rows.concat([
          ["المقطع المقترح (IEC)", pick[0] + " mm²", true], ["قدرة تحمّل الكابل Iz", Iz + " A"],
          ["هبوط الجهد الفعلي", `${fx(vd)} V (${fx(vd / V * 100)} %)`],
          ["القاطع المقترح In", In ? In + " A" : "لا يوجد قاطع قياسي بين تيار الحِمل وتحمّل الكابل؛ اختر مقطعاً أكبر"],
        ]), "وفق IEC 60364-5-52 (طريقة التركيب C، نحاس بعزل PVC، 30°م). وتقلّل ظروف التركيب المختلفة، كالتمديد في مواسير مدفونة أو تجميع الكوابل أو ارتفاع الحرارة، من قدرة التحمّل.");
      } else {
        const cont = $(root, "[name=cont]").checked, Ireq = cont ? I * 1.25 : I;
        const pick = AWG.find((r) => r[2] >= Ireq && vdOf(r[1]) <= V * vdMax / 100);
        if (!pick) return out(root, rows.concat([["النتيجة", "أكبر من 4/0 AWG؛ استخدم مقاطع kcmil أو كوابل متوازية"]]));
        const maxOcpd = pick[3] || pick[2];
        const ocpd = OCPD_NEC.find((b) => b >= Ireq);
        const vd = vdOf(pick[1]);
        out(root, rows.concat([
          ["المقطع المقترح (NEC)", pick[0] + " AWG", true], ["المساحة", pick[1] + " mm²"], ["قدرة التحمّل (75°C)", pick[2] + " A"],
          ["هبوط الجهد الفعلي", `${fx(vd)} V (${fx(vd / V * 100)} %)`],
          ["القاطع المقترح", ocpd && ocpd <= maxOcpd ? ocpd + " A" : `اختر مقطعاً أكبر (أقصى قاطع لهذا السلك ${maxOcpd} A)`],
        ]), "وفق الجدول 310.16 من NEC (نحاس، عمود 75°م) والبند 240.4(D) للمقاطع من 14 إلى 10 AWG." + (cont ? " وضُرب التيار في 1.25 لأن الحِمل مستمر." : ""));
      }
    });
  };

  // ───────── منظومة شمسية منفصلة (Off-Grid) ─────────
  T["solar-system"] = (root) => {
    const tbody = $(root, "tbody");
    const row = (n = "", w = "", q = 1, h = "") => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><input name="ln" value="${esc(n)}" placeholder="مثال: ثلاجة"></td><td><input name="lw" type="number" min="0" step="any" value="${w}" dir="ltr"></td><td><input name="lq" type="number" min="1" step="1" value="${q}" dir="ltr"></td><td><input name="lh" type="number" min="0" max="24" step="any" value="${h}" dir="ltr"></td><td><button type="button" class="del" title="حذف">✕</button></td>`;
      tr.querySelector(".del").onclick = () => { tr.remove(); root.dispatchEvent(new Event("input")); };
      tbody.appendChild(tr);
    };
    [["مصابيح LED", 10, 6, 6], ["ثلاجة", 150, 1, 10], ["موجّه الإنترنت", 12, 1, 24], ["شاحن حاسوب محمول", 65, 1, 5]].forEach((r) => row(...r));
    $(root, ".add").onclick = () => { row(); };
    bind(root, () => {
      let E = 0, Pmax = 0;
      for (const tr of $$(tbody, "tr")) {
        const g = (n) => parseFloat(tr.querySelector(`[name=${n}]`).value) || 0;
        E += g("lw") * g("lq") * g("lh"); Pmax += g("lw") * g("lq");
      }
      const psh = num(root, "psh"), eff = num(root, "eff") / 100, pw = num(root, "pw"), days = num(root, "days");
      const dod = num(root, "dod") / 100, inv = 0.9;
      let Vb = +val(root, "vb");
      if (!(E > 0)) return out(root, null, "أضف الأحمال (القدرة وعدد ساعات التشغيل)");
      if (![psh, eff, pw, days, dod].every((x) => x > 0)) return out(root, null);
      const auto = !Vb; if (auto) Vb = E < 1500 ? 12 : E < 4000 ? 24 : 48;
      const Epv = E / inv;                    // الطاقة المطلوبة قبل خسائر الإنفرتر
      const Wp = Epv / (psh * eff), panels = Math.ceil(Wp / pw);
      const Ah = Epv * days / (Vb * dod);
      const invW = Pmax * 1.25;
      const Icc = panels * pw / Vb * 1.25;
      out(root, [
        ["الاستهلاك اليومي", fx(E / 1000, 2) + " kWh"], ["أقصى حِمل لحظي", fx(Pmax, 0) + " W"],
        ["قدرة الألواح المطلوبة", fx(Wp, 0) + " Wp"], [`عدد الألواح (${pw} W)`, panels + " لوح", true],
        [`جهد نظام البطاريات${auto ? " (مقترح)" : ""}`, Vb + " V"], ["سعة البطاريات", fx(Ah, 0) + " Ah @ " + Vb + " V", true],
        ["قدرة العاكس (بهامش 25%)", fx(invW, 0) + " W", true], ["تيار منظّم الشحن", "≥ " + fx(Icc, 0) + " A"],
      ], "تقدير مبدئي بافتراض كفاءة عاكس 90%. للأحمال التي تحتوي محركات (كالثلاجة والمضخة والمكيّف) اختر عاكساً يتحمّل تيار البدء بمقدار ضعفين إلى ثلاثة أضعاف قدرتها، وراجع مواصفات الألواح والبطاريات لدى الشركة المصنّعة.");
    });
  };

  // "4.7k" ← 4700 — بادئات: p n u µ m k M G
  function parseSI(s) {
    const m = String(s).trim().replace(",", ".").match(/^([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([pnuµmkKMG]?)/);
    if (!m) return NaN;
    return parseFloat(m[1]) * ({ p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, G: 1e9 }[m[2]] || 1);
  }
  const cap = (root, base) => num(root, base) * ({ pF: 1e-12, nF: 1e-9, "µF": 1e-6, mF: 1e-3, F: 1 }[val(root, base + "u")] || 1);
  const res = (root, base) => num(root, base) * ({ "Ω": 1, "kΩ": 1e3, "MΩ": 1e6 }[val(root, base + "u")] || 1);

  // ───────── التوالي والتوازي ─────────
  // رمز أفقي من x1 لـ x2 على ارتفاع y: مقاومة (زيغزاغ) / مكثف (لوحين) / ملف (أقواس)
  function sym(kind, x1, x2, y) {
    const c = (x1 + x2) / 2;
    if (kind === "c") return `<path d="M${x1} ${y}H${c - 5}M${c + 5} ${y}H${x2}"/><path d="M${c - 5} ${y - 16}V${y + 16}M${c + 5} ${y - 16}V${y + 16}" stroke-width="3.5"/>`;
    if (kind === "l") return `<path d="M${x1} ${y}H${c - 24}${" a6 6 0 0 1 12 0".repeat(4)}H${x2}"/>`;
    let d = `M${x1} ${y}H${c - 24}`;
    for (let i = 0; i < 6; i++) d += `L${c - 24 + 8 * (i + 0.5)} ${y + (i % 2 ? 9 : -9)}`;
    return `<path d="${d}L${c + 24} ${y}H${x2}"/>`;
  }
  function spFigure(kind, conn, vals, u) {
    const n = Math.min(vals.length, 6), more = vals.length > 6, lab = (v) => esc(si(v, u)).replace(/ /g, "");
    let g = "", t = "", W, H;
    if (conn === "s") {
      W = 480; H = 120; const x0 = 30, x1 = 450, seg = (x1 - x0) / n, y = 60;
      for (let i = 0; i < n; i++) { const a = x0 + seg * i, b = a + seg; g += sym(kind, a, b, y); t += `<text x="${(a + b) / 2}" y="${y - 24}" text-anchor="middle">${lab(vals[i])}</text>`; }
      g += `<circle cx="${x0 - 6}" cy="${y}" r="6"/><circle cx="${x1 + 6}" cy="${y}" r="6"/>`;
      t += `<text x="${x0 - 6}" y="${y + 30}" text-anchor="middle">A</text><text x="${x1 + 6}" y="${y + 30}" text-anchor="middle">B</text>`;
    } else {
      W = 480; H = 210; const yT = 40, yB = 170, x0 = 70, gap = Math.min(85, 380 / n);
      const xs = [...Array(n)].map((_, i) => x0 + 40 + gap * i), xe = xs[n - 1];
      g += `<path d="M${x0} ${yT}H${xe}M${x0} ${yB}H${xe}"/><circle cx="${x0 - 6}" cy="${yT}" r="6"/><circle cx="${x0 - 6}" cy="${yB}" r="6"/>`;
      xs.forEach((x, i) => { const m = (yT + yB) / 2; g += `<g transform="rotate(90 ${x} ${m})">${sym(kind, x - 65, x + 65, m)}</g><circle cx="${x}" cy="${yT}" r="4" fill="currentColor"/><circle cx="${x}" cy="${yB}" r="4" fill="currentColor"/>`; t += `<text x="${x + 22}" y="${m + 5}" text-anchor="start">${lab(vals[i])}</text>`; });
      t += `<text x="${x0 - 26}" y="${yT + 5}" text-anchor="middle">A</text><text x="${x0 - 26}" y="${yB + 5}" text-anchor="middle">B</text>`;
    }
    if (more) t += `<text x="${W - 10}" y="${H - 6}" text-anchor="end">+${vals.length - 6} عناصر أخرى</text>`;
    return `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round">${g}</g>${t}</svg>`;
  }
  T["series-parallel"] = (root) => bind(root, () => {
    const fig = $(root, ".sp-fig");
    const vals = String(val(root, "list") || "").split(/[\s,،;+]+/).filter(Boolean).map(parseSI);
    if (vals.length < 2 || vals.some((v) => !(v > 0))) { fig.innerHTML = ""; return out(root, null, "اكتب قيمتين أو أكثر مفصولة بفواصل، مثل: 10k, 4.7k, 2.2k"); }
    const kind = val(root, "kind"), conn = val(root, "conn"), u = kind === "c" ? "F" : kind === "l" ? "H" : "Ω";
    const sum = vals.reduce((a, b) => a + b, 0), inv = 1 / vals.reduce((a, b) => a + 1 / b, 0);
    // المكثفات عكس المقاومات والملفات
    const ser = kind === "c" ? inv : sum, par = kind === "c" ? sum : inv;
    fig.innerHTML = spFigure(kind, conn, vals, u);
    const main = conn === "s" ? ["المكافئ على التوالي", si(ser, u), true] : ["المكافئ على التوازي", si(par, u), true];
    out(root, [main, ["عدد العناصر", String(vals.length)], [conn === "s" ? "المكافئ لو وُصلت على التوازي" : "المكافئ لو وُصلت على التوالي", si(conn === "s" ? par : ser, u)]],
      kind === "c" ? "تُجمع المكثفات على التوازي، ويُحسب مكافئها على التوالي بمجموع المقلوبات." : "تُجمع القيم على التوالي، ويُحسب المكافئ على التوازي بمجموع المقلوبات.");
  });

  // ───────── ثابت الزمن RC ─────────
  T["rc-time-constant"] = (root) => bind(root, () => {
    const R = res(root, "r"), C = cap(root, "c"), V = num(root, "v"), t = num(root, "t") / 1000;
    if (!(R > 0 && C > 0)) return out(root, null);
    const tau = R * C, rows = [["ثابت الزمن τ = R × C", si(tau, "s"), true], ["الشحن 63% (1τ)", si(tau, "s")], ["شحن شبه كامل 99.3% (5τ)", si(5 * tau, "s")], ["تردد القطع fc = 1/(2πRC)", si(1 / (2 * Math.PI * tau), "Hz"), true]];
    if (V > 0 && t >= 0) rows.push([`جهد المكثف بعد ${si(t, "s")} (شحن)`, si(V * (1 - Math.exp(-t / tau)), "V")], [`جهد المكثف بعد ${si(t, "s")} (تفريغ)`, si(V * Math.exp(-t / tau), "V")]);
    out(root, rows);
  });

  // ───────── مؤقت 555 ─────────
  T["timer-555"] = (root) => {
    const sync = () => $$(root, "[data-mode]").forEach((el) => (el.hidden = el.dataset.mode !== val(root, "mode")));
    root.addEventListener("change", sync); sync();
    bind(root, () => {
      const mode = val(root, "mode");
      if (mode === "bi") {
        return out(root, [["التوقيت", "لا يوجد؛ يتغير الخرج بالأزرار", true], ["الضغط على زر الضبط (الطرف 2 إلى الأرضي)", "يصبح الخرج مرتفعاً ويبقى"], ["الضغط على زر إعادة الضبط (الطرف 4 إلى الأرضي)", "يصبح الخرج منخفضاً ويبقى"], ["مقاومات الرفع المقترحة", "10 kΩ"]],
          "في هذا الوضع يعمل المؤقت قلّاباً (ذاكرة بِت واحد)، ويفيد في تشغيل حِمل وإطفائه بزرّين أو في إزالة ارتداد الأزرار.");
      }
      if (mode === "mono") {
        const R = res(root, "r"), C = cap(root, "cm");
        if (!(R > 0 && C > 0)) return out(root, null);
        return out(root, [["مدة النبضة t = 1.1 × R × C", si(1.1 * R * C, "s"), true]], "تخرج نبضة واحدة ثابتة المدة عند كل ضغطة على زر الإطلاق.");
      }
      const C = cap(root, "c");
      const R1 = res(root, "r1"), R2 = res(root, "r2");
      if (!(R1 > 0 && R2 > 0 && C > 0)) return out(root, null);
      const th = 0.693 * (R1 + R2) * C, tl = 0.693 * R2 * C, f = 1 / (th + tl);
      out(root, [["التردد", si(f, "Hz"), true], ["زمن المستوى المرتفع", si(th, "s")], ["زمن المستوى المنخفض", si(tl, "s")], ["زمن الدورة", si(th + tl, "s")], ["نسبة التشغيل", fx(th / (th + tl) * 100, 1) + " %", true]],
        "نسبة التشغيل في هذا التوصيل أكبر من 50% دائماً، وللحصول على نسبة أقل يوضع ثنائي على التوازي مع R2.");
    });
  };

  // ───────── القدرة ثلاثية الطور ─────────
  T["three-phase-power"] = (root) => bind(root, () => {
    const V = num(root, "v"), pf = num(root, "pf");
    let I = num(root, "i"); const P = num(root, "p") * 1000;
    if (!(V > 0 && pf > 0 && pf <= 1)) return out(root, null);
    if (!(I > 0) && P > 0) I = P / (Math.sqrt(3) * V * pf);
    if (!(I > 0)) return out(root, null, "أدخل التيار أو القدرة");
    const S = Math.sqrt(3) * V * I, Pw = S * pf, Q = S * Math.sin(Math.acos(pf));
    out(root, [["التيار لكل خط", si(I, "A"), true], ["القدرة الفعّالة P", si(Pw, "W"), true], ["القدرة الظاهرية S", si(S, "VA")], ["القدرة غير الفعّالة Q", si(Q, "VAR")], ["جهد الطور (Y)", si(V / Math.sqrt(3), "V")]],
      "جهد الخط هو الجهد بين طورين، مثل 400 فولت.");
  });

  // ───────── تحسين معامل القدرة ─────────
  T["power-factor-correction"] = (root) => bind(root, () => {
    const P = num(root, "p") * 1000, pf1 = num(root, "pf1"), pf2 = num(root, "pf2"), V = num(root, "v"), f = num(root, "f"), ph = val(root, "ph");
    if (![P, pf1, pf2, V, f].every((x) => x > 0) || pf1 >= 1 || pf2 > 1) return out(root, null);
    if (pf2 <= pf1) return out(root, null, "يجب أن يكون معامل القدرة المطلوب أعلى من الحالي");
    const Qc = P * (Math.tan(Math.acos(pf1)) - Math.tan(Math.acos(pf2))), w = 2 * Math.PI * f;
    const rows = [["قدرة المكثفات المطلوبة Qc", fx(Qc / 1000, 2) + " kVAR", true], ["التيار قبل", si(ph === "3" ? P / (Math.sqrt(3) * V * pf1) : P / (V * pf1), "A")], ["التيار بعد", si(ph === "3" ? P / (Math.sqrt(3) * V * pf2) : P / (V * pf2), "A")]];
    if (ph === "3") rows.push(["سعة كل مكثف (توصيل دلتا)", si(Qc / (3 * w * V * V), "F")], ["سعة كل مكثف (توصيل نجمة)", si(Qc / (w * V * V), "F")]);
    else rows.push(["سعة المكثف", si(Qc / (w * V * V), "F"), true]);
    out(root, rows, "يجب أن تكون المكثفات مخصصة لتحسين معامل القدرة، وبجهد تشغيل مناسب.");
  });

  // ───────── عمر البطارية للأجهزة المدمجة ─────────
  T["battery-life"] = (root) => bind(root, () => {
    const C = num(root, "cap"), Ia = num(root, "ia"), Is = num(root, "is") / 1000, ta = num(root, "ta"), T0 = num(root, "period"), der = num(root, "der") / 100;
    if (![C, Ia, ta, T0].every((x) => x > 0) || !(Is >= 0) || ta > T0) return out(root, null, "تأكد أن زمن التشغيل أقل من زمن الدورة");
    const Iavg = (Ia * ta + Is * (T0 - ta)) / T0, h = C * (der || 1) / Iavg;
    out(root, [["متوسط التيار", fx(Iavg, 4) + " mA", true], ["عمر البطارية", h >= 48 ? fx(h / 24, 1) + " يوم" : fx(h, 1) + " ساعة", true], ["بالساعات", fx(h, 0) + " h"], ["نسبة وقت التشغيل", fx(ta / T0 * 100, 3) + " %"]],
      "يُهمل هذا التقدير التفريغ الذاتي للبطارية وانخفاض سعتها مع الحرارة.");
  });

  // ───────── ADC ─────────
  T["adc-calculator"] = (root) => bind(root, () => {
    const bits = num(root, "bits"), Vref = num(root, "vref"), raw = num(root, "raw"), Vin = num(root, "vin"), ratio = num(root, "ratio") || 1;
    if (!(bits > 0 && Vref > 0)) return out(root, null);
    const max = 2 ** bits - 1, lsb = Vref / 2 ** bits;
    const rows = [["أعلى قراءة", String(max)], ["دقة القراءة (LSB)", si(lsb, "V"), true]];
    if (raw >= 0) rows.push([`الجهد عند القراءة ${raw}`, si(raw / max * Vref, "V"), true], ["الجهد الأصلي قبل المقسّم", si(raw / max * Vref * ratio, "V")]);
    if (Vin >= 0) rows.push([`القراءة المتوقعة لـ ${Vin} V`, String(Math.min(max, Math.round(Vin / ratio / Vref * max)))]);
    out(root, rows, "ملاحظة: محوّل ESP32 غير خطي قرب طرفي المدى؛ وللحصول على دقة أعلى استخدم الدالة analogReadMilliVolts().");
  });

  // ───────── PWM ─────────
  T["pwm-calculator"] = (root) => bind(root, () => {
    const Vh = num(root, "vh"), duty = num(root, "duty"), clk = num(root, "clk") * 1e6, f = num(root, "f");
    const rows = [];
    if (Vh > 0 && duty >= 0 && duty <= 100) rows.push(["الجهد المتوسط", si(Vh * duty / 100, "V"), true]);
    if (clk > 0 && f > 0) {
      const bitsMax = Math.floor(Math.log2(clk / f));
      rows.push(["زمن الدورة", si(1 / f, "s")], ["زمن المستوى المرتفع", isFinite(duty) ? si(duty / 100 / f, "s") : "—"], ["أقصى دقة ممكنة", bitsMax + " bit", true], ["قيمة نسبة التشغيل بهذه الدقة", isFinite(duty) ? String(Math.round(duty / 100 * (2 ** bitsMax - 1))) + " من " + (2 ** bitsMax - 1) : "—"]);
    }
    if (!rows.length) return out(root, null);
    out(root, rows, "أقصى دقة هي اللوغاريتم الثنائي لنسبة تردد الساعة إلى تردد الإشارة؛ فمثلاً يعطي ESP32 بساعة 80 ميغاهرتز على تردد 5 كيلوهرتز دقة 13 بِت.");
  });

  // ───────── UART Baud ─────────
  T["uart-baud"] = (root) => bind(root, () => {
    const F = num(root, "clk") * 1e6, B = num(root, "baud"), x2 = $(root, "[name=u2x]").checked, div = x2 ? 8 : 16;
    if (!(F > 0 && B > 0)) return out(root, null);
    const ubrr = Math.max(0, Math.round(F / (div * B) - 1)), actual = F / (div * (ubrr + 1)), err = (actual - B) / B * 100;
    out(root, [["قيمة UBRR", String(ubrr), true], ["السرعة الفعلية", fx(actual, 1)], ["نسبة الخطأ", fx(err, 2) + " %", true], ["الحالة", Math.abs(err) <= 2 ? "✅ مقبول (حتى 2%)" : (x2 ? "⚠️ خطأ كبير؛ جرّب سرعة أقل أو كريستالاً مختلفاً" : "⚠️ خطأ كبير؛ جرّب السرعة المضاعفة أو كريستالاً مختلفاً")]],
      "الحساب وفق صيغة متحكمات AVR مثل Arduino Uno.");
  });

  document.querySelectorAll(".calc[data-tool]").forEach((el) => T[el.dataset.tool] && T[el.dataset.tool](el));
})();
