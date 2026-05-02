const http = require("http");
const https = require("https");
const { URL } = require("url");

const LOG_SERVICE_URL = "http://20.207.122.201/evaluation-service";
const STACK_ALLOWLIST = new Set(["backend"]);
const LEVEL_ALLOWLIST = new Set(["debug", "info", "warn", "error", "fatal"]);

const BACKEND_PACKAGE_SET = new Set([
  "cache",
  "controller",
  "cron_job",
  "db",
  "domain",
  "handler",
  "repository",
  "route",
  "service",
]);

const SHARED_PACKAGE_SET = new Set(["auth", "config", "middleware", "utils"]);

const FALLBACK_AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJkZzM4NDVAc3JtaXN0LmVkdS5pbiIsImV4cCI6MTc3NzY5OTAxNSwiaWF0IjoxNzc3Njk4MTE1LCJpc3MiOiJBZmZvcmQgTWVkaWNhbCBUZWNobm9sb2dpZXMgUHJpdmF0ZSBMaW1pdGVkIiwianRpIjoiMmRmYWMzZTYtOWFmMy00NjhmLTliMDQtZjgyYThlYmY1N2M2IiwibG9jYWxlIjoiZW4tSU4iLCJuYW1lIjoiZGVlcGFuc2h1IGd1cHRhIiwic3ViIjoiYWY0NzRkZjItNGFkYi00ZmNjLWJkY2QtMmZmNzY4NzljNzdmIn0sImVtYWlsIjoiZGczODQ1QHNybWlzdC5lZHUuaW4iLCJuYW1lIjoiZGVlcGFuc2h1IGd1cHRhIiwicm9sbE5vIjoicmEyMzExMDI2MDMwMDEzIiwiYWNjZXNzQ29kZSI6IlFrYnB4SCIsImNsaWVudElEIjoiYWY0NzRkZjItNGFkYi00ZmNjLWJkY2QtMmZmNzY4NzljNzdmIiwiY2xpZW50U2VjcmV0IjoiZnJBVG1zWVpxWVNrdGJtWCJ9.2ZBa-af8s-POju8rdUDL7LegcepTRBVAVMfD69jrUzk";

const runtimeConfig = {
  baseUrl: LOG_SERVICE_URL,
  timeoutMs: 8000,
  authToken: FALLBACK_AUTH_TOKEN,
};

function setLogConfig(options = {}) {
  if (options.baseUrl && typeof options.baseUrl === "string") {
    runtimeConfig.baseUrl = options.baseUrl;
  }
  if (Number.isInteger(options.timeoutMs) && options.timeoutMs > 0) {
    runtimeConfig.timeoutMs = options.timeoutMs;
  }
  if (typeof options.authToken === "string") {
    runtimeConfig.authToken = options.authToken;
  }
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function isAllowedPackage(stackName, packageName) {
  if (SHARED_PACKAGE_SET.has(packageName)) {
    return true;
  }
  if (stackName === "backend") {
    return BACKEND_PACKAGE_SET.has(packageName);
  }
  return false;
}

function buildAuthHeader() {
  const token =
    typeof runtimeConfig.authToken === "string"
      ? runtimeConfig.authToken.trim()
      : "";
  if (!token) {
    return "";
  }
  if (token.toLowerCase().startsWith("bearer ")) {
    return token;
  }
  return `Bearer ${token}`;
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
    req.setTimeout(runtimeConfig.timeoutMs, () => {
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
      ? setTimeout(() => controller.abort(), runtimeConfig.timeoutMs)
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

async function Log(stack, level, packageName, message) {
  const stackName = normalizeText(stack);
  const levelName = normalizeText(level);
  const packageKey = normalizeText(packageName);

  let payloadMessage = "";
  if (typeof message === "string") {
    payloadMessage = message;
  } else {
    try {
      payloadMessage = JSON.stringify(message);
    } catch (err) {
      payloadMessage = String(message);
    }
  }

  if (!STACK_ALLOWLIST.has(stackName)) {
    return { ok: false, error: "invalid_stack" };
  }
  if (!LEVEL_ALLOWLIST.has(levelName)) {
    return { ok: false, error: "invalid_level" };
  }
  if (!isAllowedPackage(stackName, packageKey)) {
    return { ok: false, error: "invalid_package" };
  }
  if (!payloadMessage) {
    return { ok: false, error: "invalid_message" };
  }

  const headers = { "Content-Type": "application/json" };
  const authHeader = buildAuthHeader();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const payload = JSON.stringify({
    stack: stackName,
    level: levelName,
    package: packageKey,
    message: payloadMessage,
  });

  try {
    const result = await requestJson(`${runtimeConfig.baseUrl}/logs`, {
      method: "POST",
      headers,
      body: payload,
    });

    if (!result.ok) {
      return {
        ok: false,
        status: result.status,
        error: result.data || result.raw || "log_request_failed",
      };
    }

    const logId = result.data && result.data.logID ? result.data.logID : "";
    const responseMessage =
      result.data && result.data.message ? result.data.message : "log created";

    return { ok: true, logId, message: responseMessage };
  } catch (err) {
    const errorMessage = err && err.message ? err.message : "log_request_failed";
    return { ok: false, status: 0, error: errorMessage };
  }
}

module.exports = {
  Log,
  setLogConfig,
  LOG_SERVICE_URL,
  FALLBACK_AUTH_TOKEN,
  STACK_ALLOWLIST,
  LEVEL_ALLOWLIST,
  BACKEND_PACKAGE_SET,
  SHARED_PACKAGE_SET,
};
