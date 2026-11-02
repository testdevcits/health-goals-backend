const taskModel = require('../models/task.model');
const walletService = require('./wallet.service');
const auditModel = require('../models/audit.model');

const processHealthRecord = async ({ userId, record, requestId }) => {
  const tasks = await taskModel.findActiveTasksByMetric(record.metricType);
  const rewards = [];

  for (const task of tasks) {
    const { newlyCompleted, taskDate } = await taskModel.updateProgress({
      userId,
      task,
      value: record.value,
      recordedAt: record.recordedAt
    });

    for (const rule of newlyCompleted) {
      const referenceId = `${task.id}:${taskDate}:${rule.targetValue}`;
      const idempotencyKey = `task_reward:${userId}:${referenceId}`;
      const { transaction, duplicate } = await walletService.addPoints({
        userId,
        amount: rule.rewardPoints,
        referenceType: 'TASK',
        referenceId,
        description: `${task.name} - ${rule.targetValue} ${rule.unit}`,
        idempotencyKey,
        type: task.frequency === 'WEEKLY' ? 'BONUS' : 'EARN'
      });

      if (!duplicate) {
        await auditModel.createAuditLog({
          userId,
          action: task.frequency === 'WEEKLY' ? 'REWARD_EARNED' : 'TASK_COMPLETED',
          metadata: {
            taskId: task.id,
            targetValue: rule.targetValue,
            rewardPoints: rule.rewardPoints
          },
          requestId
        });
      }

      rewards.push({ taskId: task.id, rule, transaction, duplicate });
    }
  }

  return rewards;
};

module.exports = {
  processHealthRecord
};
