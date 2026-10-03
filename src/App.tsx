import { useEffect, useMemo, useState } from 'react';
import {
  addTaskRecord,
  createEmptyDayEntry,
  deleteTaskRecord,
  getAllDayEntries,
  getDayEntriesForDates,
  getDayEntry,
  getWeekDates,
  initializeDatabase,
  listTasks,
  toISODate,
  upsertDayEntry,
  updateTaskRecord,
} from './db';
import type { CategoryEntry, DayEntry, HabitTask, TaskCategory } from './types';

const CATEGORY_META: Record<TaskCategory, { title: string; icon: string }> = {
  workout: { title: 'Workout', icon: '🏋️' },
  diet: { title: 'Diet', icon: '🥗' },
  personal: { title: 'Personal', icon: '✨' },
};

const CATEGORY_ORDER: TaskCategory[] = ['workout', 'diet', 'personal'];

const parseISODate = (value: string) => {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const addDays = (date: Date, count: number) => {
  const result = new Date(date);
  result.setDate(result.getDate() + count);
  return result;
};

const isSameDay = (a: string, b: string) => a === b;

const safeNumber = (value: number | string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const formatMonth = (value: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long' }).format(parseISODate(value));

const formatDay = (value: string) =>
  new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(parseISODate(value));

const formatWeekday = (value: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(parseISODate(value));

const getDailyPercent = (
  entry: DayEntry | null | undefined,
  tasks: HabitTask[],
) => {
  if (!entry) return 0;
  const total = tasks.length;
  if (total === 0) return 0;

  let done = 0;
  for (const task of tasks) {
    if (Boolean(entry[task.category].completed[task.id])) done += 1;
  }

  return clampPercent((done / total) * 100);
};

function App() {
  const today = toISODate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<HabitTask[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<DayEntry | null>(null);
  const [weekEntries, setWeekEntries] = useState<Record<string, DayEntry>>({});
  const [allEntries, setAllEntries] = useState<Record<string, DayEntry>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState({
    name: '',
    category: 'workout' as TaskCategory,
    target: '',
  });

  const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);

  const categoryTasks = useMemo(
    () => ({
      workout: tasks.filter((task) => task.category === 'workout'),
      diet: tasks.filter((task) => task.category === 'diet'),
      personal: tasks.filter((task) => task.category === 'personal'),
    }),
    [tasks],
  );

  useEffect(() => {
    const bootstrap = async () => {
      await initializeDatabase();
      const storedTasks = await listTasks();
      setTasks(storedTasks);
      setIsLoading(false);
    };

    bootstrap();
  }, []);

  useEffect(() => {
    if (isLoading) return;

    const loadSelectedDate = async () => {
      const entry = (await getDayEntry(selectedDate)) ?? createEmptyDayEntry(selectedDate);
      setSelectedEntry(entry);
    };

    const loadWeekDates = async () => {
      const entries = await getDayEntriesForDates(weekDates);
      const next: Record<string, DayEntry> = {};
      for (const entry of entries) next[entry.date] = entry;
      setWeekEntries(next);
    };

    const loadAll = async () => {
      const entries = await getAllDayEntries();
      const next: Record<string, DayEntry> = {};
      for (const entry of entries) next[entry.date] = entry;
      setAllEntries(next);
    };

    void loadSelectedDate();
    void loadWeekDates();
    void loadAll();
  }, [isLoading, selectedDate, weekDates]);

  const persistEntry = async (entry: DayEntry) => {
    await upsertDayEntry(entry);
    setSelectedEntry(entry);
    setWeekEntries((current) => ({ ...current, [entry.date]: entry }));
    setAllEntries((current) => ({ ...current, [entry.date]: entry }));
  };

  const updateSelectedEntry = async (
    category: TaskCategory,
    patch: Partial<CategoryEntry>,
  ) => {
    const base = selectedEntry ?? createEmptyDayEntry(selectedDate);
    const next: DayEntry = {
      ...base,
      [category]: {
        ...(base[category] ?? createEmptyDayEntry(selectedDate)[category]),
        ...patch,
      },
    };

    await persistEntry(next);
  };

  const toggleTask = async (category: TaskCategory, taskId: string) => {
    const base = selectedEntry ?? createEmptyDayEntry(selectedDate);
    const nextCompleted = { ...base[category].completed };
    nextCompleted[taskId] = !Boolean(nextCompleted[taskId]);

    const next: DayEntry = {
      ...base,
      [category]: {
        ...base[category],
        completed: nextCompleted,
      },
    };

    await persistEntry(next);
  };

  const toggleWeekTask = async (date: string, category: TaskCategory, taskId: string) => {
    const base = weekEntries[date] ?? createEmptyDayEntry(date);
    const nextCompleted = { ...base[category].completed };
    nextCompleted[taskId] = !Boolean(nextCompleted[taskId]);

    const next: DayEntry = {
      ...base,
      [category]: {
        ...base[category],
        completed: nextCompleted,
      },
    };

    await upsertDayEntry(next);
    setWeekEntries((current) => ({ ...current, [date]: next }));
    setAllEntries((current) => ({ ...current, [date]: next }));

    if (isSameDay(date, selectedDate)) {
      setSelectedEntry(next);
    }
  };

  const handleTaskSave = async () => {
    const name = taskDraft.name.trim();
    if (!name) return;

    if (editingTaskId) {
      const task = tasks.find((item) => item.id === editingTaskId);
      if (!task) return;

      const updatedTask: HabitTask = {
        ...task,
        name,
        category: taskDraft.category,
        target: taskDraft.target || undefined,
      };

      await updateTaskRecord(updatedTask);
      setTasks((current) => current.map((item) => (item.id === updatedTask.id ? updatedTask : item)));
    } else {
      const newTask: HabitTask = {
        id: crypto.randomUUID(),
        name,
        category: taskDraft.category,
        isDefault: false,
        target: taskDraft.target || undefined,
        createdAt: new Date().toISOString(),
      };

      await addTaskRecord(newTask);
      setTasks((current) => [...current, newTask]);
    }

    setModalOpen(false);
    setEditingTaskId(null);
    setTaskDraft({ name: '', category: 'workout', target: '' });
  };

  const handleDeleteTask = async (taskId: string) => {
    await deleteTaskRecord(taskId);
    setTasks((current) => current.filter((task) => task.id !== taskId));
  };

  const selectedSummary = useMemo(() => {
    const entry = selectedEntry ?? createEmptyDayEntry(selectedDate);

    return {
      workout: {
        total: categoryTasks.workout.length,
        done: categoryTasks.workout.filter((task) => Boolean(entry.workout.completed[task.id])).length,
        steps: safeNumber(entry.workout.steps),
        distance: safeNumber(entry.workout.distance),
        calories: safeNumber(entry.workout.caloriesBurned),
      },
      diet: {
        total: categoryTasks.diet.length,
        done: categoryTasks.diet.filter((task) => Boolean(entry.diet.completed[task.id])).length,
        calories: safeNumber(entry.diet.caloriesConsumed),
        protein: safeNumber(entry.diet.protein),
      },
      personal: {
        total: categoryTasks.personal.length,
        done: categoryTasks.personal.filter((task) => Boolean(entry.personal.completed[task.id])).length,
      },
    };
  }, [categoryTasks, selectedDate, selectedEntry]);

  const progressStats = useMemo(() => {
    const getDateCompletion = (date: string) => {
      const entry = allEntries[date] ?? createEmptyDayEntry(date);
      return getDailyPercent(entry, tasks);
    };

    let streak = 0;
    let cursor = new Date();
    while (true) {
      const iso = toISODate(cursor);
      if (getDateCompletion(iso) >= 70) {
        streak += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }

    let bestStreak = 0;
    let running = 0;
    const sortedDates = Object.keys(allEntries).sort();
    for (const iso of sortedDates) {
      if (getDateCompletion(iso) >= 70) {
        running += 1;
        bestStreak = Math.max(bestStreak, running);
      } else {
        running = 0;
      }
    }

    const last7 = Array.from({ length: 7 }, (_, index) => {
      const date = addDays(new Date(), - (6 - index));
      return toISODate(date);
    });
    const weekly =
      last7.reduce((total, iso) => total + getDateCompletion(iso), 0) / last7.length;

    const monthDates = [] as string[];
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    for (let i = 0; i < 32; i += 1) {
      const date = addDays(monthStart, i);
      if (date.getMonth() === new Date().getMonth()) monthDates.push(toISODate(date));
    }
    const monthly =
      monthDates.length === 0
        ? 0
        : monthDates.reduce((total, iso) => total + getDateCompletion(iso), 0) / monthDates.length;

    const workoutDays = Object.values(allEntries).filter((entry) => {
      const total = categoryTasks.workout.length;
      if (total === 0) return false;
      const done = categoryTasks.workout.filter((task) => Boolean(entry.workout.completed[task.id])).length;
      return clampPercent((done / total) * 100) >= 80;
    }).length;

    const dietDays = Object.values(allEntries).filter((entry) => {
      const total = categoryTasks.diet.length;
      if (total === 0) return false;
      const done = categoryTasks.diet.filter((task) => Boolean(entry.diet.completed[task.id])).length;
      return clampPercent((done / total) * 100) >= 80;
    }).length;

    const personalDays = Object.values(allEntries).filter((entry) => {
      const total = categoryTasks.personal.length;
      if (total === 0) return false;
      const done = categoryTasks.personal.filter((task) => Boolean(entry.personal.completed[task.id])).length;
      return clampPercent((done / total) * 100) >= 80;
    }).length;

    return {
      currentStreak: streak,
      bestStreak,
      weeklyAverage: weekly,
      monthlyAverage: monthly,
      workoutDays,
      dietDays,
      personalDays,
    };
  }, [allEntries, categoryTasks, tasks]);

  const renderTaskList = (category: TaskCategory) => {
    const tasksForCategory = categoryTasks[category];
    const entry = selectedEntry ?? createEmptyDayEntry(selectedDate);

    return (
      <section className="category-panel" key={category}>
        <div className="panel-header">
          <div className="panel-title-wrap">
            <span className="category-icon">{CATEGORY_META[category].icon}</span>
            <div>
              <h3>{CATEGORY_META[category].title}</h3>
              <p>
                {tasksForCategory.filter((task) => Boolean(entry[category].completed[task.id])).length}/
                {tasksForCategory.length} complete
              </p>
            </div>
          </div>
          <button className="add-button" onClick={() => {
            setEditingTaskId(null);
            setTaskDraft({ name: '', category, target: '' });
            setModalOpen(true);
          }}>
            + Add
          </button>
        </div>

        <div className="task-list">
          {tasksForCategory.map((task) => {
            const checked = Boolean(entry[category].completed[task.id]);
            return (
              <div className="task-row" key={task.id}>
                <button
                  type="button"
                  className={`check-toggle ${checked ? 'checked' : ''}`}
                  onClick={() => toggleTask(category, task.id)}
                  aria-label={`Toggle ${task.name}`}
                >
                  {checked ? '✓' : ''}
                </button>

                <div className="task-content">
                  <span className="task-name">{task.name}</span>
                  {task.target ? <small>{task.target}</small> : null}
                </div>

                {!task.isDefault ? (
                  <div className="task-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingTaskId(task.id);
                        setTaskDraft({
                          name: task.name,
                          category: task.category,
                          target: task.target ?? '',
                        });
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" onClick={() => handleDeleteTask(task.id)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {category === 'workout' ? (
          <div className="metric-panel">
            {[
              ['Total calories burned', 'caloriesBurned', 'number'],
              ['Total steps', 'steps', 'number'],
              ['Total distance', 'distance', 'number'],
            ].map(([label, key, type]) => (
              <div className="field-group" key={label as string}>
                <label>{label as string}</label>
                <input
                  type={type as string}
                  value={Number((entry[category] as any)[key as keyof CategoryEntry] ?? 0)}
                  onChange={(event) =>
                    updateSelectedEntry(category, {
                      [key]: safeNumber(event.target.value),
                    } as Partial<CategoryEntry>)
                  }
                />
              </div>
            ))}

            <div className="field-group notes-field">
              <label>Workout notes</label>
              <textarea
                value={entry.workout.notes}
                onChange={(event) => updateSelectedEntry('workout', { notes: event.target.value })}
                placeholder="Workout reflection..."
              />
            </div>
          </div>
        ) : null}

        {category === 'diet' ? (
          <div className="metric-panel">
            <div className="field-group">
              <label>Total calories consumed</label>
              <input
                type="number"
                value={entry.diet.caloriesConsumed}
                onChange={(event) => updateSelectedEntry('diet', { caloriesConsumed: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group">
              <label>Total protein consumed</label>
              <input
                type="number"
                value={entry.diet.protein}
                onChange={(event) => updateSelectedEntry('diet', { protein: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group notes-field">
              <label>Diet notes</label>
              <textarea
                value={entry.diet.notes}
                onChange={(event) => updateSelectedEntry('diet', { notes: event.target.value })}
                placeholder="Meals, calories, protein, notes..."
              />
            </div>
          </div>
        ) : null}

        {category === 'personal' ? (
          <div className="metric-panel">
            <div className="field-group notes-field">
              <label>Daily notes</label>
              <textarea
                value={entry.personal.notes}
                onChange={(event) => updateSelectedEntry('personal', { notes: event.target.value })}
                placeholder="Reflection, focus, or personal notes..."
              />
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  const dailyCompletion =
    tasks.length === 0
      ? 0
      : (tasks.filter((task) => Boolean((selectedEntry ?? createEmptyDayEntry(selectedDate))[task.category].completed[task.id])).length /
          tasks.length) *
        100;

  return (
    <div className="app-shell">
      <div className="aurora aurora-one" />
      <div className="aurora aurora-two" />

      <header className="topbar">
        <div>
          <p className="kicker">Winter Arc</p>
          <h1>Daily Habit Tracker</h1>
        </div>

        <div className="date-controls">
          <button type="button" onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), -1)))}>
            ← Previous
          </button>
          <button type="button" className="today-button" onClick={() => setSelectedDate(today)}>
            Today
          </button>
          <button type="button" onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), 1)))}>
            Next →
          </button>
        </div>
      </header>

      <main className="dashboard">
        <section className="summary-block">
          <div className="date-banner">
            <div>
              <small>{formatMonth(selectedDate)}</small>
              <h2>
                {formatDay(selectedDate)} {new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(parseISODate(selectedDate))}
              </h2>
            </div>
            {isSameDay(selectedDate, today) ? <span className="today-pill">Today</span> : null}
          </div>

          <div className="summary-grid">
            <div className="summary-card mega">
              <span>Daily completion</span>
              <strong>{Math.round(dailyCompletion)}%</strong>
              <small>
                {tasks.filter((task) => Boolean((selectedEntry ?? createEmptyDayEntry(selectedDate))[task.category].completed[task.id])).length}/
                {tasks.length} tasks complete
              </small>
            </div>

            <div className="summary-card">
              <span>Workout</span>
              <strong>{Math.round((selectedSummary.workout.done / Math.max(1, selectedSummary.workout.total)) * 100)}%</strong>
              <small>{selectedSummary.workout.steps.toLocaleString()} steps</small>
            </div>

            <div className="summary-card">
              <span>Diet</span>
              <strong>{Math.round((selectedSummary.diet.done / Math.max(1, selectedSummary.diet.total)) * 100)}%</strong>
              <small>
                {selectedSummary.diet.calories} cal · {selectedSummary.diet.protein}g protein
              </small>
            </div>

            <div className="summary-card">
              <span>Personal</span>
              <strong>{Math.round((selectedSummary.personal.done / Math.max(1, selectedSummary.personal.total)) * 100)}%</strong>
              <small>
                {selectedSummary.personal.done}/{selectedSummary.personal.total} complete
              </small>
            </div>
          </div>
        </section>

        <section className="progress-section">
          <div className="section-heading">
            <p>Progress</p>
            <h3>Momentum overview</h3>
          </div>

          <div className="progress-grid">
            <div className="stat-card">
              <span>Current streak</span>
              <strong>{progressStats.currentStreak} days</strong>
            </div>
            <div className="stat-card">
              <span>Best streak</span>
              <strong>{progressStats.bestStreak} days</strong>
            </div>
            <div className="stat-card">
              <span>Weekly completion</span>
              <strong>{Math.round(progressStats.weeklyAverage)}%</strong>
            </div>
            <div className="stat-card">
              <span>Monthly completion</span>
              <strong>{Math.round(progressStats.monthlyAverage)}%</strong>
            </div>
            <div className="stat-card">
              <span>Total workout days</span>
              <strong>{progressStats.workoutDays}</strong>
            </div>
            <div className="stat-card">
              <span>Total diet-success days</span>
              <strong>{progressStats.dietDays}</strong>
            </div>
            <div className="stat-card">
              <span>Total personal-success days</span>
              <strong>{progressStats.personalDays}</strong>
            </div>
          </div>
        </section>

        <section className="tracker-block">
          <div className="section-heading tracker-header">
            <div>
              <p>Weekly check-in</p>
              <h3>Habit tracker</h3>
            </div>

            <div className="week-nav">
              <button type="button" onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), -7)))}>
                Previous week
              </button>
              <button type="button" className="today-button" onClick={() => setSelectedDate(today)}>
                Current week
              </button>
              <button type="button" onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), 7)))}>
                Next week
              </button>
            </div>
          </div>

          <div className="tracker-grid">
            <div className="tracker-header-row">
              <div className="task-label-header">Task</div>
              {weekDates.map((date) => (
                <button
                  type="button"
                  key={date}
                  className={`day-cell ${isSameDay(date, today) ? 'today' : ''} ${isSameDay(date, selectedDate) ? 'selected' : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  <span>{formatMonth(date)}</span>
                  <strong>{formatDay(date)}</strong>
                  <small>{formatWeekday(date)}</small>
                </button>
              ))}
            </div>

            {CATEGORY_ORDER.map((category) => (
              <div className="tracker-category" key={category}>
                <div className="category-header-row">
                  <div className="category-title">{CATEGORY_META[category].title}</div>
                  {weekDates.map((date) => (
                    <div key={`${category}-${date}`} className="mini-date-pill">
                      {weekEntries[date] ? '•' : ''}
                    </div>
                  ))}
                </div>

                {categoryTasks[category].map((task) => (
                  <div className="tracker-task-row" key={task.id}>
                    <div className="task-name-block">
                      <span>{task.name}</span>
                    </div>

                    {weekDates.map((date) => {
                      const entry = weekEntries[date] ?? createEmptyDayEntry(date);
                      const checked = Boolean(entry[category].completed[task.id]);

                      return (
                        <button
                          type="button"
                          key={`${task.id}-${date}`}
                          className={`day-toggle ${checked ? 'checked' : ''} ${isSameDay(date, today) ? 'today' : ''}`}
                          onClick={() => toggleWeekTask(date, category, task.id)}
                        >
                          {checked ? '✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>

        <section className="daily-grid">{CATEGORY_ORDER.map((category) => renderTaskList(category))}</section>
      </main>

      {modalOpen ? (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="task-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTaskId ? 'Edit task' : 'Add custom task'}</h3>
              <button type="button" className="close-button" onClick={() => setModalOpen(false)}>
                ×
              </button>
            </div>

            <div className="modal-body">
              <label>
                Task name
                <input
                  type="text"
                  value={taskDraft.name}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Task name"
                />
              </label>

              <label>
                Category
                <select
                  value={taskDraft.category}
                  onChange={(event) =>
                    setTaskDraft((current) => ({
                      ...current,
                      category: event.target.value as TaskCategory,
                    }))
                  }
                >
                  <option value="workout">Workout</option>
                  <option value="diet">Diet</option>
                  <option value="personal">Personal</option>
                </select>
              </label>

              <label>
                Target / value (optional)
                <input
                  type="text"
                  value={taskDraft.target}
                  onChange={(event) => setTaskDraft((current) => ({ ...current, target: event.target.value }))}
                  placeholder="e.g. 10 minutes or 5 km"
                />
              </label>
            </div>

            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button type="button" className="primary-button" onClick={handleTaskSave}>
                {editingTaskId ? 'Save changes' : 'Add task'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
