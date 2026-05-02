const { Log, configureLogging } = require("../../logging_middleware");

let initialized = false;

function initLogger() {
  if (initialized) {
    return;
  }
  initialized = true;
}

function setAuthToken(authToken) {
  if (typeof authToken !== "string") {
    return;
  }
  const trimmed = authToken.trim();
  if (!trimmed) {
    return;
  }
  configureLogging({ authToken: trimmed });
}

async function safeLog(stack, level, pkg, message) {
  try {
    await Log(stack, level, pkg, message);
  } catch (err) {
    return;
  }
}

module.exports = { initLogger, safeLog, setAuthToken };
