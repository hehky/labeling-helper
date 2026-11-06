# 标注提效双端脚本 实施计划

**目标**：给人工标注员（文本分类/指代消歧）用的辅助工具，人做判断、脚本管手，提效不代答。

**架构**：`core.js` 纯逻辑零宿主（ES5，仅依赖注入的 storage/ui/exporter），两个壳各自抽取宿主为统一题目模型后调用 core；`build.js` 把 core 拼进两个单文件成品。

**技术栈**：ES5（Rhino 兼容）/ 油猴 GM_* / AutoJs6 无障碍+floaty / Node 构建与测试。

## 全局约束（逐条来自任务书）

- core.js 禁止出现 GM_*、window、document、storages、floaty；只用 `storage.get/set`、`ui.notify`、`ui.confirm`、`exporter.save` 抽象接口
- ES5：不用 class、可选链、async/await、展开运算符
- 统一模型 `{id, question, options[], selected[], type, elapsed}`；question 只在内存，不落盘
- build 拼 core 进成品，两端单文件，无相对 require
- 油猴头块 `// ==/UserScript==` 结尾；@match 占位 `https://平台域名/*`；@grant 仅 GM_getValue/GM_setValue
- 数字键 1-9 选标签、回车/→ 下一题；判 activeElement，input/textarea/contenteditable 聚焦全失效；油猴 keydown 捕获阶段
- 校验是护栏不是闸门：弹确认框列问题，保留「仍要提交」
- 油猴记账只用 GM_setValue；AutoJs6 用文件按平台存；不存题面原文
- 红线：不自动提交/选择/翻题；不干扰平台质检计时；零网络请求；题面不落盘

## 文件结构

```
labeling-helper/
  src/core.js            纯逻辑：规则表/校验器/记账/总开关/导出
  src/monkey_shell.js    油猴壳：DOM 抽取/快捷键/悬浮/提交钩/GM 记账
  src/autojs_shell.js    AutoJs6 壳：无障碍抽取/音量键/floaty/文件记账
  build.js               Node 构建：拼 core + 壳 → dist 两成品 + node --check
  stats.js               读导出 CSV → 提效报告（中位数）
  demo.html              本地模拟标注页
  test/core.test.js      15+ 纯 Node 断言
  test/monkey_shell.test.js  5+ stub 测试
  dist/labeling_helper.user.js
  dist/labeling_helper_autojs6.js
  README.md
```

## 接口契约（core 对外，ES5）

```js
LabelCore.validate(model, cfg) -> { ok:Boolean, problems:[{code:String,message:String}] }
  // code: NO_SELECTION / MULTI_ON_SINGLE / EMPTY_TEXT / BAD_FORMAT / RULE_CONFLICT
LabelCore.createLedger(deps) -> ledger
  // deps: { storage:{get(key,def),set(key,val)}, ui:{notify(msg),confirm(msg)->Boolean}, exporter:{save(name,content,mime)} }
  ledger.begin(id, type)            // 开始计时
  ledger.setInitial(selectedArray)  // 记初始选择
  ledger.markChange()               // 改判 +1
  ledger.finish(finalAnswer, toolEnabled, standardAnswer) // 写一条记录
  ledger.list() -> [record]
  ledger.remove(id) / ledger.clear()
  ledger.exportJSON() / ledger.exportCSV()  // 调 exporter.save，不含 question
  // record: {id,type,elapsedMs,initialSelected,changeCount,finalAnswer,toolEnabled,standardAnswer,timestamp}
LabelCore.createToolState(opts) -> tool
  // opts: { enabled:Boolean, mode:"manual"|"alternate", alternateOn:"even"|"odd" }
  tool.isEnabledFor(id) -> Boolean   // manual 看 enabled；alternate 按题号奇偶
  tool.toggle() / tool.setEnabled(b) / tool.setMode(mode, alternateOn)
LabelCore.toCSV(records) -> String   // 含表头；列无 question
LabelCore.median(numbers) -> Number
LabelCore.defaultRules -> 规则表（高亮关键词 + 题型规则卡，配置位）
```

## 任务分解

- Task 1 core.js + test/core.test.js（15+ 断言：校验全分支、记账增删改查、导出格式、总开关关闭仍记账、导出无 question）
- Task 2 monkey_shell.js + test/monkey_shell.test.js（5+：activeElement 失效、放行路径、记账触发）
- Task 3 autojs_shell.js（框架级）
- Task 4 build.js + demo.html + stats.js
- Task 5 构建 + 验收自检（node build.js、node --check、grep 红线、stats 手造 CSV）
- Task 6 README.md

## 验收自检（交付前必跑）

1. `node build.js` 成功，dist 两成品生成
2. `node --check dist/labeling_helper.user.js` 与 `dist/labeling_helper_autojs6.js` 通过
3. `node test/core.test.js` 全绿（≥15 断言）
4. `node test/monkey_shell.test.js` 全绿（≥5 断言）
5. grep 无 fetch / XMLHttpRequest / GM_xmlhttpRequest / localStorage（注释声明除外需说明）
6. `node stats.js <手造CSV>` 中位数与倍数正确
7. demo.html 手测步骤写进 README（无法在此环境手测，列入「未验证项」）

## 待确认

- 真实平台域名、选择器、题型规则卡内容：留配置位，拿到页面后只改配置
- AutoJs6 真机音量键/悬浮窗/无障碍行为：框架级，真机后调
