/**
 * 标注提效辅助 AutoJs6 单文件成品
 * 红线：不自动提交/选择/翻题；零网络请求；题面不落盘，记账仅元数据
 * 配置区集中在壳顶部（无障碍选择器、音量键模式），需按真实平台改
 */

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
 * 标注提效脚本 - AutoJs6 壳 (autojs_shell.js)
 *
 * 红线：
 *   - 不自动提交、不自动选择任何答案、不自动翻题；提交永远由人在 App 里点
 *   - 不干扰平台质检与计时；零网络请求；题面原文不落盘，记账仅元数据
 *   - 记账用文件按平台分存（/sdcard/脚本/label_ledger_<平台>.json）
 *
 * 本文件被 build.js 拼到 core.js 之后，core 在 AutoJs6 里挂为全局 LabelCore。
 * 框架级实现：真实平台的无障碍选择器、音量键行为需真机后调（见「待确认」）。
 */
(function () {

    // ===== 配置区（集中顶部；拿到真实平台后只改这里） =====
    var CONFIG = {
        platform: "default",                 // 平台标识，用于记账文件名（需按真实平台改）
        selectors: {                          // 无障碍选择器（需按真实平台改）
            questionId: "题号",               // 题号控件的 text/desc/id 匹配串
            questionText: "题面",
            option: "选项",
            submitBtn: "提交",
            nextBtn: "下一题",
            textInput: "输入",
            type: "single"                    // 题型 single/multi/text（示例按普通 div 列表）
        },
        volume: {                             // 音量键模式（可配）
            enabled: true,
            upAction: { type: "select", index: 0 },  // 音量上 = 选第 1 项
            downAction: { type: "next" }             // 音量下 = 下一题
        },
        validate: { textPattern: "", forbidKeywords: [] },
        tool: { enabled: true, mode: "manual", alternateOn: "even" },
        dir: "/sdcard/脚本"                   // 记账/导出目录
    };

    function ledgerPath() { return files.join(CONFIG.dir, "label_ledger_" + CONFIG.platform + ".json"); }

    // ===== 无障碍树抽取成统一模型 =====
    function extractModel() {
        var s = CONFIG.selectors;
        var idEl = textMatches(".*" + s.questionId + ".*").findOnce();
        var qEl = textMatches(".*" + s.questionText + ".*").findOnce();
        var options = [];
        var optEls = textMatches(".*" + s.option + ".*").find();
        for (var i = 0; i < optEls.length; i++) {
            try { options.push({ text: optEls[i].text() || optEls[i].desc() || "" }); } catch (e) {}
        }
        return {
            id: idEl ? (idEl.text() || idEl.desc() || "unknown") : "unknown",
            question: qEl ? (qEl.text() || "") : "",
            options: options,
            selected: [],
            type: s.type,
            elapsed: 0
        };
    }

    function main() {
        auto.waitFor();
        var storage = {
            get: function (k, def) {
                try {
                    if (files.exists(ledgerPath())) {
                        var obj = JSON.parse(files.read(ledgerPath()));
                        return obj[k] !== undefined ? obj[k] : def;
                    }
                } catch (e) {}
                return def;
            },
            set: function (k, v) {
                var obj = {};
                try { if (files.exists(ledgerPath())) obj = JSON.parse(files.read(ledgerPath())); } catch (e) {}
                obj[k] = v;
                files.write(ledgerPath(), JSON.stringify(obj));
            }
        };
        var exporter = {
            save: function (name, content) {
                files.write(files.join(CONFIG.dir, name), content);
                toast("已导出 " + name);
            }
        };
        var ui = {
            notify: function (msg) { toast(msg); },
            confirm: function (msg) { return dialogs.confirm("提交前检查", msg); }
        };
        var ledger = LabelCore.createLedger({ storage: storage, ui: ui, exporter: exporter });
        var tool = LabelCore.createToolState(CONFIG.tool);

        // 悬浮窗：规则卡 + 键位映射 + 检查/开关/导出按钮
        var win = floaty.rawWindow(
            '<frame w="wrap_content" h="wrap_content" bg="#CC222222">' +
            '  <vertical padding="10">' +
            '    <text id="info" textColor="#FFFFFF" textSize="12sp"/>' +
            '    <horizontal marginTop="6">' +
            '      <button id="check" text="检查" textSize="12sp"/>' +
            '      <button id="toggle" text="开关" textSize="12sp"/>' +
            '      <button id="exp" text="导出" textSize="12sp"/>' +
            '    </horizontal>' +
            '  </vertical>' +
            '</frame>'
        );
        win.setPosition(20, Math.round(device.height * 0.4));

        var tracker = LabelCore.createSelectionTracker(ledger);
        var lastHintId = null;

        function refresh() {
            threads.start(function () {
                var model = extractModel();
                tracker.track(model);
                if (model.id !== lastHintId) {
                    lastHintId = model.id;
                    var enabled = tool.isEnabledFor(model.id);
                    var card = LabelCore.defaultRules.cards[model.type] || LabelCore.defaultRules.cards.single;
                    var hint = enabled
                        ? card.title + "：" + card.summary + "\n音量上=选第1项 音量下=下一题（可配）"
                        : "辅助已关闭（本题仍记账）";
                    ui.run(function () { win.info.setText(hint); });
                }
            });
        }

        // 提交前检查（护栏不是闸门：只提示，人自己决定点不点提交）
        win.check.click(function () {
            threads.start(function () {
                var model = extractModel();
                var res = LabelCore.validate(model, CONFIG.validate);
                if (res.ok) {
                    ui.notify("本地检查通过，可手动提交");
                } else {
                    var lines = [];
                    for (var i = 0; i < res.problems.length; i++) lines.push(res.problems[i].message);
                    var go = ui.confirm(lines.join("\n") + "\n仍要提交请自行点击提交（本脚本不代点）");
                    if (!go) ui.notify("已提示问题，未提交");
                }
                ledger.finish(model.selected, tool.isEnabledFor(model.id), "");
            });
        });

        win.toggle.click(function () {
            tool.toggle();
            ui.notify("辅助总开关: " + (tool.isEnabled() ? "开" : "关") + "（记账持续）");
        });

        win.exp.click(function () {
            threads.start(function () { ledger.exportCSV(); ledger.exportJSON(); });
        });

        // 音量键：官方写法 observeKey + onKeyDown，并拦截按键避免同时调音量
        // 回调内重活一律 threads.start，UI 线程禁止 sleep/阻塞；改判由选择追踪统一记录
        if (CONFIG.volume.enabled) {
            events.observeKey();
            events.setKeyInterceptionEnabled("volume_up", true);
            events.setKeyInterceptionEnabled("volume_down", true);
            events.onKeyDown("volume_up", function () {
                threads.start(function () {
                    var a = CONFIG.volume.upAction;
                    if (a.type === "select") {
                        var optEls = textMatches(".*" + CONFIG.selectors.option + ".*").find();
                        if (a.index < optEls.length) {
                            try { optEls[a.index].click(); } catch (e) {}  // 人按键触发，不违反红线
                        }
                    }
                });
            });
            events.onKeyDown("volume_down", function () {
                threads.start(function () {
                    if (CONFIG.volume.downAction.type === "next") {
                        var btn = textMatches(CONFIG.selectors.nextBtn).findOnce();
                        if (btn) btn.click();
                    }
                });
            });
        }

        refresh();
        setInterval(refresh, 3000);
    }

    main();
})();

