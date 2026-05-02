const express = require("express");
const { startLogger, updateAuthToken, logEvent } = require("./logger");
const { loadNotifications } = require("./api");
const { pickTopNotifications } = require("./priority");

async function startApi() {
  startLogger();
  await logEvent(
    "backend",
    "info",
    "service",
    "notification api starting"
  );

  const app = express();
  app.use(express.json({ limit: "256kb" }));

  app.use((req, res, next) => {
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization
      : "";
    if (authHeader) {
      updateAuthToken(authHeader);
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

  app.get("/notifications", async (req, res) => {
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization.trim()
      : "";

    if (!authHeader) {
      await logEvent(
        "backend",
        "warn",
        "route",
        "notifications request missing authorization header"
      );
      return res.status(401).json({ error: "missing_authorization" });
    }

    updateAuthToken(authHeader);

    try {
      const notifications = await loadNotifications(authHeader);
      return res.json({ notifications });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const source = err && err.source ? err.source : "unknown";
      const status = err && Number.isFinite(err.status) ? err.status : 502;
      await logEvent(
        "backend",
        "error",
        "service",
        `notifications request failed: ${message} source ${source}`
      );
      return res.status(502).json({
        error: "notifications_failed",
        source,
        upstreamStatus: status,
        details: err && err.details ? err.details : null,
      });
    }
  });

  app.get("/notifications/priority", async (req, res) => {
    const authHeader = typeof req.headers.authorization === "string"
      ? req.headers.authorization.trim()
      : "";

    if (!authHeader) {
      await logEvent(
        "backend",
        "warn",
        "route",
        "priority notifications request missing authorization header"
      );
      return res.status(401).json({ error: "missing_authorization" });
    }

    updateAuthToken(authHeader);

    const limitRaw = typeof req.query.limit === "string"
      ? Number(req.query.limit)
      : 10;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.floor(limitRaw)) : 10;

    try {
      const notifications = await loadNotifications(authHeader);
      const topNotifications = pickTopNotifications(notifications, limit);
      await logEvent(
        "backend",
        "info",
        "service",
        `priority notifications computed count ${topNotifications.length}`
      );
      return res.json({
        count: topNotifications.length,
        notifications: topNotifications,
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const source = err && err.source ? err.source : "unknown";
      const status = err && Number.isFinite(err.status) ? err.status : 502;
      await logEvent(
        "backend",
        "error",
        "service",
        `priority notifications failed: ${message} source ${source}`
      );
      return res.status(502).json({
        error: "priority_failed",
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

  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    logEvent(
      "backend",
      "info",
      "service",
      `notification api listening on port ${port}`
    );
  });
}

startApi().catch(async (err) => {
  await logEvent(
    "backend",
    "fatal",
    "service",
    `notification api failed: ${err && err.message ? err.message : String(err)}`
  );
  process.exitCode = 1;
});
