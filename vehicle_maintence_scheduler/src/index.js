const express = require("express");
const { startLogger, logEvent, updateAuthToken } = require("./logger");
const { FALLBACK_AUTH_TOKEN } = require("../../logging_middleware");
const { loadDepots, loadVehicles } = require("./api");
const { createPlan } = require("./scheduler");

async function compileSchedules(depotId, authHeader) {
  const depotList = await loadDepots(authHeader);
  const taskList = await loadVehicles(authHeader);

  const targetDepots = Number.isFinite(depotId)
    ? depotList.filter((depot) => depot.ID === depotId)
    : depotList;

  const schedules = [];
  for (const depot of targetDepots) {
    const plan = createPlan(taskList, depot.MechanicHours);
    schedules.push({
      depotId: depot.ID,
      mechanicHours: depot.MechanicHours,
      totalImpact: plan.totalImpact,
      totalDuration: plan.totalDuration,
      tasks: plan.tasks,
    });

    await logEvent(
      "backend",
      "info",
      "service",
      `depot ${depot.ID} scheduled ${plan.tasks.length} tasks impact ${plan.totalImpact}`
    );
  }

  return {
    generatedAt: new Date().toISOString(),
    schedules,
  };
}

async function startApi() {
  startLogger();
  await logEvent(
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
    const effectiveAuth = authHeader || FALLBACK_AUTH_TOKEN;
    if (effectiveAuth) {
      updateAuthToken(effectiveAuth);
    }
    const startedAt = Date.now();
    res.on("finish", () => {
      const durationMs = Date.now() - startedAt;
      logEvent(
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
    const effectiveAuth = authHeader || FALLBACK_AUTH_TOKEN;
    if (effectiveAuth) {
      updateAuthToken(effectiveAuth);
    }

    const depotIdRaw = typeof req.query.depotId === "string"
      ? Number(req.query.depotId)
      : Number.NaN;

    if (req.query.depotId && !Number.isFinite(depotIdRaw)) {
      await logEvent(
        "backend",
        "warn",
        "route",
        "schedule request invalid depotId"
      );
      return res.status(400).json({ error: "invalid_depot_id" });
    }

    await logEvent(
      "backend",
      "info",
      "route",
      "schedule request received"
    );

    try {
      const payload = await compileSchedules(depotIdRaw, effectiveAuth);
      return res.json(payload);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const source = err && err.source ? err.source : "unknown";
      const status = err && Number.isFinite(err.status) ? err.status : 502;
      await logEvent(
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
    logEvent("backend", "error", "middleware", `unhandled error: ${message}`);
    res.status(500).json({ error: "internal_error" });
  });

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    logEvent(
      "backend",
      "info",
      "service",
      `vehicle maintenance scheduler api listening on port ${port}`
    );
  });
}

startApi().catch(async (err) => {
  await logEvent(
    "backend",
    "fatal",
    "service",
    `scheduler api failed: ${err && err.message ? err.message : String(err)}`
  );
  process.exitCode = 1;
});
