// ==UserScript==
// @name         标注提效辅助（人做判断，脚本管手）
// @namespace    labeling-helper
// @version      0.1.0
// @description  快捷键/关键词高亮/提交前校验/本地记账；提效不代答，零网络请求
// @match        https://平台域名/*
// @note         上面的 @match 是占位域名，需按真实平台改
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/**
 * 标注提效脚本 - 共用核心 (core.js)
 *
 * 红线（硬约束）：
 *   - 本文件零宿主依赖：不出现 GM_*、window、document、storages、floaty、http 等任何宿主 API
 *   - 只通过注入的抽象接口工作：storage.get/set、ui.notify、ui.confirm、exporter.save
 *   - 不自动提交、不自动选择任何答案、不自动翻题，每次提交都由人触发
 *   - 不做任何网络请求（无 fetch/XHR/GM_xmlhttpRequest/http）
 *   - 题面 question 只在内存中用于高亮与校验，绝不写入任何存储或导出
 *   - 语法为 ES5：不使用 class、可选链、async/await、展开运算符，保证 AutoJs6 Rhino 可运行
 *
 * 导出方式：Node 下 module.exports；油猴/AutoJs6 下挂到全局 LabelCore。
 */
(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        module.exports = factory();
    } else {
        this.LabelCore = factory();
    }
})(function () {

    var STORAGE_KEY = "label_ledger_records_v1";

    // ===== 规则表（配置位，拿到真实平台后按题型调整，不改逻辑） =====
    var defaultRules = {
        highlight: {
            keywords: ["不", "没有", "无", "错误", "正确", "属于", "不属于", "指代", "前者", "后者"]
        },
        cards: {
            single: { title: "单选", summary: "只选一个最符合项；警惕否定词与指代对象" },
            multi: { title: "多选", summary: "可选多项；漏选与多选都影响判定" },
            text: { title: "填空", summary: "按要求格式填写，注意单位与边界" }
        },
        validate: {
            textPattern: "",       // 填空格式正则，如 "^\\d+$"；空串表示不校验格式
            forbidKeywords: []     // 规则卡冲突：答案文本命中即提示，如 ["以上都对"]
        }
    };

    function now() {
        return new Date().getTime();
    }

    function isArray(v) {
        return Object.prototype.toString.call(v) === "[object Array]";
    }

    function optionText(opt) {
        if (opt === null || opt === undefined) return "";
        if (typeof opt === "string") return opt;
        if (typeof opt.text === "string") return opt.text;
        if (typeof opt.label === "string") return opt.label;
        return String(opt);
    }

    function answerToText(model) {
        var parts = [];
        var sel = model.selected || [];
        for (var i = 0; i < sel.length; i++) {
            if (model.type === "text") {
                parts.push(String(sel[i]));
            } else {
                var idx = sel[i];
                var opt = (model.options || [])[idx];
                parts.push(optionText(opt));
            }
        }
        return parts.join(" ");
    }

    /**
     * 提交前校验（护栏不是闸门，只返回问题，不阻止提交）
     * @param model {id,question,options,selected,type,elapsed}
     * @param cfg   可选 {textPattern, forbidKeywords}
     * @returns { ok:Boolean, problems:[{code,message}] }
     */
    function validate(model, cfg) {
        var problems = [];
        if (!model || typeof model !== "object") {
            return { ok: false, problems: [{ code: "BAD_MODEL", message: "题目模型缺失" }] };
        }
        var conf = cfg || {};
        var sel = isArray(model.selected) ? model.selected : [];
        var type = model.type || "single";

        if (type === "text") {
            var txt = sel.length > 0 ? String(sel[0]) : "";
            if (txt.replace(/^\s+|\s+$/g, "") === "") {
                problems.push({ code: "EMPTY_TEXT", message: "填空题未填写答案" });
            } else if (conf.textPattern) {
                var re = new RegExp(conf.textPattern);
                if (!re.test(txt)) {
                    problems.push({ code: "BAD_FORMAT", message: "答案格式不符: /" + conf.textPattern + "/" });
                }
            }
        } else if (type === "single") {
            if (sel.length === 0) {
                problems.push({ code: "NO_SELECTION", message: "单选题漏选" });
            } else if (sel.length > 1) {
                problems.push({ code: "MULTI_ON_SINGLE", message: "单选题选择了 " + sel.length + " 项" });
            }
        } else if (type === "multi") {
            if (sel.length === 0) {
                problems.push({ code: "NO_SELECTION", message: "多选题漏选" });
            }
        }

        var forbid = conf.forbidKeywords || [];
        if (forbid.length > 0) {
            var text = answerToText(model);
            for (var f = 0; f < forbid.length; f++) {
                if (forbid[f] && text.indexOf(forbid[f]) >= 0) {
                    problems.push({ code: "RULE_CONFLICT", message: "与规则卡冲突：答案含「" + forbid[f] + "」" });
                }
            }
        }

        return { ok: problems.length === 0, problems: problems };
    }

    function csvEscape(v) {
        var s = (v === null || v === undefined) ? "" : String(v);
        if (/[",\n\r]/.test(s)) {
            return "\"" + s.replace(/"/g, "\"\"") + "\"";
        }
        return s;
    }

    function joinAnswer(v) {
        return isArray(v) ? v.join("|") : (v === null || v === undefined ? "" : String(v));
    }

    var CSV_HEADER = "id,type,elapsedMs,initialSelected,changeCount,finalAnswer,toolEnabled,standardAnswer,timestamp";

    /**
     * 导出 CSV（只含元数据，绝不含 question 题面原文）
     */
    function toCSV(records) {
        var lines = [CSV_HEADER];
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            lines.push([
                csvEscape(r.id),
                csvEscape(r.type),
                csvEscape(r.elapsedMs),
                csvEscape(joinAnswer(r.initialSelected)),
                csvEscape(r.changeCount),
                csvEscape(joinAnswer(r.finalAnswer)),
                csvEscape(r.toolEnabled),
                csvEscape(r.standardAnswer),
                csvEscape(r.timestamp)
            ].join(","));
        }
        return lines.join("\n");
    }

    function median(numbers) {
        if (!numbers || numbers.length === 0) return 0;
        var arr = numbers.slice(0).sort(function (a, b) { return a - b; });
        var mid = Math.floor(arr.length / 2);
        if (arr.length % 2 === 1) return arr[mid];
        return (arr[mid - 1] + arr[mid]) / 2;
    }

    /**
     * 本地记账（只存元数据，不存题面）
     * deps: { storage:{get,set}, ui:{notify,confirm}, exporter:{save} }
     */
    function createLedger(deps) {
        deps = deps || {};
        var storage = deps.storage || { get: function (k, d) { return d; }, set: function () {} };
        var ui = deps.ui || { notify: function () {}, confirm: function () { return true; } };
        var exporter = deps.exporter || { save: function () {} };

        var records = [];
        try {
            var saved = storage.get(STORAGE_KEY, []);
            if (isArray(saved)) records = saved;
        } catch (e) { records = []; }

        var current = null;

        function persist() {
            try { storage.set(STORAGE_KEY, records); } catch (e) {}
        }

        return {
            begin: function (id, type) {
                current = {
                    id: id, type: type || "single",
                    startTime: now(), initialSelected: null, changeCount: 0
                };
            },
            setInitial: function (selected) {
                if (current) current.initialSelected = isArray(selected) ? selected.slice(0) : selected;
            },
            markChange: function () {
                if (current) current.changeCount++;
            },
            finish: function (finalAnswer, toolEnabled, standardAnswer) {
                if (!current) return null;
                var rec = {
                    id: current.id,
                    type: current.type,
                    elapsedMs: now() - current.startTime,
                    initialSelected: current.initialSelected,
                    changeCount: current.changeCount,
                    finalAnswer: finalAnswer,
                    toolEnabled: toolEnabled === false ? false : true,
                    standardAnswer: standardAnswer || "",
                    timestamp: now()
                };
                records.push(rec);
                persist();
                current = null;
                return rec;
            },
            list: function () { return records.slice(0); },
            count: function () { return records.length; },
            remove: function (id) {
                var kept = [];
                for (var i = 0; i < records.length; i++) {
                    if (records[i].id !== id) kept.push(records[i]);
                }
                var removed = records.length - kept.length;
                records = kept;
                persist();
                return removed;
            },
            clear: function () { records = []; persist(); },
            exportJSON: function () {
                var content = JSON.stringify(records, null, 2);
                exporter.save("label_ledger.json", content, "application/json");
                return content;
            },
            exportCSV: function () {
                var content = toCSV(records);
                exporter.save("label_ledger.csv", content, "text/csv");
                return content;
            },
            notify: function (msg) { ui.notify(msg); },
            confirm: function (msg) { return ui.confirm(msg); }
        };
    }

    /**
     * 总开关：一键关闭辅助模块但继续记账；支持奇偶题自动交替
     * opts: { enabled:Boolean, mode:"manual"|"alternate", alternateOn:"even"|"odd" }
     */
    function createToolState(opts) {
        opts = opts || {};
        var enabled = opts.enabled !== false;
        var mode = opts.mode === "alternate" ? "alternate" : "manual";
        var alternateOn = opts.alternateOn === "odd" ? "odd" : "even";

        function idToNumber(id) {
            var digits = String(id).replace(/[^0-9]/g, "");
            if (digits === "") return NaN;
            return parseInt(digits, 10);
        }

        return {
            isEnabledFor: function (id) {
                if (mode === "manual") return enabled;
                var n = idToNumber(id);
                if (isNaN(n)) return enabled;
                var isEven = (n % 2 === 0);
                return alternateOn === "even" ? isEven : !isEven;
            },
            isEnabled: function () { return enabled; },
            toggle: function () { enabled = !enabled; return enabled; },
            setEnabled: function (b) { enabled = !!b; },
            setMode: function (m, on) {
                mode = (m === "alternate") ? "alternate" : "manual";
                if (on) alternateOn = (on === "odd") ? "odd" : "even";
            },
            getMode: function () { return mode; }
        };
    }

    function sameSelection(a, b) {
        if (a.length !== b.length) return false;
        var sa = a.slice(0).sort(), sb = b.slice(0).sort();
        for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
        return true;
    }

    /**
     * 选择变化追踪：与工具开关、快捷键无关，只比较前后 selected。
     * 本题第一次出现非空选择调 setInitial（不算改判）；之后每次变化调 markChange。
     * 换题时重新 begin 并清空上一题选择。
     */
    function createSelectionTracker(ledger) {
        var trackId = null, prevSelected = [];
        return {
            track: function (model) {
                if (!model) return;
                if (model.id !== trackId) {
                    trackId = model.id;
                    prevSelected = [];
                    ledger.begin(model.id, model.type);
                    return;
                }
                var sel = (model.selected || []).slice(0);
                if (!sameSelection(sel, prevSelected)) {
                    if (prevSelected.length === 0 && sel.length > 0) {
                        ledger.setInitial(sel);
                    } else if (prevSelected.length > 0) {
                        ledger.markChange();
                    }
                    prevSelected = sel;
                }
            }
        };
    }

    return {
        defaultRules: defaultRules,
        validate: validate,
        createLedger: createLedger,
        createToolState: createToolState,
        createSelectionTracker: createSelectionTracker,
        sameSelection: sameSelection,
        toCSV: toCSV,
        median: median,
        STORAGE_KEY: STORAGE_KEY
    };
});

