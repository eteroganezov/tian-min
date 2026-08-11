import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLocalChart } from '../local-chart';
import { createChart, validateBirthInfo } from '../yiqi-core/index';

const validBirth = {
  year: 2000,
  month: 1,
  day: 1,
  hour: 12,
  minute: 0,
  gender: 'male' as const,
  isLunar: false,
  timeZone: 8
};

test('принимает существующую високосную дату', () => {
  assert.equal(validateBirthInfo({ ...validBirth, year: 2000, month: 2, day: 29 }).valid, true);
});

test('отклоняет несуществующую григорианскую дату', () => {
  assert.throws(
    () => createChart({ ...validBirth, month: 2, day: 30 }),
    /даты не существует/
  );
});

test('отклоняет час за пределами 0-23', () => {
  assert.throws(() => createChart({ ...validBirth, hour: 24 }), /час должен быть/);
});

test('отклоняет минуты за пределами 0-59', () => {
  assert.throws(() => createChart({ ...validBirth, minute: 60 }), /минуты должны быть/);
});

test('отклоняет неизвестный пол вместо молчаливой подмены на female', () => {
  assert.throws(
    () => createChart({ ...validBirth, gender: 'unknown' as any }),
    /пол должен быть/
  );
});

test('явно запрещает пока не поддерживаемую лунную дату', () => {
  assert.throws(() => createChart({ ...validBirth, isLunar: true }), /лунной даты не поддерживается/);
});

test('явно запрещает попытку включить пересчёт часового пояса', () => {
  assert.throws(() => createChart({ ...validBirth, timeZone: 3 }), /часового пояса не поддерживается/);
});

test('внутренний интерфейс требует строгие форматы YYYY-MM-DD и HH:MM', () => {
  assert.throws(
    () => calculateLocalChart({ date: '2000-1-1', time: '12:00', gender: 'male' }),
    /формат YYYY-MM-DD/
  );
  assert.throws(
    () => calculateLocalChart({ date: '2000-01-01', time: '7:30', gender: 'male' }),
    /формат HH:MM/
  );
});

test('внутренний интерфейс возвращает полную BaZi + Zi Wei карту', () => {
  const chart: any = calculateLocalChart({ date: '2000-01-01', time: '12:00', gender: 'male' });
  assert.equal(chart.bazi.enrichment.格局.primary, '正财格');
  assert.equal(chart.bazi.cangGan.day[0].gan, '丁');
  assert.equal(chart.bazi.dayun[0].endAge, chart.bazi.dayun[0].startAge + 9);
  assert.equal(chart.ziwei.gongs.length, 12);
});
