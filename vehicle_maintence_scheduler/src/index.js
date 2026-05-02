const express = require("express");
const { initLogger, safeLog, setAuthToken } = require("./logger");
const { DEFAULT_AUTH_TOKEN } = require("../../logging_middleware");
const { fetchDepots, fetchVehicles } = require("./api");
const { buildSchedule } = require("./scheduler");

async function buildSchedules(depotId, authHeader) {
  const depots = await fetchDepots(authHeader);
  const vehicles = await fetchVehicles(authHeader);

  const selectedDepots = Number.isFinite(depotId)
    ? depots.filter((depot) => depot.ID === depotId)
    : depots;

  const schedules = [];
  for (const depot of selectedDepots) {
    const schedule = buildSchedule(vehicles, depot.MechanicHours);
    schedules.push({
      depotId: depot.ID,
      mechanicHours: depot.MechanicHours,
      totalImpact: schedule.totalImpact,
      totalDuration: schedule.totalDuration,
      tasks: schedule.tasks,
    });

    await safeLog(
      "backend",
      "info",
      "service",
      `depot ${depot.ID} scheduled ${schedule.tasks.length} tasks impact ${schedule.totalImpact}`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    schedules,
  };
}

async function startServer() {
  initLogger();
  await safeLog(
    "backend",
    "info",
    "service",
    "vehicle maintenance scheduler api starting"
  );

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.use((req, res, next) => {
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
    const effectiveAuth = authHeader || DEFAULT_AUTH_TOKEN;
    if (effectiveAuth) {
      setAuthToken(effectiveAuth);
    }
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      safeLog(
        "backend",
        "info",
        "route",
        `request ${req.method} ${req.originalUrl} status ${res.statusCode} duration_ms ${durationMs}`
      );
    });
    next();
  });

  app.get("/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/schedule", async (req, res) => {
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization.trim()
      : "";
    const effectiveAuth = authHeader || DEFAULT_AUTH_TOKEN;
    if (effectiveAuth) {
      setAuthToken(effectiveAuth);
    }

    const depotIdRaw = typeof req.query.depotId === "string"
      ? Number(req.query.depotId)
      : Number.NaN;

    if (req.query.depotId && !Number.isFinite(depotIdRaw)) {
      await safeLog(
        "backend",
        "warn",
        "route",
        "schedule request invalid depotId"
      );
      return res.status(400).json({ error: "invalid_depot_id" });
    }

    await safeLog(
      "backend",
      "info",
      "route",
      "schedule request received"
    );

    try {
      const payload = await buildSchedules(depotIdRaw, effectiveAuth);
      return res.json(payload);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const source = err && err.source ? err.source : "unknown";
      const status = err && Number.isFinite(err.status) ? err.status : 502;
      await safeLog(
        "backend",
        "error",
        "service",
        `schedule request failed: ${message} source ${source}`
      );
      return res.status(502).json({
        error: "schedule_failed",
        source,
        upstreamStatus: status,
        details: err && err.details ? err.details : null,
      });
    }
  });

  app.use((err, req, res, next) => {
    const message = err && err.message ? err.message : String(err);
    safeLog("backend", "error", "middleware", `unhandled error: ${message}`);
    res.status(500).json({ error: "internal_error" });
  });

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    safeLog(
      "backend",
      "info",
      "service",
      `vehicle maintenance scheduler api listening on port ${port}`
    );
  });
}

startServer().catch(async (err) => {
  await safeLog(
    "backend",
    "fatal",
    "service",
    `scheduler api failed: ${err && err.message ? err.message : String(err)}`
  );
  process.exitCode = 1;
});
