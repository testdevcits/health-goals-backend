const mongoose = require('mongoose');
const env = require('../config/env');
const crypto = require('crypto');

const taskSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    metricType: { type: String, required: true, index: true },
    frequency: { type: String, enum: ['DAILY', 'WEEKLY', 'ONE_TIME'], default: 'DAILY' },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    status: { type: String, enum: ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'EXPIRED'], default: 'ACTIVE' },
    rules: [
      {
        targetValue: { type: Number, required: true },
        unit: { type: String, required: true },
        rewardPoints: { type: Number, required: true },
        priority: { type: Number, default: 1 }
      }
    ]
  },
  { timestamps: true }
);

const progressSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    taskDate: { type: String, required: true },
    currentValue: { type: Number, default: 0 },
    awardedTargets: [{ type: Number }],
    status: { type: String, enum: ['IN_PROGRESS', 'COMPLETED', 'EXPIRED'], default: 'IN_PROGRESS' },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

progressSchema.index({ userId: 1, taskId: 1, taskDate: 1 }, { unique: true });

const Task = mongoose.model('Task', taskSchema);
const UserTaskProgress = mongoose.model('UserTaskProgress', progressSchema);
const tasks = [];
const progressRows = [];

const seedDefaultTasks = () => {
  if (tasks.length > 0) return;
  const now = new Date().toISOString();
  tasks.push(
    {
      id: crypto.randomUUID(),
      name: 'Daily Running',
      description: 'Earn points for running distance.',
      metric_type: 'running',
      frequency: 'DAILY',
      status: 'ACTIVE',
      rules: [
        { target_value: 1, unit: 'km', reward_points: 10, priority: 1 },
        { target_value: 3, unit: 'km', reward_points: 20, priority: 2 },
        { target_value: 5, unit: 'km', reward_points: 40, priority: 3 }
      ],
      created_at: now,
      updated_at: now
    },
    {
      id: crypto.randomUUID(),
      name: 'Weekly Distance',
      description: 'Earn a weekly bonus for total distance.',
      metric_type: 'distance',
      frequency: 'WEEKLY',
      status: 'ACTIVE',
      rules: [{ target_value: 20, unit: 'km', reward_points: 100, priority: 1 }],
      created_at: now,
      updated_at: now
    }
  );
};

const normalizeTask = (task) => ({
  id: task.id || task._id.toString(),
  name: task.name,
  description: task.description,
  metricType: task.metricType || task.metric_type,
  frequency: task.frequency,
  status: task.status,
  rules: (task.rules || []).map((rule) => ({
    id: rule.id || rule._id?.toString(),
    targetValue: rule.targetValue ?? rule.target_value,
    unit: rule.unit,
    rewardPoints: rule.rewardPoints ?? rule.reward_points,
    priority: rule.priority
  }))
});

const findActiveTasksByMetric = async (metricType) => {
  if (!env.useMongoDB) {
    seedDefaultTasks();
    return tasks
      .filter((task) => task.metric_type === metricType && task.status === 'ACTIVE')
      .map(normalizeTask);
  }

  const rows = await Task.find({ metricType, status: 'ACTIVE' });
  return rows.map(normalizeTask);
};

const getPeriodKey = (date, frequency) => {
  const parsed = new Date(date);
  if (frequency === 'WEEKLY') {
    const day = parsed.getUTCDay() || 7;
    parsed.setUTCDate(parsed.getUTCDate() - day + 1);
  }
  return parsed.toISOString().slice(0, 10);
};

const updateProgress = async ({ userId, task, value, recordedAt }) => {
  const taskDate = getPeriodKey(recordedAt, task.frequency);

  if (!env.useMongoDB) {
    let progress = progressRows.find(
      (row) => row.user_id === userId && row.task_id === task.id && row.task_date === taskDate
    );
    if (!progress) {
      progress = {
        id: crypto.randomUUID(),
        user_id: userId,
        task_id: task.id,
        task_date: taskDate,
        current_value: 0,
        awarded_targets: [],
        status: 'IN_PROGRESS',
        completed_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      progressRows.push(progress);
    }

    progress.current_value += value;
    progress.updated_at = new Date().toISOString();

    const newlyCompleted = task.rules.filter(
      (rule) =>
        progress.current_value >= rule.targetValue &&
        !progress.awarded_targets.includes(rule.targetValue)
    );

    newlyCompleted.forEach((rule) => progress.awarded_targets.push(rule.targetValue));
    if (newlyCompleted.length > 0) {
      progress.status = 'COMPLETED';
      progress.completed_at = new Date().toISOString();
    }

    return { progress, newlyCompleted, taskDate };
  }

  const progress = await UserTaskProgress.findOneAndUpdate(
    { userId, taskId: task.id, taskDate },
    { $setOnInsert: { userId, taskId: task.id, taskDate } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  progress.currentValue += value;
  const newlyCompleted = task.rules.filter(
    (rule) =>
      progress.currentValue >= rule.targetValue &&
      !progress.awardedTargets.includes(rule.targetValue)
  );

  newlyCompleted.forEach((rule) => progress.awardedTargets.push(rule.targetValue));
  if (newlyCompleted.length > 0) {
    progress.status = 'COMPLETED';
    progress.completedAt = new Date();
  }
  await progress.save();

  return { progress, newlyCompleted, taskDate };
};

module.exports = {
  Task,
  UserTaskProgress,
  findActiveTasksByMetric,
  updateProgress
};
