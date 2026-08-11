"use strict";
// 排盘单一入口 — 输入生辰, 输出完整 JSON (Yiqi createChart + enrichBazi)
//
// 用法:
//   npx tsx run-chart.ts --year=2000 --month=1 --day=1 --hour=12 --minute=0 --gender=male
//   可选: --output=path/to/file.json
//   当前 MVP 仅接受本地公历日期和本地钟表时间；不支持农历和时区换算。
//
// 不指定 --output 则打印到 stdout
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const local_chart_1 = require("./local-chart");
const fs = __importStar(require("fs"));
function parseArgs() {
    const args = {};
    for (const a of process.argv.slice(2)) {
        const m = a.match(/^--([^=]+)=(.*)$/);
        if (m)
            args[m[1]] = m[2];
    }
    return args;
}
function main() {
    const args = parseArgs();
    const required = ['year', 'month', 'day', 'hour', 'minute', 'gender'];
    for (const k of required) {
        if (args[k] === undefined || args[k] === '') {
            console.error(`Missing required arg: --${k}=...`);
            console.error('Usage: npx tsx run-chart.ts --year=2000 --month=1 --day=1 --hour=12 --minute=0 --gender=male');
            process.exit(1);
        }
    }
    if (args.isLunar !== undefined) {
        throw new Error('Параметр --isLunar не поддерживается: текущий MVP принимает только григорианскую дату');
    }
    if (args.timeZone !== undefined) {
        throw new Error('Параметр --timeZone не поддерживается: вводите локальное время рождения без пересчёта');
    }
    let gender;
    if (args.gender === 'male' || args.gender === '男')
        gender = 'male';
    else if (args.gender === 'female' || args.gender === '女')
        gender = 'female';
    else
        throw new Error('Некорректный пол: используйте male/female или 男/女');
    // Step 1: Yiqi 算法层 — 四柱+紫微+大运+流年
    const chart = (0, local_chart_1.calculateLocalChart)({
        date: `${args.year.padStart(4, '0')}-${args.month.padStart(2, '0')}-${args.day.padStart(2, '0')}`,
        time: `${args.hour.padStart(2, '0')}:${args.minute.padStart(2, '0')}`,
        gender
    });
    const json = JSON.stringify(chart, null, 2);
    if (args.output) {
        fs.writeFileSync(args.output, json, 'utf-8');
        console.error(`Chart written to ${args.output}`);
    }
    else {
        process.stdout.write(json);
    }
}
try {
    main();
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
