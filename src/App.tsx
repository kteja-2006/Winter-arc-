import { useEffect, useMemo, useState } from 'react';
import {
  addTaskRecord,
  deleteTaskRecord,
  getAllDayEntries,
  getDayEntriesForDates,
  getDayEntry,
  initializeDatabase,
  listTasks,
  upsertDayEntry,
  updateTaskRecord,
} from './db';
import type { CategoryEntry, DayEntry, HabitTask, TaskCategory } from './types';

const CATEGORY_META: Record<
  TaskCategory,
  { title: string; accent: string; icon: string }
> = {
  workout: { title: 'Workout', accent: 'cyan', icon: '🏋️' },
  diet: { title: 'Diet', accent: 'violet', icon: '🥗' },
  personal: { title: 'Personal', accent: 'amber', icon: '✨' },
};

const DEFAULT_TASKS: Record<TaskCategory, string[]> = {
  workout: ['5 km / 10,000 steps', '5 Push-ups', '15–20 minutes Boxing', 'Hand Exercises'],
  diet: ['No Oil', 'No Sugar'],
  personal: ['No Distractions', 'Night Skincare'],
};

const createEmptyCategoryEntry = (): CategoryEntry => ({
  notes: '',
  completed: {},
  caloriesBurned: 0,
  steps: 0,
  distance: 0,
  caloriesConsumed: 0,
  protein: 0,
});

const createEmptyDayEntry = (date: string): DayEntry => ({
  date,
  workout: createEmptyCategoryEntry(),
  diet: createEmptyCategoryEntry(),
  personal: createEmptyCategoryEntry(),
});

const toISODate = (date: Date) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseISODate = (dateString: string) => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

const isSameDate = (a: string, b: string) => a === b;

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getWeekDates = (dateString: string) => {
  const date = parseISODate(dateString);
  const dayIndex = date.getDay();
  const diffToMonday = dayIndex === 0 ? -6 : 1 - dayIndex;
  const monday = addDays(date, diffToMonday);
  return Array.from({ length: 7 }, (_, index) => toISODate(addDays(monday, index)));
};

