/* core.js 单元测试：纯 Node 断言，storage/ui/exporter 全部 stub 注入，无宿主依赖 */
var assert = require("assert");
var Core = require("../src/core.js");

var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log("PASS " + name); }
    catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); }
}
function makeDeps() {
    var store = {}, saved = [];
    return {
        store: store, saved: saved,
        storage: {
            get: function (k, d) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d; },
            set: function (k, v) { store[k] = v; }
        },
        ui: { notify: function () {}, confirm: function () { return true; } },
        exporter: { save: function (name, content) { saved.push({ name: name, content: content }); } }
    };
}
function singleModel(sel) {
    return { id: "Q1", question: "题面", options: ["甲", "乙", "丙"], selected: sel, type: "single", elapsed: 0 };
}

// ===== 校验器全分支 =====
test("single 漏选 -> NO_SELECTION", function () {
    var r = Core.validate(singleModel([]));
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.problems[0].code, "NO_SELECTION");
});
test("single 多选 -> MULTI_ON_SINGLE", function () {
    var r = Core.validate(singleModel([0, 1]));
    assert.strictEqual(r.problems[0].code, "MULTI_ON_SINGLE");
});
test("single 单选正常 -> ok", function () {
    assert.strictEqual(Core.validate(singleModel([1])).ok, true);
});
test("multi 漏选 -> NO_SELECTION", function () {
    var r = Core.validate({ id: "Q2", options: ["a", "b"], selected: [], type: "multi" });
    assert.strictEqual(r.problems[0].code, "NO_SELECTION");
});
test("multi 多项 -> ok", function () {
    assert.strictEqual(Core.validate({ id: "Q2", options: ["a", "b"], selected: [0, 1], type: "multi" }).ok, true);
});
test("text 空 -> EMPTY_TEXT", function () {
    var r = Core.validate({ id: "Q3", selected: ["  "], type: "text" });
    assert.strictEqual(r.problems[0].code, "EMPTY_TEXT");
});
test("text 格式不符 -> BAD_FORMAT", function () {
    var r = Core.validate({ id: "Q3", selected: ["abc"], type: "text" }, { textPattern: "^\\d+$" });
    assert.strictEqual(r.problems[0].code, "BAD_FORMAT");
});
test("text 格式符合 -> ok", function () {
    assert.strictEqual(Core.validate({ id: "Q3", selected: ["123"], type: "text" }, { textPattern: "^\\d+$" }).ok, true);
});
test("规则卡冲突 -> RULE_CONFLICT", function () {
    var r = Core.validate(singleModel([2]), { forbidKeywords: ["丙"] });
    assert.strictEqual(r.problems[0].code, "RULE_CONFLICT");
});
test("坏模型 -> BAD_MODEL", function () {
    assert.strictEqual(Core.validate(null).problems[0].code, "BAD_MODEL");
});

// ===== 记账增删改查 =====
test("ledger finish 写入完整元数据且不含 question", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single");
    lg.setInitial([0]);
    lg.markChange();
    var rec = lg.finish([1], true, "");
    assert.strictEqual(rec.id, "Q1");
    assert.strictEqual(rec.changeCount, 1);
    assert.deepStrictEqual(rec.initialSelected, [0]);
    assert.deepStrictEqual(rec.finalAnswer, [1]);
    assert.strictEqual(typeof rec.elapsedMs, "number");
    assert.strictEqual(rec.hasOwnProperty("question"), false);
    assert.strictEqual(lg.count(), 1);
});
test("ledger 持久化调用 storage.set", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single"); lg.finish([0], true);
    assert.ok(Array.isArray(d.store[Core.STORAGE_KEY]));
    assert.strictEqual(d.store[Core.STORAGE_KEY].length, 1);
});
test("ledger 从 storage 恢复历史", function () {
    var d = makeDeps();
    d.store[Core.STORAGE_KEY] = [{ id: "Q9", type: "single" }];
    var lg = Core.createLedger(d);
    assert.strictEqual(lg.count(), 1);
    assert.strictEqual(lg.list()[0].id, "Q9");
});
test("ledger remove 按 id 删除", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single"); lg.finish([0], true);
    lg.begin("Q2", "single"); lg.finish([1], true);
    assert.strictEqual(lg.remove("Q1"), 1);
    assert.strictEqual(lg.count(), 1);
    assert.strictEqual(lg.list()[0].id, "Q2");
});
test("ledger clear 清空", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single"); lg.finish([0], true);
    lg.clear();
    assert.strictEqual(lg.count(), 0);
});
test("ledger finish 未 begin 返回 null", function () {
    var lg = Core.createLedger(makeDeps());
    assert.strictEqual(lg.finish([0], true), null);
});

// ===== 导出格式 =====
test("exportCSV 表头不含 question 且含关键列", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single"); lg.setInitial([0]); lg.finish([1], true);
    var csv = lg.exportCSV();
    var head = csv.split("\n")[0];
    assert.strictEqual(head.indexOf("question"), -1);
    assert.ok(head.indexOf("elapsedMs") >= 0);
    assert.ok(head.indexOf("toolEnabled") >= 0);
    assert.strictEqual(d.saved[0].name, "label_ledger.csv");
});
test("exportJSON 可解析且无 question 字段", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    lg.begin("Q1", "single"); lg.finish([0], true);
    var arr = JSON.parse(lg.exportJSON());
    assert.strictEqual(arr.length, 1);
    assert.strictEqual(arr[0].hasOwnProperty("question"), false);
});
test("toCSV 转义逗号与引号", function () {
    var csv = Core.toCSV([{ id: "Q,1", type: "single", finalAnswer: "他说\"好\"", toolEnabled: true }]);
    assert.ok(csv.indexOf("\"Q,1\"") >= 0);
    assert.ok(csv.indexOf("他说\"\"好\"\"") >= 0);
});

