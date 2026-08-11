import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLocalChart } from '../local-chart';

const DIZHI = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'];

function pillars(chart: any): string[] {
  return ['year', 'month', 'day', 'hour'].map(key => {
    const pillar = chart.bazi.siZhu[key];
    return pillar.gan + pillar.zhi;
  });
}

test('BaZi: обычная дата совпадает с контрольным примером проекта', () => {
  const chart = calculateLocalChart({ date: '1979-05-04', time: '06:00', gender: 'male' });
  assert.deepEqual(pillars(chart), ['己未', '戊辰', '辛未', '辛卯']);
});

test('BaZi: 2000-03-01 подтверждён двумя API lunar-typescript', () => {
  // lunar-typescript 1.8.6: Lunar.getDayInGanZhi() === EightChar.getDay() === 戊午.
  const chart = calculateLocalChart({ date: '2000-03-01', time: '12:00', gender: 'female' });
  assert.deepEqual(pillars(chart), ['庚辰', '戊寅', '戊午', '戊午']);
});

test('BaZi: день до и день китайского Нового года берутся из lunar-typescript', () => {
  const before = calculateLocalChart({ date: '2000-02-04', time: '12:00', gender: 'male' });
  const after = calculateLocalChart({ date: '2000-02-05', time: '12:00', gender: 'male' });
  assert.equal(before.bazi.siZhu.year.gan + before.bazi.siZhu.year.zhi, '己卯');
  assert.equal(after.bazi.siZhu.year.gan + after.bazi.siZhu.year.zhi, '庚辰');
});

test('BaZi: поздний 子 час в 23:00 использует столп следующего дня', () => {
  const before = calculateLocalChart({ date: '2000-03-01', time: '22:59', gender: 'male' });
  const lateZi = calculateLocalChart({ date: '2000-03-01', time: '23:00', gender: 'male' });
  const midnight = calculateLocalChart({ date: '2000-03-02', time: '00:00', gender: 'male' });
  assert.equal(before.bazi.siZhu.day.gan + before.bazi.siZhu.day.zhi, '戊午');
  assert.equal(lateZi.bazi.siZhu.day.gan + lateZi.bazi.siZhu.day.zhi, '己未');
  assert.deepEqual(lateZi.bazi.siZhu.day, midnight.bazi.siZhu.day);
  assert.deepEqual(lateZi.bazi.siZhu.hour, midnight.bazi.siZhu.hour);
});

test('BaZi: месяц переключается после точного момента 立春, а не в 00:00', () => {
  // lunar-typescript 1.8.6 даёт 立春 2024-02-04 16:27:07.
  const before = calculateLocalChart({ date: '2024-02-04', time: '16:26', gender: 'male' });
  const after = calculateLocalChart({ date: '2024-02-04', time: '16:28', gender: 'male' });
  assert.equal(before.bazi.siZhu.month.gan + before.bazi.siZhu.month.zhi, '乙丑');
  assert.equal(after.bazi.siZhu.month.gan + after.bazi.siZhu.month.zhi, '丙寅');
});

test('BaZi: месяц переключается после точного момента 惊蛰', () => {
  // lunar-typescript 1.8.6 даёт 惊蛰 2024-03-05 10:22:45.
  const before = calculateLocalChart({ date: '2024-03-05', time: '10:22', gender: 'female' });
  const after = calculateLocalChart({ date: '2024-03-05', time: '10:23', gender: 'female' });
  assert.equal(before.bazi.siZhu.month.gan + before.bazi.siZhu.month.zhi, '丙寅');
  assert.equal(after.bazi.siZhu.month.gan + after.bazi.siZhu.month.zhi, '丁卯');
});

test('Zi Wei: до китайского Нового года используется ствол китайского года', () => {
  const before = calculateLocalChart({ date: '2000-02-04', time: '12:00', gender: 'male' }).ziwei;
  const after = calculateLocalChart({ date: '2000-02-05', time: '12:00', gender: 'male' }).ziwei;
  assert.equal(before.siZhu?.year.gan + before.siZhu?.year.zhi, '己卯');
  assert.equal(before.yinYang, '阴男');
  assert.equal(after.siZhu?.year.gan + after.siZhu?.year.zhi, '庚辰');
  assert.equal(after.yinYang, '阳男');
});

test('Zi Wei: та же граница корректна для женщины в 2024 году', () => {
  const before = calculateLocalChart({ date: '2024-02-09', time: '12:00', gender: 'female' }).ziwei;
  const after = calculateLocalChart({ date: '2024-02-10', time: '12:00', gender: 'female' }).ziwei;
  assert.equal(before.siZhu?.year.gan, '癸');
  assert.equal(before.yinYang, '阴女');
  assert.equal(after.siZhu?.year.gan, '甲');
  assert.equal(after.yinYang, '阳女');
});

test('Zi Wei: направление 大限 меняется вместе с 阴男/阳男', () => {
  const yinMale = calculateLocalChart({ date: '2000-02-04', time: '12:00', gender: 'male' }).ziwei;
  const yangMale = calculateLocalChart({ date: '2000-02-05', time: '12:00', gender: 'male' }).ziwei;
  assert.equal(yinMale.gongs[1].daXian?.startAge, 15);
  assert.equal(yangMale.gongs[11].daXian?.startAge, 12);
});

test('Zi Wei: структурные инварианты полной карты', () => {
  const ziwei = calculateLocalChart({ date: '1990-05-15', time: '14:30', gender: 'female' }).ziwei;
  assert.equal(ziwei.gongs.length, 12);
  assert.equal(new Set(ziwei.gongs.map(gong => gong.dizhi)).size, 12);
  const mainStars = ziwei.gongs.flatMap(gong => gong.mainStars);
  assert.equal(mainStars.length, 14);
  assert.equal(new Set(mainStars).size, 14);
  const transformations = ziwei.gongs.flatMap(gong => gong.sihua);
  assert.equal(transformations.length, 4);
  assert.ok(DIZHI.includes(DIZHI[ziwei.shenGongIndex]));
});

test('общий встроенный набор алгоритмов проходит без ошибок', async () => {
  const { formatChartResult, runAllTests } = await import('../yiqi-core/index');
  const result = runAllTests();
  assert.equal(result.summary.success, true);
  assert.equal(result.summary.totalPassed, 7);
  assert.equal(result.summary.totalFailed, 0);

  const sample = calculateLocalChart({ date: '2000-01-01', time: '12:00', gender: 'male' });
  assert.match(formatChartResult(sample), /身宫: 午宫/);
});
