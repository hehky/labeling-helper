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
