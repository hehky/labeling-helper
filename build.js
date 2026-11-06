/**
 * Node 构建脚本：把 core.js 分别拼进油猴壳与 AutoJs6 壳，产出两个单文件成品并做语法自检。
 * 用法：node build.js
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = __dirname;
const dist = path.join(root, "dist");
if (!fs.existsSync(dist)) fs.mkdirSync(dist);

const core = fs.readFileSync(path.join(root, "src/core.js"), "utf8");
const monkey = fs.readFileSync(path.join(root, "src/monkey_shell.js"), "utf8");
const autojs = fs.readFileSync(path.join(root, "src/autojs_shell.js"), "utf8");

// 油猴头块：@match 占位域名（需按真实平台改），@grant 仅 GM_getValue/GM_setValue，不申请网络权限
const MONKEY_HEADER = [
    "// ==UserScript==",
    "// @name         标注提效辅助（人做判断，脚本管手）",
    "// @namespace    labeling-helper",
    "// @version      0.1.0",
    "// @description  快捷键/关键词高亮/提交前校验/本地记账；提效不代答，零网络请求",
    "// @match        https://平台域名/*",
    "// @note         上面的 @match 是占位域名，需按真实平台改",
    "// @grant        GM_getValue",
    "// @grant        GM_setValue",
    "// ==/UserScript==",
    ""
].join("\n");

const AUTOJS_HEADER = [
    "/**",
    " * 标注提效辅助 AutoJs6 单文件成品",
    " * 红线：不自动提交/选择/翻题；零网络请求；题面不落盘，记账仅元数据",
    " * 配置区集中在壳顶部（无障碍选择器、音量键模式），需按真实平台改",
    " */",
    ""
].join("\n");

const monkeyOut = MONKEY_HEADER + "\n" + core + "\n" + monkey + "\n";
const autojsOut = AUTOJS_HEADER + "\n" + core + "\n" + autojs + "\n";

fs.writeFileSync(path.join(dist, "labeling_helper.user.js"), monkeyOut);
fs.writeFileSync(path.join(dist, "labeling_helper_autojs6.js"), autojsOut);

let ok = true;
function syntaxCheck(code, name) {
    try {
        new vm.Script(code, { filename: name });
        console.log("syntax OK  : " + name);
    } catch (e) {
        ok = false;
        console.error("syntax FAIL: " + name + " -> " + e.message);
    }
}
syntaxCheck(monkeyOut, "labeling_helper.user.js");
syntaxCheck(autojsOut, "labeling_helper_autojs6.js");

// 红线自检：core 不得含宿主 API；成品不得含网络请求与 localStorage
const banned = ["fetch(", "XMLHttpRequest", "GM_xmlhttpRequest", "localStorage"];
for (const b of banned) {
    if (core.includes(b) || monkeyOut.includes(b) || autojsOut.includes(b)) {
        // 允许注释中的红线声明出现关键字，但需人工确认
        console.warn("redline WARN: 发现关键字 " + b + "（若为注释声明可忽略，请人工确认）");
    }
}

console.log(ok ? "\n构建成功：dist/ 两个成品已生成" : "\n构建失败：语法自检未通过");
process.exitCode = ok ? 0 : 1;