const formatWeekdayShort = (dateString: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(parseISODate(dateString));

const formatMonthText = (dateString: string) =>
  new Intl.DateTimeFormat('en-US', { month: 'long' }).format(parseISODate(dateString));

const formatDateText = (dateString: string) =>
  new Intl.DateTimeFormat('en-US', { day: 'numeric' }).format(parseISODate(dateString));

const safeNumber = (value: number | string | undefined) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const percent = (value: number, total: number) => (total === 0 ? 0 : (value / total) * 100);

function App() {
  const today = toISODate(new Date());
  const [selectedDate, setSelectedDate] = useState(today);
  const [tasks, setTasks] = useState<HabitTask[]>([]);
  const [dayEntry, setDayEntry] = useState<DayEntry | null>(null);
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
    if (!isLoading) {
      const loadSelected = async () => {
        const current = await getDayEntry(selectedDate);
        setDayEntry(current ?? createEmptyDayEntry(selectedDate));
      };

      const loadWeekMap = async () => {
        const entries = await getDayEntriesForDates(weekDates);
        const map: Record<string, DayEntry> = {};
        entries.forEach((entry) => {
          map[entry.date] = entry;
        });
        setWeekEntries(map);
      };

      const loadAll = async () => {
        const entries = await getAllDayEntries();
        const map: Record<string, DayEntry> = {};
        entries.forEach((entry) => {
          map[entry.date] = entry;
        });
        setAllEntries(map);
      };

      loadSelected();
      loadWeekMap();
      loadAll();
    }
  }, [selectedDate, isLoading, weekDates]);

  const categoryTaskMap = useMemo(
    () => ({
      workout: tasks.filter((task) => task.category === 'workout'),
      diet: tasks.filter((task) => task.category === 'diet'),
      personal: tasks.filter((task) => task.category === 'personal'),
    }),
    [tasks],
  );

  const saveDayEntryState = async (entry: DayEntry) => {
    await upsertDayEntry(entry);
    setDayEntry(entry);

    const all = { ...allEntries };
    all[entry.date] = entry;
    setAllEntries(all);

    const weekMap = { ...weekEntries };
    weekMap[entry.date] = entry;
    setWeekEntries(weekMap);
  };

  const updateSelectedDay = async (
    category: TaskCategory,
    updates: Partial<CategoryEntry>,
  ) => {
    const current = dayEntry ?? createEmptyDayEntry(selectedDate);
    const nextEntry: DayEntry = {
      ...current,
      [category]: {
        ...(current[category] ?? createEmptyCategoryEntry()),
        ...updates,
      },
    };
    await saveDayEntryState(nextEntry);
  };

  const toggleTask = async (category: TaskCategory, taskId: string) => {
    const current = dayEntry ?? createEmptyDayEntry(selectedDate);
    const prevStatus = Boolean(current[category].completed[taskId]);
    const nextEntry: DayEntry = {
      ...current,
      [category]: {
        ...current[category],
        completed: {
          ...current[category].completed,
          [taskId]: !prevStatus,
        },
      },
    };

    await saveDayEntryState(nextEntry);
  };

  const toggleTaskInWeek = async (date: string, category: TaskCategory, taskId: string) => {
    const current = weekEntries[date] ?? createEmptyDayEntry(date);
    const prevStatus = Boolean(current[category].completed[taskId]);
    const nextEntry: DayEntry = {
      ...current,
      [category]: {
        ...current[category],
        completed: {
          ...current[category].completed,
          [taskId]: !prevStatus,
        },
      },
    };

    const updatedWeek = { ...weekEntries, [date]: nextEntry };
    setWeekEntries(updatedWeek);
    await upsertDayEntry(nextEntry);

    const nextAll = { ...allEntries };
    nextAll[date] = nextEntry;
    setAllEntries(nextAll);
  };

  const openAddTaskModal = (category: TaskCategory, task?: HabitTask) => {
    if (task) {
      setEditingTaskId(task.id);
      setTaskDraft({
        name: task.name,
        category: task.category,
        target: task.target ?? '',
      });
    } else {
      setEditingTaskId(null);
      setTaskDraft({
        name: '',
        category,
        target: '',
      });
    }

    setModalOpen(true);
  };

  const handleSaveTask = async () => {
    const name = taskDraft.name.trim();
    if (!name) return;

    if (editingTaskId) {
      const task = tasks.find((entry) => entry.id === editingTaskId);
      if (!task) return;

      const updatedTask: HabitTask = {
        ...task,
        name,
        category: taskDraft.category,
        target: taskDraft.target || undefined,
      };

      await updateTaskRecord(updatedTask);
      setTasks((current) =>
        current.map((entry) => (entry.id === updatedTask.id ? updatedTask : entry)),
      );
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

  const dailyCompletion = useMemo(() => {
    const allTasks = tasks;
    const doneCount = allTasks.filter((task) => Boolean(dayEntry?.[task.category].completed[task.id])).length;
    return {
      total: allTasks.length,
      done: doneCount,
      percent: allTasks.length === 0 ? 0 : (doneCount / allTasks.length) * 100,
    };
  }, [dayEntry, tasks]);

  const categorySummaries = useMemo(() => {
    const categories = Object.keys(CATEGORY_META) as TaskCategory[];

    return categories.map((category) => {
      const taskList = categoryTaskMap[category];
      const completed = taskList.filter((task) => Boolean(dayEntry?.[category].completed[task.id])).length;
      const total = taskList.length;

      return {
        category,
        total,
        completed,
        percent: total === 0 ? 0 : (completed / total) * 100,
      };
    });
  }, [categoryTaskMap, dayEntry]);

  const progressStats = useMemo(() => {
    const dates = Object.keys(allEntries).sort();

    const getDatePercent = (date: string) => {
      const entry = allEntries[date] ?? createEmptyDayEntry(date);
      let total = 0;
      let done = 0;
      (Object.keys(CATEGORY_META) as TaskCategory[]).forEach((category) => {
        const taskList = tasks.filter((task) => task.category === category);
        total += taskList.length;
        done += taskList.filter((task) => Boolean(entry[category].completed[task.id])).length;
      });
      return total === 0 ? 0 : (done / total) * 100;
    };

    let currentStreak = 0;
    let cursor = new Date(selectedDate);

    while (true) {
      const key = toISODate(cursor);
      const pct = getDatePercent(key);
      if (pct >= 70) {
        currentStreak += 1;
        cursor = addDays(cursor, -1);
      } else {
        break;
      }
    }

    let bestStreak = 0;
    let tempStreak = 0;
    const reversed = [...dates].sort((a, b) => (a < b ? -1 : 1));
    reversed.forEach((date) => {
      if (getDatePercent(date) >= 70) {
        tempStreak += 1;
        bestStreak = Math.max(bestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    });

    const today = parseISODate(selectedDate);
    const startOfWeek = addDays(today, 1 - today.getDay() || -6);
    const last7Days = Array.from({ length: 7 }, (_, index) => toISODate(addDays(startOfWeek, index)));
    const weeklyAverage = last7Days.reduce((total, date) => total + getDatePercent(date), 0) / last7Days.length;

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthDates = [] as string[];
    for (let i = 0; i < 31; i += 1) {
      const date = addDays(monthStart, i);
      if (date.getMonth() === today.getMonth()) {
        monthDates.push(toISODate(date));
      }
    }
    const monthlyAverage =
      monthDates.length === 0
        ? 0
        : monthDates.reduce((total, date) => total + getDatePercent(date), 0) / monthDates.length;

    const workoutSuccessDays = Object.keys(allEntries).filter((date) => {
      const entry = allEntries[date];
      const workoutTasks = tasks.filter((task) => task.category === 'workout');
      const done = workoutTasks.filter((task) => Boolean(entry.workout.completed[task.id])).length;
      return workoutTasks.length > 0 && (done / workoutTasks.length) * 100 >= 80;
    }).length;

    const dietSuccessDays = Object.keys(allEntries).filter((date) => {
      const entry = allEntries[date];
      const dietTasks = tasks.filter((task) => task.category === 'diet');
      const done = dietTasks.filter((task) => Boolean(entry.diet.completed[task.id])).length;
      return dietTasks.length > 0 && (done / dietTasks.length) * 100 >= 80;
    }).length;

    const personalSuccessDays = Object.keys(allEntries).filter((date) => {
      const entry = allEntries[date];
      const personalTasks = tasks.filter((task) => task.category === 'personal');
      const done = personalTasks.filter((task) => Boolean(entry.personal.completed[task.id])).length;
      return personalTasks.length > 0 && (done / personalTasks.length) * 100 >= 80;
    }).length;

    return {
      currentStreak,
      bestStreak,
      weeklyAverage,
      monthlyAverage,
      workoutSuccessDays,
      dietSuccessDays,
      personalSuccessDays,
    };
  }, [allEntries, selectedDate, tasks]);

  const selectedSummary = useMemo(() => {
    const entry = dayEntry ?? createEmptyDayEntry(selectedDate);
    return {
      workout: {
        completed: categoryTaskMap.workout.filter((task) => Boolean(entry.workout.completed[task.id])).length,
        total: categoryTaskMap.workout.length,
        steps: safeNumber(entry.workout.steps),
        distance: safeNumber(entry.workout.distance),
        calories: safeNumber(entry.workout.caloriesBurned),
      },
      diet: {
        completed: categoryTaskMap.diet.filter((task) => Boolean(entry.diet.completed[task.id])).length,
        total: categoryTaskMap.diet.length,
        calories: safeNumber(entry.diet.caloriesConsumed),
        protein: safeNumber(entry.diet.protein),
      },
      personal: {
        completed: categoryTaskMap.personal.filter((task) => Boolean(entry.personal.completed[task.id])).length,
        total: categoryTaskMap.personal.length,
      },
    };
  }, [categoryTaskMap, dayEntry, selectedDate]);

  if (isLoading) {
    return <div className="loading-screen">Loading tracker...</div>;
  }

  const renderTaskList = (category: TaskCategory) => {
    const taskList = categoryTaskMap[category];
    const entry = dayEntry ?? createEmptyDayEntry(selectedDate);

    return (
      <section className="category-panel" key={category}>
        <div className="panel-header">
          <div className="panel-title-wrap">
            <span className={`category-icon ${category}`}>{CATEGORY_META[category].icon}</span>
            <div>
              <h3>{CATEGORY_META[category].title}</h3>
              <p>
                {taskList.filter((task) => Boolean(entry[category].completed[task.id])).length}/{taskList.length} complete
              </p>
            </div>
          </div>
          <button className="add-button" onClick={() => openAddTaskModal(category)}>+ Add</button>
        </div>

        <div className="task-list">
          {taskList.map((task) => {
            const checked = Boolean(entry[category].completed[task.id]);

            return (
              <div className="task-row" key={task.id}>
                <button
                  className={`check-toggle ${checked ? 'checked' : ''}`}
                  aria-label={`Toggle ${task.name}`}
                  onClick={() => toggleTask(category, task.id)}
                >
                  {checked ? '✓' : ''}
                </button>

                <div className="task-content">
                  <span className="task-name">{task.name}</span>
                  {task.target ? <small>{task.target}</small> : null}
                </div>

                {!task.isDefault ? (
                  <div className="task-actions">
                    <button onClick={() => openAddTaskModal(category, task)}>Edit</button>
                    <button onClick={() => handleDeleteTask(task.id)}>Delete</button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {category === 'workout' ? (
          <div className="metric-panel">
            <div className="field-group">
              <label>Total calories burned</label>
              <input
                type="number"
                value={entry.workout.caloriesBurned ?? 0}
                onChange={(event) => updateSelectedDay('workout', { caloriesBurned: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group">
              <label>Total steps</label>
              <input
                type="number"
                value={entry.workout.steps ?? 0}
                onChange={(event) => updateSelectedDay('workout', { steps: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group">
              <label>Total distance (km)</label>
              <input
                type="number"
                value={entry.workout.distance ?? 0}
                step="0.1"
                onChange={(event) => updateSelectedDay('workout', { distance: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group notes-field">
              <label>Notes</label>
              <textarea
                value={entry.workout.notes ?? ''}
                onChange={(event) => updateSelectedDay('workout', { notes: event.target.value })}
                placeholder="Workout reflection or additional notes..."
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
                value={entry.diet.caloriesConsumed ?? 0}
                onChange={(event) => updateSelectedDay('diet', { caloriesConsumed: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group">
              <label>Total protein</label>
              <input
                type="number"
                value={entry.diet.protein ?? 0}
                onChange={(event) => updateSelectedDay('diet', { protein: safeNumber(event.target.value) })}
              />
            </div>

            <div className="field-group notes-field">
              <label>Nutrition notes</label>
              <textarea
                value={entry.diet.notes ?? ''}
                onChange={(event) => updateSelectedDay('diet', { notes: event.target.value })}
                placeholder="Meals, macros, or diet notes..."
              />
            </div>
          </div>
        ) : null}

        {category === 'personal' ? (
          <div className="metric-panel">
            <div className="field-group notes-field">
              <label>Daily notes</label>
              <textarea
                value={entry.personal.notes ?? ''}
                onChange={(event) => updateSelectedDay('personal', { notes: event.target.value })}
                placeholder="Focus, reflection, or personal commitments..."
              />
            </div>
          </div>
        ) : null}
      </section>
    );
  };

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <div>
          <p className="kicker">Winter Arc</p>
          <h1>Daily Habit Tracker</h1>
        </div>

        <div className="date-controls">
          <button onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), -1)))}>← Previous</button>
          <button className="today-button" onClick={() => setSelectedDate(today)}>
            Today
          </button>
          <button onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), 1)))}>Next →</button>
        </div>
      </header>

      <main className="dashboard">
        <section className="summary-block">
          <div className="date-banner">
            <div>
              <small>{formatMonthText(selectedDate)}</small>
              <h2>
                {formatDateText(selectedDate)} {new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(parseISODate(selectedDate))}
              </h2>
            </div>
            {isSameDate(selectedDate, today) ? <span className="today-pill">Today</span> : null}
          </div>

          <div className="summary-grid">
            <div className="summary-card mega">
              <span>Daily completion</span>
              <strong>{Math.round(dailyCompletion.percent)}%</strong>
              <small>
                {dailyCompletion.done}/{dailyCompletion.total} tasks complete
              </small>
            </div>

            <div className="summary-card">
              <span>Workout</span>
              <strong>{Math.round(percent(selectedSummary.workout.completed, selectedSummary.workout.total))}%</strong>
              <small>{selectedSummary.workout.steps.toLocaleString()} steps</small>
            </div>

            <div className="summary-card">
              <span>Diet</span>
              <strong>{Math.round(percent(selectedSummary.diet.completed, selectedSummary.diet.total))}%</strong>
              <small>{selectedSummary.diet.calories} cal • {selectedSummary.diet.protein}g protein</small>
            </div>

            <div className="summary-card">
              <span>Personal</span>
              <strong>{Math.round(percent(selectedSummary.personal.completed, selectedSummary.personal.total))}%</strong>
              <small>{selectedSummary.personal.completed}/{selectedSummary.personal.total} complete</small>
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
              <span>Workout success days</span>
              <strong>{progressStats.workoutSuccessDays}</strong>
            </div>
            <div className="stat-card">
              <span>Diet success days</span>
              <strong>{progressStats.dietSuccessDays}</strong>
            </div>
            <div className="stat-card">
              <span>Personal success days</span>
              <strong>{progressStats.personalSuccessDays}</strong>
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
              <button onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), -7)))}>Previous week</button>
              <button className="today-button" onClick={() => setSelectedDate(today)}>Current week</button>
              <button onClick={() => setSelectedDate(toISODate(addDays(parseISODate(selectedDate), 7)))}>Next week</button>
            </div>
          </div>

          <div className="tracker-grid">
            <div className="tracker-header-row">
              <div className="task-label-header">Task</div>
              {weekDates.map((date) => (
                <div
                  key={date}
                  className={`day-cell ${isSameDate(date, today) ? 'today' : ''} ${isSameDate(date, selectedDate) ? 'selected' : ''}`}
                  onClick={() => setSelectedDate(date)}
                >
                  <span>{formatMonthText(date)}</span>
                  <strong>{formatDateText(date)}</strong>
                  <small>{formatWeekdayShort(date)}</small>
                </div>
              ))}
            </div>

            {(Object.keys(CATEGORY_META) as TaskCategory[]).map((category) => (
              <div className="tracker-category" key={category}>
                <div className="category-header-row">
                  <div className="category-title">{CATEGORY_META[category].title}</div>
                  {weekDates.map((date) => (
                    <div key={`${category}-${date}`} className="mini-date-pill">
                      {weekEntries[date]?.[category] ? '•' : ''}
                    </div>
                  ))}
                </div>

                {categoryTaskMap[category].map((task) => (
                  <div className="tracker-task-row" key={task.id}>
                    <div className="task-name-block">
                      <span>{task.name}</span>
                    </div>

                    {weekDates.map((date) => {
                      const dayEntryForDate = weekEntries[date] ?? createEmptyDayEntry(date);
                      const checked = Boolean(dayEntryForDate[category].completed[task.id]);

                      return (
                        <button
                          key={`${task.id}-${date}`}
                          className={`day-toggle ${checked ? 'checked' : ''} ${isSameDate(date, today) ? 'today' : ''}`}
                          onClick={() => toggleTaskInWeek(date, category, task.id)}
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

        <section className="daily-grid">
          {(Object.keys(CATEGORY_META) as TaskCategory[]).map((category) => renderTaskList(category))}
        </section>
      </main>

      {modalOpen ? (
        <div className="modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="task-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>{editingTaskId ? 'Edit task' : 'Add custom task'}</h3>
              <button className="close-button" onClick={() => setModalOpen(false)}>
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
                  placeholder="Enter task name"
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
                  placeholder="e.g. 10 minutes, 5 km, no sugar"
                />
              </label>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button className="primary-button" onClick={handleSaveTask}>
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
