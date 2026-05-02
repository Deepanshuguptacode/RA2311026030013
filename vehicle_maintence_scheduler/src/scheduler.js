const { logEvent } = require("./logger");

function createPlan(tasks, capacity) {
  const maxHours = Math.max(0, Math.floor(Number(capacity) || 0));
  logEvent(
    "backend",
    "debug",
    "service",
    `schedule start capacity ${maxHours} vehicles ${tasks.length}`
  );

  if (maxHours === 0 || tasks.length === 0) {
    return { tasks: [], totalImpact: 0, totalDuration: 0 };
  }

  const taskCount = tasks.length;
  const bestScores = new Array(maxHours + 1).fill(0);
  const pickMatrix = Array.from({ length: taskCount }, () => new Array(maxHours + 1).fill(false));

  for (let idx = 0; idx < taskCount; idx += 1) {
    const duration = Math.max(0, Math.floor(tasks[idx].Duration));
    const impact = Math.max(0, Math.floor(tasks[idx].Impact));
    if (duration === 0) {
      continue;
    }
    for (let hours = maxHours; hours >= duration; hours -= 1) {
      const candidate = bestScores[hours - duration] + impact;
      if (candidate > bestScores[hours]) {
        bestScores[hours] = candidate;
        pickMatrix[idx][hours] = true;
      }
    }
  }

  let remaining = maxHours;
  const chosenTasks = [];
  for (let idx = taskCount - 1; idx >= 0; idx -= 1) {
    if (pickMatrix[idx][remaining]) {
      const task = tasks[idx];
      chosenTasks.push(task);
      remaining -= Math.max(0, Math.floor(task.Duration));
    }
  }
  chosenTasks.reverse();

  const totalDuration = chosenTasks.reduce(
    (sum, task) => sum + task.Duration,
    0
  );
  const totalImpact = chosenTasks.reduce(
    (sum, task) => sum + task.Impact,
    0
  );

  logEvent(
    "backend",
    "info",
    "service",
    `schedule built duration ${totalDuration} impact ${totalImpact} tasks ${chosenTasks.length}`
  );

  return { tasks: chosenTasks, totalDuration, totalImpact };
}

module.exports = { createPlan };
