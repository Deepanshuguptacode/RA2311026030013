const http = require("http");
const https = require("https");
const { URL } = require("url");
const { safeLog } = require("./logger");
const { normalizeDepot, normalizeVehicle } = require("./validators");

const BASE_URL = "http://20.207.122.201/evaluation-service";
const REQUEST_TIMEOUT_MS = 8000;

function normalizeAuthHeader(authHeader) {
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
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
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
      ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
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

function buildHeaders(authHeader) {
  const headers = { Accept: "application/json" };
  const normalized = normalizeAuthHeader(authHeader);
  if (normalized) {
    headers.Authorization = normalized;
  }
  return headers;
}

async function fetchDepots(authHeader) {
  await safeLog("backend", "info", "repository", "fetching depots");
  const result = await requestJson(`${BASE_URL}/depots`, {
    method: "GET",
    headers: buildHeaders(authHeader),
  });

  if (!result.ok) {
    const error = new Error("depots_fetch_failed");
    error.status = result.status;
    error.source = "depots";
    error.details = result.data || result.raw || null;
    await safeLog(
      "backend",
      "error",
      "repository",
      `depots fetch failed status ${result.status}`
    );
    throw error;
  }

  const depotsRaw = result.data && Array.isArray(result.data.depots)
    ? result.data.depots
    : [];
  const depots = depotsRaw.map(normalizeDepot).filter(Boolean);
  const invalidCount = depotsRaw.length - depots.length;

  if (invalidCount > 0) {
    await safeLog(
      "backend",
      "warn",
      "repository",
      `depots normalized with ${invalidCount} invalid entries`
    );
  }

  await safeLog(
    "backend",
    "info",
    "repository",
    `depots fetched count ${depots.length}`
  );
  return depots;
}

async function fetchVehicles(authHeader) {
  await safeLog("backend", "info", "repository", "fetching vehicles");
  const result = await requestJson(`${BASE_URL}/vehicles`, {
    method: "GET",
    headers: buildHeaders(authHeader),
  });

  if (!result.ok) {
    const error = new Error("vehicles_fetch_failed");
    error.status = result.status;
    error.source = "vehicles";
    error.details = result.data || result.raw || null;
    await safeLog(
      "backend",
      "error",
      "repository",
      `vehicles fetch failed status ${result.status}`
    );
    throw error;
  }

  const vehiclesRaw = result.data && Array.isArray(result.data.vehicles)
    ? result.data.vehicles
    : [];
  const vehicles = vehiclesRaw.map(normalizeVehicle).filter(Boolean);
  const invalidCount = vehiclesRaw.length - vehicles.length;

  if (invalidCount > 0) {
    await safeLog(
      "backend",
      "warn",
      "repository",
      `vehicles normalized with ${invalidCount} invalid entries`
    );
  }

  await safeLog(
    "backend",
    "info",
    "repository",
    `vehicles fetched count ${vehicles.length}`
  );
  return vehicles;
}

module.exports = { fetchDepots, fetchVehicles };
