/*
 * 3ENG.s — محوّل نصوص المقالات (Markdown مبسّط وآمن)
 * يُستخدم في: سكربت البناء (Node) + لوحة التحكم (المعاينة) + صفحة 404 (عرض المقالات الجديدة)
 *
 *  ## عنوان        ### عنوان فرعي
 *  - نقطة           1. نقطة مرقّمة
 *  > اقتباس         **عريض**   `كود`
 *  [نص](https://…)  ![وصف](https://…صورة)
 *  ``` … ```  كتلة كود
 */
(function (root) {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u) || u.startsWith("/") ? u : "");

  function inline(t) {
    // النص مُهرَّب مسبقاً — الأنماط تعمل على النص الآمن
    return t
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, u) => (safeUrl(u) ? `<img src="${u}" alt="${alt}" loading="lazy" decoding="async">` : m))
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u) => {
        const url = safeUrl(u);
        if (!url) return m;
        const ext = /^https?:\/\//i.test(url) && !/^https?:\/\/(www\.)?3engs\.com/i.test(url);
        return `<a href="${url}"${ext ? ' target="_blank" rel="noopener"' : ""}>${txt}</a>`;
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function render(src) {
    const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let para = [], list = null, code = null;
    const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join("<br>")}</p>`); para = []; } };
    const flushList = () => { if (list) { out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`); list = null; } };
    for (const raw of lines) {
      if (code) {
        if (/^```/.test(raw.trim())) { out.push(`<pre><code>${code.join("\n")}</code></pre>`); code = null; }
        else code.push(esc(raw));
        continue;
      }
      const line = esc(raw.trimEnd());
      const t = line.trim();
      if (/^```/.test(t)) { flushPara(); flushList(); code = []; continue; }
      if (!t) { flushPara(); flushList(); continue; }
      let m;
      if ((m = t.match(/^(#{1,3})\s+(.+)$/))) {
        flushPara(); flushList();
        const lvl = m[1].length === 3 ? 3 : 2;
        out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      } else if ((m = t.match(/^(?:[-•*])\s+(.+)$/))) {
        flushPara();
        if (!list || list.tag !== "ul") { flushList(); list = { tag: "ul", items: [] }; }
        list.items.push(m[1]);
      } else if ((m = t.match(/^\d+[.)]\s+(.+)$/))) {
        flushPara();
        if (!list || list.tag !== "ol") { flushList(); list = { tag: "ol", items: [] }; }
        list.items.push(m[1]);
      } else if ((m = t.match(/^&gt;\s?(.*)$/))) {
        flushPara(); flushList();
        out.push(`<blockquote>${inline(m[1])}</blockquote>`);
      } else {
        flushList();
        para.push(t);
      }
    }
    if (code) out.push(`<pre><code>${code.join("\n")}</code></pre>`);
    flushPara(); flushList();
    return out.join("\n");
  }

  // نص عادي (للوصف ووقت القراءة)
  function plain(src) {
    return String(src || "")
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#>*`•-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function readingMinutes(src) {
    return Math.max(1, Math.round(plain(src).split(" ").filter(Boolean).length / 180));
  }

  root.md3 = { render, plain, readingMinutes, esc };
})(typeof window !== "undefined" ? window : globalThis);
