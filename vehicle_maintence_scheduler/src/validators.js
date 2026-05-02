function normalizeDepot(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const id = Number(raw.ID);
  const hours = Number(raw.MechanicHours);
  if (!Number.isFinite(id) || !Number.isFinite(hours) || hours < 0) {
    return null;
  }
  return { ID: id, MechanicHours: Math.floor(hours) };
}

function normalizeVehicle(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const taskId = String(raw.TaskID || "").trim();
  const duration = Number(raw.Duration);
  const impact = Number(raw.Impact);
  if (!taskId) {
    return null;
  }
  if (!Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  if (!Number.isFinite(impact) || impact < 0) {
    return null;
  }
  return {
    TaskID: taskId,
    Duration: Math.floor(duration),
    Impact: Math.floor(impact),
  };
}

module.exports = { normalizeDepot, normalizeVehicle };
