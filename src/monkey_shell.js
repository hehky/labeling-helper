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
