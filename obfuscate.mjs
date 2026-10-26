// 🔒 تعقيد كود المتصفح (Obfuscation) قبل النشر
// المصدر المقروء في src/ ← النسخة المنشورة (غير مقروءة) في مكانها الأصلي
// التشغيل: npm install --no-save --no-package-lock javascript-obfuscator@4 sharp@0.34 && node obfuscate.mjs
// ⚠️ عدّل دائماً الملفات في src/ — الملفات المنشورة بتنكتب من جديد كل مرة
import fs from "node:fs/promises";
import path from "node:path";
import JavaScriptObfuscator from "javascript-obfuscator";

const ROOT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1"));
// ملفات JS كاملة
const JS = ["assets/tools.js", "assets/tools-pro.js", "assets/cad-pro.js", "assets/checkout.js"];
// صفحات HTML: بنعقّد السكربتات المضمّنة فيها بس (بدون src)
const HTML = ["cad/breadboard/index.html", "cad/index.html"];

// متوسط القوة: الأسماء العامة (window.*، onclick) بتضل زي ما هي عشان الصفحات تشتغل
const OPTS = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.4,
  deadCodeInjection: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  simplify: true,
  splitStrings: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
  stringArrayRotate: true,
  stringArrayShuffle: true,
  transformObjectKeys: false,
  unicodeEscapeSequence: false,
};
const HEAD = "/* © 3ENG.s — www.3engs.com — جميع الحقوق محفوظة. يُمنع نسخ هذا الكود أو إعادة استخدامه دون إذن خطي. */\n";

const obf = (code, isModule) => JavaScriptObfuscator.obfuscate(code, { ...OPTS, ...(isModule ? { target: "browser" } : {}) }).getObfuscatedCode();

let n = 0;
for (const rel of JS) {
  const src = await fs.readFile(path.join(ROOT, "src", rel), "utf8");
  await fs.writeFile(path.join(ROOT, rel), HEAD + obf(src));
  console.log("🔒", rel, `${(src.length / 1024).toFixed(1)}KB`);
  n++;
}
for (const rel of HTML) {
  let html = await fs.readFile(path.join(ROOT, "src", rel), "utf8");
  let k = 0;
  html = html.replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g, (m, attrs = "", code) => {
    if (/\bsrc=/.test(attrs) || /application\/ld\+json/.test(attrs) || !code.trim() || code.length < 400) return m;
    // سكربتات import (module) — الـ import لازم يضل بأول الملف، فبنعقّد الباقي بس
    if (/type=["']module["']/.test(attrs)) {
      const imports = [];
      const body = code.replace(/^\s*import[\s\S]*?from\s*["'][^"']+["'];?\s*$/gm, (im) => { imports.push(im.trim()); return ""; });
      k++;
      return `<script${attrs}>\n${imports.join("\n")}\n${obf(body, true)}</script>`;
    }
    k++;
    return `<script${attrs}>${obf(code)}</script>`;
  });
  html = html.replace(/<head>/i, `<head>\n<!-- © 3ENG.s — جميع الحقوق محفوظة -->`);
  await fs.writeFile(path.join(ROOT, rel), html);
  console.log("🔒", rel, `${k} سكربت`);
  n++;
}
console.log(`✅ ${n} ملفات معقّدة`);
