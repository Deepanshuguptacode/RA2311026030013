const { safeLog } = require("./logger");

function buildSchedule(vehicles, capacity) {
  const cap = Math.max(0, Math.floor(Number(capacity) || 0));
  safeLog(
    "backend",
    "debug",
    "service",
    `schedule start capacity ${cap} vehicles ${vehicles.length}`
  );

  if (cap === 0 || vehicles.length === 0) {
    return { tasks: [], totalImpact: 0, totalDuration: 0 };
  }

  const n = vehicles.length;
  const dp = new Array(cap + 1).fill(0);
  const keep = Array.from({ length: n }, () => new Array(cap + 1).fill(false));

  for (let i = 0; i < n; i += 1) {
    const duration = Math.max(0, Math.floor(vehicles[i].Duration));
    const impact = Math.max(0, Math.floor(vehicles[i].Impact));
    if (duration === 0) {
      continue;
    }
    for (let w = cap; w >= duration; w -= 1) {
      const candidate = dp[w - duration] + impact;
      if (candidate > dp[w]) {
        dp[w] = candidate;
        keep[i][w] = true;
      }
    }
  }

  let w = cap;
  const selected = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    if (keep[i][w]) {
      const vehicle = vehicles[i];
      selected.push(vehicle);
      w -= Math.max(0, Math.floor(vehicle.Duration));
    }
  }
  selected.reverse();

  const totalDuration = selected.reduce(
    (sum, vehicle) => sum + vehicle.Duration,
    0
  );
  const totalImpact = selected.reduce(
    (sum, vehicle) => sum + vehicle.Impact,
    0
  );

  safeLog(
    "backend",
    "info",
    "service",
    `schedule built duration ${totalDuration} impact ${totalImpact} tasks ${selected.length}`
  );

  return { tasks: selected, totalDuration, totalImpact };
}

module.exports = { buildSchedule };
