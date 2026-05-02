function mapDepot(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const depotId = Number(raw.ID);
  const hoursAvailable = Number(raw.MechanicHours);
  if (!Number.isFinite(depotId) || !Number.isFinite(hoursAvailable) || hoursAvailable < 0) {
    return null;
  }
  return { ID: depotId, MechanicHours: Math.floor(hoursAvailable) };
}

function mapVehicle(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const taskId = String(raw.TaskID || "").trim();
  const durationHours = Number(raw.Duration);
  const impactScore = Number(raw.Impact);
  if (!taskId) {
    return null;
  }
  if (!Number.isFinite(durationHours) || durationHours <= 0) {
    return null;
  }
  if (!Number.isFinite(impactScore) || impactScore < 0) {
    return null;
  }
  return {
    TaskID: taskId,
    Duration: Math.floor(durationHours),
    Impact: Math.floor(impactScore),
  };
}

module.exports = { mapDepot, mapVehicle };
