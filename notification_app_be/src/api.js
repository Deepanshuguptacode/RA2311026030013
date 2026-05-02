const http = require("http");
const https = require("https");
const { URL } = require("url");
const { logEvent } = require("./logger");

const SERVICE_ROOT = "http://20.207.122.201/evaluation-service";
const REQUEST_TIMEOUT = 8000;

function normalizeBearer(authHeader) {
  if (typeof authHeader !== "string") {
    return "";
  }
  const trimmed = authHeader.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.toLowerCase().startsWith("bearer ")) {
    return trimmed;
  }
  return `Bearer ${trimmed}`;
}

function parseJsonSafely(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function requestJsonWithNode(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const requestOptions = {
      method: options.method || "GET",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: options.headers || {},
    };

    const req = transport.request(requestOptions, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const data = parseJsonSafely(body);
        const status = res.statusCode || 0;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          data,
          raw: body,
        });
      });
    });

    req.on("error", (err) => reject(err));
    req.setTimeout(REQUEST_TIMEOUT, () => {
      req.destroy(new Error("request_timeout"));
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

async function requestJson(url, options) {
  if (typeof fetch === "function") {
    const controller =
      typeof AbortController === "function" ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
      : null;
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller ? controller.signal : undefined,
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        data: parseJsonSafely(text),
        raw: text,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return requestJsonWithNode(url, options);
}

function makeHeaders(authHeader) {
  const headers = { Accept: "application/json" };
  const normalized = normalizeBearer(authHeader);
  if (normalized) {
    headers.Authorization = normalized;
  }
  return headers;
}

async function loadNotifications(authHeader) {
  await logEvent("backend", "info", "repository", "fetching notifications");
  const result = await requestJson(`${SERVICE_ROOT}/notifications`, {
    method: "GET",
    headers: makeHeaders(authHeader),
  });

  if (!result.ok) {
    const error = new Error("notifications_fetch_failed");
    error.status = result.status;
    error.source = "notifications";
    error.details = result.data || result.raw || null;
    await logEvent(
      "backend",
      "error",
      "repository",
      `notifications fetch failed status ${result.status}`
    );
    throw error;
  }

  const items = result.data && Array.isArray(result.data.notifications)
    ? result.data.notifications
    : [];

  await logEvent(
    "backend",
    "info",
    "repository",
    `notifications fetched count ${items.length}`
  );

  return items;
}

module.exports = { loadNotifications };
