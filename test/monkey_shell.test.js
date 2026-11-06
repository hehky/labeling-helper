/* monkey_shell.js 测试：仅测纯函数，stub activeElement，无真实 DOM/GM */
var assert = require("assert");
var Shell = require("../src/monkey_shell.js");

var passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log("PASS " + name); }
    catch (e) { failed++; console.error("FAIL " + name + ": " + e.message); }
}
function el(tag, editable) { return { tagName: tag, isContentEditable: !!editable }; }

// activeElement 失效逻辑
test("input 聚焦判定为可编辑", function () {
    assert.strictEqual(Shell.isEditableFocused(el("INPUT")), true);
});
test("textarea 聚焦判定为可编辑", function () {
    assert.strictEqual(Shell.isEditableFocused(el("TEXTAREA")), true);
});
test("contenteditable 聚焦判定为可编辑", function () {
    assert.strictEqual(Shell.isEditableFocused(el("DIV", true)), true);
});
test("普通按钮不算可编辑", function () {
    assert.strictEqual(Shell.isEditableFocused(el("BUTTON")), false);
});
test("空 activeElement 不算可编辑", function () {
    assert.strictEqual(Shell.isEditableFocused(null), false);
});

// shouldHandleKey 综合判断
test("总开关关闭时快捷键失效", function () {
    assert.strictEqual(Shell.shouldHandleKey("1", el("DIV"), false), false);
});
test("输入框聚焦时数字键失效", function () {
    assert.strictEqual(Shell.shouldHandleKey("1", el("INPUT"), true), false);
});
test("非聚焦时数字键生效", function () {
    assert.strictEqual(Shell.shouldHandleKey("1", el("DIV"), true), true);
});
test("未映射键不处理", function () {
    assert.strictEqual(Shell.shouldHandleKey("z", el("DIV"), true), false);
});

// resolveAction 映射
test("数字键映射到选项索引", function () {
    assert.deepStrictEqual(Shell.resolveAction("3", Shell.CONFIG.keys), { type: "select", index: 2 });
});
test("回车/右箭头映射下一题", function () {
    assert.strictEqual(Shell.resolveAction("Enter", Shell.CONFIG.keys).type, "next");
    assert.strictEqual(Shell.resolveAction("ArrowRight", Shell.CONFIG.keys).type, "next");
});
test("总开关键映射 toggle", function () {
    assert.strictEqual(Shell.resolveAction(Shell.CONFIG.keys.toggle, Shell.CONFIG.keys).type, "toggle");
});
test("未知键返回 null", function () {
    assert.strictEqual(Shell.resolveAction("q", Shell.CONFIG.keys), null);
});

// 放行路径
test("确认框列出问题数与「仍要提交」", function () {
    var msg = Shell.buildConfirmMessage([{ code: "NO_SELECTION", message: "单选题漏选" }]);
    assert.ok(msg.indexOf("1 个问题") >= 0);
    assert.ok(msg.indexOf("单选题漏选") >= 0);
    assert.ok(msg.indexOf("仍要提交") >= 0);
});

console.log("\n" + passed + " passed, " + failed + " failed");
process.exitCode = failed ? 1 : 0;
