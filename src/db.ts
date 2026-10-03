import Dexie, { type Table } from 'dexie';
import type { DayEntry, HabitTask, TaskCategory } from './types';

const DEFAULT_TASKS: Record<TaskCategory, string[]> = {
  workout: ['5 km / 10,000 steps', '5 Push-ups', '15–20 minutes Boxing', 'Hand Exercises'],
  diet: ['No Oil', 'No Sugar'],
  personal: ['No Distractions', 'Night Skincare'],
};

class HabitDatabase extends Dexie {
  tasks!: Table<HabitTask, string>;
  dayEntries!: Table<DayEntry, string>;

  constructor() {
    super('winter-arc-db');
    this.version(1).stores({
      tasks: 'id, category, isDefault, createdAt',
      dayEntries: 'date',
    });
  }
}

export const db = new HabitDatabase();

export const createEmptyCategoryEntry = (): CategoryEntry => ({
  notes: '',
  completed: {},
  caloriesBurned: 0,
  steps: 0,
  distance: 0,
  caloriesConsumed: 0,
  protein: 0,
});

export const createEmptyDayEntry = (date: string): DayEntry => ({
  date,
  workout: createEmptyCategoryEntry(),
  diet: createEmptyCategoryEntry(),
  personal: createEmptyCategoryEntry(),
});

export const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export async function initializeDatabase() {
  const existing = await db.tasks.count();
  if (existing > 0) return;

  const defaults: HabitTask[] = (Object.keys(DEFAULT_TASKS) as TaskCategory[]).flatMap((category) =>
    DEFAULT_TASKS[category].map((name, index) => ({
      id: `${category}-${index}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name,
      category,
      isDefault: true,
      target: undefined,
      createdAt: new Date().toISOString(),
    })),
  );

  await db.tasks.bulkAdd(defaults);
}

export async function listTasks() {
  return db.tasks.orderBy('createdAt').toArray();
}

export async function addTaskRecord(task: HabitTask) {
  await db.tasks.put(task);
}

export async function updateTaskRecord(task: HabitTask) {
  await db.tasks.put(task);
}

export async function deleteTaskRecord(taskId: string) {
  await db.tasks.delete(taskId);
}

export async function getDayEntry(date: string) {
  return db.dayEntries.get(date) ?? null;
}

export async function getDayEntriesForDates(dates: string[]) {
  const entries = await Promise.all(dates.map((date) => db.dayEntries.get(date)));
  return entries.filter(Boolean) as DayEntry[];
}

export async function getAllDayEntries() {
  return db.dayEntries.toArray();
}

export async function upsertDayEntry(entry: DayEntry) {
  await db.dayEntries.put(entry);
}

export function getWeekDates(baseDate: string) {
  const date = new Date(`${baseDate}T12:00:00`);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setDate(date.getDate() + diff);

  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(monday);
    next.setDate(monday.getDate() + index);
    return toISODate(next);
  });
}
