// Будущий внутренний интерфейс сайта: локальная григорианская дата + местное время + пол → готовая карта.
// Здесь намеренно нет параметров лунной даты и часового пояса: MVP их не поддерживает.

import { createChart } from './yiqi-core/index';
import { ChartResult } from './yiqi-core/types';

export type LocalChartInput = {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, локальное время рождения без пересчёта часового пояса
  gender: 'male' | 'female';
};

export function calculateLocalChart(input: LocalChartInput): ChartResult {
  if (!input || typeof input !== 'object') {
    throw new Error('Некорректные данные рождения: входные данные отсутствуют');
  }

  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.date);
  if (!dateMatch) {
    throw new Error('Некорректная дата: используйте формат YYYY-MM-DD');
  }

  const timeMatch = /^(\d{2}):(\d{2})$/.exec(input.time);
  if (!timeMatch) {
    throw new Error('Некорректное время: используйте формат HH:MM');
  }

  return createChart({
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    gender: input.gender,
    isLunar: false,
    // Служебное legacy-поле движка. Пересчёт часового пояса не выполняется.
    timeZone: 8
  });
}
