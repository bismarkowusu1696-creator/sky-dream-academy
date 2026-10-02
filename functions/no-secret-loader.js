// Production loader for deployments where SMS/Twilio is intentionally disabled.
// Some legacy modules still declare Twilio secrets while they are imported.
// Firebase inspects those declarations during deployment even though the no-SMS
// entrypoint overrides the SMS handlers. This loader removes secret bindings
// before loading the application so Secret Manager is not required at all.

const https = require('firebase-functions/v2/https');
const params = require('firebase-functions/params');

const realOnCall = https.onCall;

function onCallWithoutSecrets(optionsOrHandler, maybeHandler) {
  if (typeof optionsOrHandler === 'function') {
    return realOnCall(optionsOrHandler);
  }

  const options = { ...(optionsOrHandler || {}) };
  delete options.secrets;
  return realOnCall(options, maybeHandler);
}

// CommonJS exports are normally writable, but define them explicitly so the
// override also works if the package exposes them through accessors.
try {
  Object.defineProperty(https, 'onCall', {
    value: onCallWithoutSecrets,
    writable: true,
    configurable: true
  });
} catch (_) {
  https.onCall = onCallWithoutSecrets;
}

const disabledSecret = name => ({
  name,
  value() {
    throw new Error(`Secret ${name} is disabled because SMS is not configured.`);
  }
});

try {
  Object.defineProperty(params, 'defineSecret', {
    value: disabledSecret,
    writable: true,
    configurable: true
  });
} catch (_) {
  params.defineSecret = disabledSecret;
}

module.exports = require('./no-sms-index');
