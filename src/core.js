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
