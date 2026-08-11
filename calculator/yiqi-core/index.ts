// 统一排盘接口

import { BirthInfo, CalculationOptions, ChartResult, CompleteBaziChart } from './types';
import { createBaziChart, getZhiCangGanFull, runBaziTests } from './bazi';
import { createZiweiChart, runZiweiTests } from './ziwei-standard';
import { enrichBazi } from '../bazi-enrich/enrich';

/**
 * 创建完整的排盘（八字 + 紫微斗数）
 * @param birthInfo 生辰信息
 * @returns 完整排盘结果
 */
export function createChart(birthInfo: BirthInfo, options?: CalculationOptions): ChartResult {
  const validation = validateBirthInfo(birthInfo);
  if (!validation.valid) {
    throw new Error(`Некорректные данные рождения: ${validation.errors.join('; ')}`);
  }

  try {
    const bazi = createBaziChart(birthInfo, options) as CompleteBaziChart;
    const ziwei = createZiweiChart(birthInfo);

    const dm = bazi.dayMaster;
    const z = bazi.siZhu;
    bazi.cangGan = {
      year: getZhiCangGanFull(z.year.zhi, dm),
      month: getZhiCangGanFull(z.month.zhi, dm),
      day: getZhiCangGanFull(z.day.zhi, dm),
      hour: getZhiCangGanFull(z.hour.zhi, dm)
    };

    for (const period of bazi.dayun || []) {
      if (period.startAge !== undefined && period.endAge === undefined) {
        period.endAge = period.startAge + 9;
      }
    }

    bazi.enrichment = enrichBazi({
      年: z.year,
      月: z.month,
      日: z.day,
      时: z.hour
    });
    
    return {
      bazi,
      ziwei
    };
  } catch (error) {
    throw new Error(`排盘计算失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 验证生辰信息的有效性
 * @param birthInfo 生辰信息
 * @returns 验证结果
 */
export function validateBirthInfo(birthInfo: BirthInfo): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  const integerFields: Array<[keyof BirthInfo, string]> = [
    ['year', 'год'],
    ['month', 'месяц'],
    ['day', 'день'],
    ['hour', 'час'],
    ['minute', 'минута']
  ];
  for (const [field, label] of integerFields) {
    if (!Number.isInteger(birthInfo[field])) {
      errors.push(`${label} должен быть целым числом`);
    }
  }
  
  // 验证年份
  if (Number.isInteger(birthInfo.year) && (birthInfo.year < 1900 || birthInfo.year > 2100)) {
    errors.push('год должен быть в диапазоне 1900-2100');
  }
  
  // 验证月份
  if (Number.isInteger(birthInfo.month) && (birthInfo.month < 1 || birthInfo.month > 12)) {
    errors.push('месяц должен быть в диапазоне 1-12');
  }
  
  // 验证日期
  if (Number.isInteger(birthInfo.day) && (birthInfo.day < 1 || birthInfo.day > 31)) {
    errors.push('день должен быть в диапазоне 1-31');
  }
  
  // 验证时辰
  if (Number.isInteger(birthInfo.hour) && (birthInfo.hour < 0 || birthInfo.hour > 23)) {
    errors.push('час должен быть в диапазоне 0-23');
  }
  
  // 验证分钟
  if (Number.isInteger(birthInfo.minute) && (birthInfo.minute < 0 || birthInfo.minute > 59)) {
    errors.push('минуты должны быть в диапазоне 0-59');
  }
  
  // 验证性别
  if (birthInfo.gender !== 'male' && birthInfo.gender !== 'female') {
    errors.push('пол должен быть male или female');
  }

  if (birthInfo.isLunar !== false) {
    errors.push('текущая версия принимает только локальную григорианскую дату; ввод лунной даты не поддерживается');
  }

  if (birthInfo.timeZone !== 8) {
    errors.push('пересчёт часового пояса не поддерживается; вводите местное время рождения без другого timeZone');
  }
  
  // Проверка реального существования григорианской даты, включая високосные годы.
  if (
    Number.isInteger(birthInfo.year) && birthInfo.year >= 1900 && birthInfo.year <= 2100 &&
    Number.isInteger(birthInfo.month) && birthInfo.month >= 1 && birthInfo.month <= 12 &&
    Number.isInteger(birthInfo.day) && birthInfo.day >= 1 && birthInfo.day <= 31
  ) {
    const date = new Date(Date.UTC(birthInfo.year, birthInfo.month - 1, birthInfo.day));
    if (
      date.getUTCFullYear() !== birthInfo.year ||
      date.getUTCMonth() !== birthInfo.month - 1 ||
      date.getUTCDate() !== birthInfo.day
    ) {
      errors.push('такой григорианской даты не существует');
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 运行所有算法测试
 * @returns 综合测试结果
 */
export function runAllTests(): { 
  bazi: ReturnType<typeof runBaziTests>; 
  ziwei: ReturnType<typeof runZiweiTests>;
  summary: { totalPassed: number; totalFailed: number; success: boolean }
} {
  const baziResults = runBaziTests();
  const ziweiResults = runZiweiTests();
  
  const totalPassed = baziResults.passed + ziweiResults.passed;
  const totalFailed = baziResults.failed + ziweiResults.failed;
  
  return {
    bazi: baziResults,
    ziwei: ziweiResults,
    summary: {
      totalPassed,
      totalFailed,
      success: totalFailed === 0
    }
  };
}

/**
 * 格式化排盘结果为可读字符串（用于调试）
 * @param chart 排盘结果
 * @returns 格式化的字符串
 */
export function formatChartResult(chart: ChartResult): string {
  let result = '=== 排盘结果 ===\n\n';
  
  // 八字部分
  result += '【八字排盘】\n';
  result += `年柱: ${chart.bazi.siZhu.year.gan}${chart.bazi.siZhu.year.zhi}\n`;
  result += `月柱: ${chart.bazi.siZhu.month.gan}${chart.bazi.siZhu.month.zhi}\n`;
  result += `日柱: ${chart.bazi.siZhu.day.gan}${chart.bazi.siZhu.day.zhi}\n`;
  result += `时柱: ${chart.bazi.siZhu.hour.gan}${chart.bazi.siZhu.hour.zhi}\n`;
  result += `日主: ${chart.bazi.dayMaster}\n`;
  result += `大运起运: ${chart.bazi.dayunStart}岁\n`;
  result += `前三步大运: ${chart.bazi.dayun.slice(0, 3).map(dy => `${dy.ganZhi.gan}${dy.ganZhi.zhi}`).join(' ')}\n\n`;
  
  // 紫微斗数部分
  result += '【紫微斗数】\n';
  result += `命宫: ${chart.ziwei.gongs[0].dizhi}宫\n`;
  const shenGongDizhi = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'][chart.ziwei.shenGongIndex] || '未知';
  result += `身宫: ${shenGongDizhi}宫\n`;
  
  // 显示有主星的宫位
  chart.ziwei.gongs.forEach(gong => {
    if (gong.mainStars.length > 0) {
      result += `${gong.gong}(${gong.dizhi}): ${gong.mainStars.join('、')}`;
      if (gong.auxStars.length > 0) {
        result += ` [${gong.auxStars.join('、')}]`;
      }
      if (gong.sihua.length > 0) {
        result += ` {${gong.sihua.map(s => `${s.star}${s.hua}`).join('、')}}`;
      }
      result += '\n';
    }
  });
  
  return result;
}

// 导出示例用法
export const EXAMPLE_BIRTH_INFO: BirthInfo = {
  year: 1990,
  month: 5,
  day: 15,
  hour: 14,
  minute: 30,
  isLunar: false,
  gender: 'male',
  timeZone: 8
};
