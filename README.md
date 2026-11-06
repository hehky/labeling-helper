# 标注提效双端脚本

给人工数据标注员（文本分类/指代消歧类任务）用的辅助工具。**人做判断，脚本管手，提效不代答。**
目标平台暂无页面，所有选择器和域名均为配置位，拿到真实页面后**只改配置不改代码**。

## 文件树

```
labeling-helper/
├── src/
│   ├── core.js            共用核心：规则表/校验器/记账/总开关/导出（纯逻辑，零宿主，ES5）
│   ├── monkey_shell.js    油猴壳：DOM 抽取/快捷键/悬浮提示/提交钩/GM 记账
│   └── autojs_shell.js    AutoJs6 壳：无障碍抽取/音量键/floaty 悬浮窗/文件记账（框架级）
├── build.js               Node 构建：拼 core + 壳 → dist 两成品 + 语法自检
├── stats.js               读导出 CSV → 提效报告（中位数）
├── demo.html              本地模拟标注页（题号/题面/四单选/填空框/提交/下一题）
├── test/
│   ├── core.test.js       24 条纯 Node 断言
│   └── monkey_shell.test.js  14 条 stub 断言
├── dist/
│   ├── labeling_helper.user.js       油猴成品（含头块）
│   └── labeling_helper_autojs6.js    AutoJs6 成品
└── README.md
```

## 安装

**油猴**：把 `dist/labeling_helper.user.js` 导入 Tampermonkey；改头块 `@match` 为真实平台域名，改 `CONFIG.selectors`。
**AutoJs6**：把 `dist/labeling_helper_autojs6.js` 复制到 `/sdcard/脚本/`，在 AutoJs6 中运行；改顶部配置区（无障碍选择器、音量键模式）。
**重新构建**：改 `src/` 后运行 `node build.js` 重新生成两个成品。

## 配置位示例（假设平台是普通 div 列表，需按真实平台改）

```js
// 油猴 CONFIG.selectors（CSS 选择器）
selectors: {
    questionId: ".q-id",            // 题号元素
    questionText: ".q-text",        // 题面元素
    option: ".q-option",            // 每个选项
    optionText: ".q-option-text",   // 选项文本
    submitBtn: ".q-submit",         // 提交按钮
    nextBtn: ".q-next",             // 下一题按钮
    textInput: ".q-input",          // 填空输入框
    typeAttr: "data-type",          // 题型属性 single/multi/text
    selectedClass: "selected"       // 已选选项 class
}

// AutoJs6 CONFIG.selectors（无障碍匹配串）与音量键
selectors: { questionId: "题号", questionText: "题面", option: "选项", submitBtn: "提交", nextBtn: "下一题", type: "single" }
volume: { enabled: true, upAction: { type: "select", index: 0 }, downAction: { type: "next" } }
```

> 以上为示例，**需按真实平台改**。`demo.html` 用的正是这套 class 名，可先在本地页验证。

## 改判记账规则（与工具开关、快捷键无关）

- 选择变化只比较前后 `selected`：本题**首次非空选择**记 `initialSelected`（不算改判），**之后每次变化**记一次改判
- 手点选项、快捷键选择、音量键选择走**同一条**追踪逻辑，不重复计数
- 工具关闭（裸跑）时手点选项**仍记** initialSelected 和改判
- 油猴壳：选项 click / 填空 input 后延迟 refresh 比较；AutoJs6 壳：refresh 轮询比较

## 试标对比流程（奇偶交替 → 导出 → stats）

1. 配置区设 `tool: { mode: "alternate", alternateOn: "even" }`：偶数题开辅助、奇数题关（裸跑），同题量对照。
2. 正常标注若干题；总开关（默认 `F2`）可一键关辅助但**继续记账**，用于裸跑对照。
3. 一键导出 `label_ledger.csv`（油猴走下载；AutoJs6 写到 `/sdcard/脚本/`）。
4. 运行 `node stats.js label_ledger.csv`，得开/关工具耗时中位数、改判率、提效倍数；CSV 含 `standardAnswer` 列时才输出准确率。

## 红线声明（硬约束）

- 不自动提交、不自动选择任何答案、不自动翻题，**每次提交都由人触发**
- 不绕过/不干扰平台质检和计时（不改平台自有监听与上报）
- 无任何网络请求（不用 fetch、XHR、GM_xmlhttpRequest、http 模块）
- 题目内容不落盘、不外传，记账仅元数据（无 question 字段）
- 校验是护栏不是闸门：弹确认框列问题，始终保留「仍要提交」放行路径

## 验收自检结果

| 项 | 结果 |
|---|---|
| `node build.js` 构建 | 成功，dist 两成品生成 |
| 两成品 `node --check` | 通过 |
| `node test/core.test.js` | 30 passed, 0 failed |
| `node test/monkey_shell.test.js` | 14 passed, 0 failed |
| 红线 grep（fetch/XHR/GM_xmlhttpRequest/localStorage） | 仅注释声明，无实际调用 |
| `node stats.js` 手造 CSV | 中位数 1500/7000，倍数 4.67x，改判率/准确率正确 |

## 已知限制（未真机/未实测项及验证方法）

1. **AutoJs6 端未真机验证**：音量键、floaty 悬浮窗、无障碍抽取均为框架级。
   验证方法：导入 AutoJs6 后开无障碍，观察悬浮窗是否显示、音量上下是否触发、抽取的题号/题面是否正确。
2. **油猴端无真实平台页面**：选择器与 `@match` 为占位。
   验证方法：改为真实域名与选择器后，在目标页打开控制台观察是否抽取成功、快捷键是否生效。
3. **demo.html 手测未在本环境执行**：请在浏览器打开 demo.html（可先不装脚本）后装油猴脚本，验证：
   - 数字键 1-4 能选中对应选项
   - 聚焦填空框后打数字**不触发**选项选择
   - 漏选时点提交弹确认框，选「仍要提交」可放行
4. **AutoJs6 无法钩原生提交 click**：改为悬浮「检查」按钮手动触发校验，不拦截 App 提交。

## 待确认

- 真实平台域名、DOM/无障碍选择器、各题型规则卡内容（拿到页面后填配置位）
- AutoJs6 音量键已按官方文档改为 `events.observeKey()` + `events.onKeyDown("volume_up"/"volume_down", fn)`，并用 `events.setKeyInterceptionEnabled("volume_up"/"volume_down", true)` 拦截避免同时调音量；目标版本 **AutoJs6 6.8.0**。`setKeyInterceptionEnabled` 在部分版本签名为 `(enabled)` 而非 `(key, enabled)`，真机后调。
- 填空题格式正则 `validate.textPattern`、规则卡冲突词 `validate.forbidKeywords` 需按题型配置