/**
 * 标注提效脚本 - 油猴壳 (monkey_shell.js)
 *
 * 红线：
 *   - 不自动提交、不自动选择任何答案、不自动翻题；提交永远由人点击
 *   - 不改动平台自有监听与上报，不干扰质检和计时
 *   - 零网络请求；题面原文不落盘，记账仅元数据，且只用 GM_setValue（页面读不到）
 *   - 快捷键在捕获阶段监听，输入框聚焦时全部失效
 *
 * 本文件被 build.js 拼到 core.js 之后，core 在浏览器里挂为全局 LabelCore。
 * Node 测试时走 module.exports 分支，仅导出纯函数，不触碰 DOM/GM。
 */
(function () {

    // ===== 配置区（拿到真实平台后只改这里，不改逻辑） =====
    var CONFIG = {
        platform: "https://平台域名/*",   // 需按真实平台改（成品头块 @match 同步改）
        selectors: {                       // 需按真实平台改：示例按普通 div 列表
            questionId: ".q-id",           // 题号元素
            questionText: ".q-text",       // 题面元素
            option: ".q-option",           // 每个选项
            optionText: ".q-option-text",  // 选项文本（缺省用 option 自身文本）
            submitBtn: ".q-submit",        // 提交按钮
            nextBtn: ".q-next",            // 下一题按钮
            textInput: ".q-input",         // 填空输入框
            typeAttr: "data-type",         // 题型属性 single/multi/text
            selectedClass: "selected"      // 已选选项的 class
        },
        keys: {
            select: { "1": 0, "2": 1, "3": 2, "4": 3, "5": 4, "6": 5, "7": 6, "8": 7, "9": 8 },
            next: ["Enter", "ArrowRight"],
            toggle: "F2"                   // 总开关，避开平台自带快捷键
        },
        validate: { textPattern: "", forbidKeywords: [] },
        tool: { enabled: true, mode: "manual", alternateOn: "even" }
    };

    // ===== 纯函数（可测，无 DOM/GM 依赖） =====

    function isEditableFocused(el) {
        if (!el) return false;
        var tag = (el.tagName || "").toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA") return true;
        if (el.isContentEditable === true) return true;
        return false;
    }

    function resolveAction(key, keymap) {
        keymap = keymap || CONFIG.keys;
        if (keymap.select && Object.prototype.hasOwnProperty.call(keymap.select, key)) {
            return { type: "select", index: keymap.select[key] };
        }
        var next = keymap.next || [];
        for (var i = 0; i < next.length; i++) {
            if (next[i] === key) return { type: "next" };
        }
        if (keymap.toggle === key) return { type: "toggle" };
        return null;
    }

    function shouldHandleKey(key, activeElement, enabled) {
        if (enabled === false) return false;          // 总开关关闭：快捷键失效，记账继续
        if (isEditableFocused(activeElement)) return false;
        return resolveAction(key, CONFIG.keys) !== null;
    }

    function buildConfirmMessage(problems) {
        var lines = ["提交前检查发现 " + problems.length + " 个问题："];
        for (var i = 0; i < problems.length; i++) {
            lines.push((i + 1) + ". " + problems[i].message);
        }
        lines.push("校验只是护栏不是闸门。确定仍要提交吗？");
        return lines.join("\n");
    }

    // ===== 宿主相关（DOM/GM），仅浏览器执行 =====

    function extractModel(doc) {
        var s = CONFIG.selectors;
        var idEl = doc.querySelector(s.questionId);
        var qEl = doc.querySelector(s.questionText);
        var optEls = doc.querySelectorAll(s.option);
        var options = [], selected = [];
        for (var i = 0; i < optEls.length; i++) {
            var el = optEls[i];
            var tEl = s.optionText ? el.querySelector(s.optionText) : el;
            options.push({ text: tEl ? tEl.textContent.replace(/^\s+|\s+$/g, "") : "" });
            if (el.classList && el.classList.contains(s.selectedClass)) selected.push(i);
        }
        var root = qEl ? qEl.closest("[data-type]") : null;
        var type = root ? root.getAttribute(s.typeAttr) : "single";
        if (type === "text") {
            var inp = doc.querySelector(s.textInput);
            selected = inp && inp.value ? [inp.value] : [];
        }
        return {
            id: idEl ? idEl.textContent.replace(/^\s+|\s+$/g, "") : "unknown",
            question: qEl ? qEl.textContent : "",
            options: options,
            selected: selected,
            type: type || "single",
            elapsed: 0
        };
    }

    function highlightText(root, keywords) {
        if (!root || !keywords || !keywords.length) return;
        var walker = root.ownerDocument.createTreeWalker(root, 4 /* SHOW_TEXT */, null);
        var nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        for (var n = 0; n < nodes.length; n++) {
            var node = nodes[n];
            var text = node.nodeValue;
            if (!text) continue;
            for (var k = 0; k < keywords.length; k++) {
                var kw = keywords[k];
                if (!kw || text.indexOf(kw) < 0) continue;
                var idx = text.indexOf(kw);
                var after = node.splitText(idx);
                after.splitText(kw.length);
                var span = node.ownerDocument.createElement("span");
                span.style.background = "#fff3a3";
                span.textContent = kw;
                after.parentNode.replaceChild(span, after);
                break; // 每个文本节点只包一处，避免重复嵌套
            }
        }
    }

    function ensurePanel(doc, html) {
        var id = "label-helper-panel";
        var panel = doc.getElementById(id);
        if (!panel) {
            panel = doc.createElement("div");
            panel.id = id;
            panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:99999;max-width:280px;" +
                "background:#222;color:#fff;font-size:12px;line-height:1.6;padding:10px 12px;" +
                "border-radius:8px;opacity:.92;white-space:pre-wrap;";
            doc.body.appendChild(panel);
        }
        panel.textContent = html;
        return panel;
    }

    function keymapHint() {
        var lines = ["快捷键：1-9 选对应标签；回车/→ 下一题；" + CONFIG.keys.toggle + " 总开关"];
        lines.push("选项键位映射（防错位）：");
        for (var k in CONFIG.keys.select) {
            if (Object.prototype.hasOwnProperty.call(CONFIG.keys.select, k)) {
                lines.push("  " + k + " → 选项 " + (CONFIG.keys.select[k] + 1));
            }
        }
        return lines.join("\n");
    }

    function main() {
        var rules = LabelCore.defaultRules;
        var storage = {
            get: function (k, d) { return GM_getValue(k, d); },
            set: function (k, v) { GM_setValue(k, v); }
        };
        var exporter = {
            save: function (name, content, mime) {
                var blob = new Blob([content], { type: mime || "text/plain" });
                var a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = name;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(a.href);
            }
        };
        var ui = {
            notify: function (msg) { ensurePanel(document, msg); },
            confirm: function (msg) { return window.confirm(msg); }
        };
        var ledger = LabelCore.createLedger({ storage: storage, ui: ui, exporter: exporter });
        var tool = LabelCore.createToolState(CONFIG.tool);
        var tracker = LabelCore.createSelectionTracker(ledger);
        var lastHintId = null;

        function refresh() {
            var model = extractModel(document);
            tracker.track(model);
            if (model.id !== lastHintId) {
                lastHintId = model.id;
                var enabled = tool.isEnabledFor(model.id);
                if (enabled) {
                    var card = rules.cards[model.type] || rules.cards.single;
                    ensurePanel(document, card.title + "：" + card.summary + "\n\n" + keymapHint());
                    var qEl = document.querySelector(CONFIG.selectors.questionText);
                    highlightText(qEl, rules.highlight.keywords);
                } else {
                    ensurePanel(document, "辅助已关闭（本题仍记账）");
                }
            }
        }

        // 提交前校验 + 记账（钩提交按钮，捕获阶段；不自动提交）
        document.addEventListener("click", function (e) {
            var btn = e.target.closest ? e.target.closest(CONFIG.selectors.submitBtn) : null;
            if (!btn) return;
            var model = extractModel(document);
            if (tool.isEnabledFor(model.id)) {
                var res = LabelCore.validate(model, CONFIG.validate);
                if (!res.ok) {
                    if (!ui.confirm(buildConfirmMessage(res.problems))) {
                        e.preventDefault();
                        e.stopPropagation();
                        return; // 用户取消，不提交也不记账
                    }
                    // 用户选择「仍要提交」：放行，不阻止默认行为
                }
            }
            ledger.finish(model.selected, tool.isEnabledFor(model.id), "");
        }, true);

        // 快捷键：捕获阶段；输入框聚焦全失效
        document.addEventListener("keydown", function (e) {
            var enabled = tool.isEnabledFor(lastHintId || "Q0");
            if (e.key === CONFIG.keys.toggle) {
                tool.toggle();
                ui.notify("辅助总开关: " + (tool.isEnabled() ? "开" : "关") + "（记账持续）");
                return;
            }
            if (!shouldHandleKey(e.key, document.activeElement, enabled)) return;
            var action = resolveAction(e.key, CONFIG.keys);
            if (!action) return;
            if (action.type === "select") {
                var optEls = document.querySelectorAll(CONFIG.selectors.option);
                var el = optEls[action.index];
                if (el) {
                    el.click(); // 只触发平台自有选择逻辑，不替人判断答案；改判由选择追踪统一记录
                }
            } else if (action.type === "next") {
                var nextBtn = document.querySelector(CONFIG.selectors.nextBtn);
                if (nextBtn) nextBtn.click();
            }
            e.preventDefault();
        }, true);

        // 选项点击/填空输入后延迟 refresh，比较前后 selected 记录改判（与工具开关、快捷键无关）
        document.addEventListener("click", function (e) {
            var opt = e.target.closest ? e.target.closest(CONFIG.selectors.option) : null;
            if (opt) setTimeout(refresh, 0);
        }, true);
        document.addEventListener("input", function (e) {
            if (e.target && e.target.matches && e.target.matches(CONFIG.selectors.textInput)) {
                setTimeout(refresh, 0);
            }
        }, true);

        refresh();
        var obs = new MutationObserver(refresh);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    if (typeof module === "object" && typeof module.exports === "object") {
        module.exports = {
            CONFIG: CONFIG,
            isEditableFocused: isEditableFocused,
            resolveAction: resolveAction,
            shouldHandleKey: shouldHandleKey,
            buildConfirmMessage: buildConfirmMessage
        };
    } else if (typeof document !== "undefined") {
        main();
    }
})();

