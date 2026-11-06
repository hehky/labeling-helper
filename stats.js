/**
 * stats.js：读取导出的 CSV，输出提效报告。
 * 用法：node stats.js <导出的.csv>
 * 分组：按 toolEnabled 开/关；耗时用中位数（不用平均数）。
 * 提效倍数 = 裸跑耗时中位数 ÷ 开工具耗时中位数。
 * 准确率仅在 CSV 含非空 standardAnswer 列时计算。
 */
const fs = require("fs");

function parseLine(line) {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQ) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQ = false;
            } else cur += c;
        } else {
            if (c === '"') inQ = true;
            else if (c === ',') { out.push(cur); cur = ""; }
            else cur += c;
        }
    }
    out.push(cur);
    return out;
}

function median(nums) {
    if (!nums.length) return 0;
    const a = nums.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function main() {
    const file = process.argv[2];
    if (!file) { console.error("用法: node stats.js <导出的.csv>"); process.exit(1); }
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) { console.error("CSV 无数据行"); process.exit(1); }

    const header = parseLine(lines[0]);
    const col = {};
    header.forEach((h, i) => { col[h] = i; });
    const required = ["elapsedMs", "changeCount", "toolEnabled", "finalAnswer"];
    for (const r of required) {
        if (col[r] === undefined) { console.error("CSV 缺少必需列: " + r); process.exit(1); }
    }
    const hasStandard = col.standardAnswer !== undefined;

    const rows = lines.slice(1).map((l) => {
        const f = parseLine(l);
        return {
            elapsedMs: Number(f[col.elapsedMs]) || 0,
            changeCount: Number(f[col.changeCount]) || 0,
            toolEnabled: String(f[col.toolEnabled]) === "true",
            finalAnswer: f[col.finalAnswer] || "",
            standardAnswer: hasStandard ? (f[col.standardAnswer] || "") : ""
        };
    });

    function group(flag) { return rows.filter((r) => r.toolEnabled === flag); }
    function report(name, g) {
        if (!g.length) { console.log(name + ": 无记录"); return null; }
        const times = g.map((r) => r.elapsedMs);
        const changed = g.filter((r) => r.changeCount > 0).length;
        const changeRate = (changed / g.length * 100).toFixed(1);
        console.log(name + ": " + g.length + " 题");
        console.log("  耗时中位数: " + median(times) + " ms");
        console.log("  改判率: " + changeRate + "% (" + changed + "/" + g.length + ")");
        if (hasStandard) {
            const withAns = g.filter((r) => r.standardAnswer !== "");
            if (withAns.length) {
                const correct = withAns.filter((r) => r.finalAnswer === r.standardAnswer).length;
                console.log("  准确率: " + (correct / withAns.length * 100).toFixed(1) + "% (" + correct + "/" + withAns.length + ")");
            }
        }
        return median(times);
    }

    console.log("记录总数: " + rows.length + "\n");
    const onMed = report("开工具", group(true));
    const offMed = report("裸跑(关工具)", group(false));
    console.log("");
    if (onMed && offMed && onMed > 0) {
        console.log("提效倍数 = 裸跑中位数 ÷ 开工具中位数 = " + offMed + " / " + onMed + " = " + (offMed / onMed).toFixed(2) + "x");
    } else {
        console.log("提效倍数: 需要同时有开工具与裸跑记录");
    }
    if (!hasStandard) console.log("准确率: CSV 无 standardAnswer 列，未计算");
}

main();