// ===== 总开关 =====
test("toolState manual 开关与 toggle", function () {
    var t = Core.createToolState({ enabled: true, mode: "manual" });
    assert.strictEqual(t.isEnabledFor("Q1"), true);
    t.toggle();
    assert.strictEqual(t.isEnabledFor("Q1"), false);
});
test("toolState alternate 偶数题开", function () {
    var t = Core.createToolState({ mode: "alternate", alternateOn: "even" });
    assert.strictEqual(t.isEnabledFor("Q2"), true);
    assert.strictEqual(t.isEnabledFor("Q1"), false);
});
test("toolState alternate 奇数题开", function () {
    var t = Core.createToolState({ mode: "alternate", alternateOn: "odd" });
    assert.strictEqual(t.isEnabledFor("Q1"), true);
    assert.strictEqual(t.isEnabledFor("Q2"), false);
});
test("总开关关闭时仍记账 toolEnabled=false", function () {
    var d = makeDeps(), lg = Core.createLedger(d);
    var t = Core.createToolState({ enabled: false });
    lg.begin("Q1", "single");
    var rec = lg.finish([0], t.isEnabledFor("Q1"));
    assert.strictEqual(rec.toolEnabled, false);
    assert.strictEqual(lg.count(), 1);
});

// ===== 选择追踪（与工具开关、快捷键无关） =====
function stubLedger() {
    var calls = [];
    return {
        calls: calls,
        begin: function (id) { calls.push(["begin", id]); },
        setInitial: function (sel) { calls.push(["setInitial", sel]); },
        markChange: function () { calls.push(["markChange"]); }
    };
}
function countCall(calls, name) {
    return calls.filter(function (c) { return c[0] === name; }).length;
}
test("tracker 首次非空选择调 setInitial 不算改判", function () {
    var lg = stubLedger(), tr = Core.createSelectionTracker(lg);
    tr.track({ id: "Q1", type: "single", selected: [] });
    tr.track({ id: "Q1", type: "single", selected: [2] });
    assert.deepStrictEqual(lg.calls, [["begin", "Q1"], ["setInitial", [2]]]);
});
test("tracker 之后每次变化调 markChange", function () {
    var lg = stubLedger(), tr = Core.createSelectionTracker(lg);
    tr.track({ id: "Q1", type: "single", selected: [] });
    tr.track({ id: "Q1", type: "single", selected: [0] });
    tr.track({ id: "Q1", type: "single", selected: [1] });
    assert.strictEqual(countCall(lg.calls, "setInitial"), 1);
    assert.strictEqual(countCall(lg.calls, "markChange"), 1);
});
test("tracker 工具关闭时手点选项仍记 initialSelected 和改判", function () {
    var lg = stubLedger(), tr = Core.createSelectionTracker(lg);
    tr.track({ id: "Q1", type: "single", selected: [] });
    tr.track({ id: "Q1", type: "single", selected: [0] });
    tr.track({ id: "Q1", type: "single", selected: [1] });
    assert.deepStrictEqual(lg.calls[1], ["setInitial", [0]]);
    assert.strictEqual(countCall(lg.calls, "markChange"), 1);
});
test("tracker 快捷键选择只计一次（重复选择不重复记）", function () {
    var lg = stubLedger(), tr = Core.createSelectionTracker(lg);
    tr.track({ id: "Q1", type: "single", selected: [] });
    tr.track({ id: "Q1", type: "single", selected: [0] });
    tr.track({ id: "Q1", type: "single", selected: [0] });
    assert.strictEqual(countCall(lg.calls, "setInitial"), 1);
    assert.strictEqual(countCall(lg.calls, "markChange"), 0);
});
test("tracker 新题重置 begin 且首次选择重新算 initial", function () {
    var lg = stubLedger(), tr = Core.createSelectionTracker(lg);
    tr.track({ id: "Q1", type: "single", selected: [0] });
    tr.track({ id: "Q2", type: "single", selected: [] });
    assert.deepStrictEqual(lg.calls[lg.calls.length - 1], ["begin", "Q2"]);
    tr.track({ id: "Q2", type: "single", selected: [1] });
    assert.deepStrictEqual(lg.calls[lg.calls.length - 1], ["setInitial", [1]]);
});
test("sameSelection 顺序无关比较", function () {
    assert.strictEqual(Core.sameSelection([0, 1], [1, 0]), true);
    assert.strictEqual(Core.sameSelection([0], [1]), false);
    assert.strictEqual(Core.sameSelection([0], [0, 1]), false);
});

// ===== median =====
test("median 奇数/偶数/空", function () {
    assert.strictEqual(Core.median([1, 3, 2]), 2);
    assert.strictEqual(Core.median([1, 2, 3, 4]), 2.5);
    assert.strictEqual(Core.median([]), 0);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
