const { Log, setLogConfig } = require("../../logging_middleware");

let loggerReady = false;

function startLogger() {
  if (loggerReady) {
    return;
  }
  loggerReady = true;
}

function updateAuthToken(authToken) {
  if (typeof authToken !== "string") {
    return;
  }
  const trimmed = authToken.trim();
  if (!trimmed) {
    return;
  }
  setLogConfig({ authToken: trimmed });
}

async function logEvent(stack, level, area, message) {
  try {
    await Log(stack, level, area, message);
  } catch (err) {
    return;
  }
}

module.exports = { startLogger, updateAuthToken, logEvent };
