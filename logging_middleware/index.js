const http = require("http");
const https = require("https");
const { URL } = require("url");

const DEFAULT_BASE_URL = "http://20.207.122.201/evaluation-service";
const ALLOWED_STACKS = new Set(["backend"]);
const ALLOWED_LEVELS = new Set(["debug", "info", "warn", "error", "fatal"]);

const BACKEND_PACKAGES = new Set([
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

const SHARED_PACKAGES = new Set(["auth", "config", "middleware", "utils"]);

const DEFAULT_AUTH_TOKEN = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJNYXBDbGFpbXMiOnsiYXVkIjoiaHR0cDovLzIwLjI0NC41Ni4xNDQvZXZhbHVhdGlvbi1zZXJ2aWNlIiwiZW1haWwiOiJkZzM4NDVAc3JtaXN0LmVkdS5pbiIsImV4cCI6MTc3NzY5OTAxNSwiaWF0IjoxNzc3Njk4MTE1LCJpc3MiOiJBZmZvcmQgTWVkaWNhbCBUZWNobm9sb2dpZXMgUHJpdmF0ZSBMaW1pdGVkIiwianRpIjoiMmRmYWMzZTYtOWFmMy00NjhmLTliMDQtZjgyYThlYmY1N2M2IiwibG9jYWxlIjoiZW4tSU4iLCJuYW1lIjoiZGVlcGFuc2h1IGd1cHRhIiwic3ViIjoiYWY0NzRkZjItNGFkYi00ZmNjLWJkY2QtMmZmNzY4NzljNzdmIn0sImVtYWlsIjoiZGczODQ1QHNybWlzdC5lZHUuaW4iLCJuYW1lIjoiZGVlcGFuc2h1IGd1cHRhIiwicm9sbE5vIjoicmEyMzExMDI2MDMwMDEzIiwiYWNjZXNzQ29kZSI6IlFrYnB4SCIsImNsaWVudElEIjoiYWY0NzRkZjItNGFkYi00ZmNjLWJkY2QtMmZmNzY4NzljNzdmIiwiY2xpZW50U2VjcmV0IjoiZnJBVG1zWVpxWVNrdGJtWCJ9.2ZBa-af8s-POju8rdUDL7LegcepTRBVAVMfD69jrUzk";

const config = {
  baseUrl: DEFAULT_BASE_URL,
  timeoutMs: 8000,
  authToken: DEFAULT_AUTH_TOKEN,
};

function configureLogging(options = {}) {
  if (options.baseUrl && typeof options.baseUrl === "string") {
    config.baseUrl = options.baseUrl;
  }
  if (Number.isInteger(options.timeoutMs) && options.timeoutMs > 0) {
    config.timeoutMs = options.timeoutMs;
  }
  if (typeof options.authToken === "string") {
    config.authToken = options.authToken;
  }
}

function normalizeValue(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function isPackageAllowed(stack, packageName) {
  if (SHARED_PACKAGES.has(packageName)) {
    return true;
  }
  if (stack === "backend") {
    return BACKEND_PACKAGES.has(packageName);
  }
  return false;
}

function getAuthHeader() {
  const token = typeof config.authToken === "string" ? config.authToken.trim() : "";
  if (!token) {
    return "";
  }
  if (token.toLowerCase().startsWith("bearer ")) {
    return token;
  }
  return `Bearer ${token}`;
}

function safeJsonParse(text) {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    return null;
  }
}

function requestJsonWithHttp(url, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const requestOptions = {
      method: options.method || "GET",
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: options.headers || {},
    };

    const req = lib.request(requestOptions, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        const data = safeJsonParse(body);
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
    req.setTimeout(config.timeoutMs, () => {
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
      ? setTimeout(() => controller.abort(), config.timeoutMs)
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
        data: safeJsonParse(text),
        raw: text,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  return requestJsonWithHttp(url, options);
}

async function Log(stack, level, packageName, message) {
  const normalizedStack = normalizeValue(stack);
  const normalizedLevel = normalizeValue(level);
  const normalizedPackage = normalizeValue(packageName);

  let normalizedMessage = "";
  if (typeof message === "string") {
    normalizedMessage = message;
  } else {
    try {
      normalizedMessage = JSON.stringify(message);
    } catch (err) {
      normalizedMessage = String(message);
    }
  }

  if (!ALLOWED_STACKS.has(normalizedStack)) {
    return { ok: false, error: "invalid_stack" };
  }
  if (!ALLOWED_LEVELS.has(normalizedLevel)) {
    return { ok: false, error: "invalid_level" };
  }
  if (!isPackageAllowed(normalizedStack, normalizedPackage)) {
    return { ok: false, error: "invalid_package" };
  }
  if (!normalizedMessage) {
    return { ok: false, error: "invalid_message" };
  }

  const headers = { "Content-Type": "application/json" };
  const authHeader = getAuthHeader();
  if (authHeader) {
    headers.Authorization = authHeader;
  }

  const payload = JSON.stringify({
    stack: normalizedStack,
    level: normalizedLevel,
    package: normalizedPackage,
    message: normalizedMessage,
  });

  try {
    const result = await requestJson(`${config.baseUrl}/logs`, {
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
  configureLogging,
  DEFAULT_BASE_URL,
  DEFAULT_AUTH_TOKEN,
  ALLOWED_STACKS,
  ALLOWED_LEVELS,
  BACKEND_PACKAGES,
  SHARED_PACKAGES,
};
