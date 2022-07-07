const { PushType } = require('../shared/remote-run');
const { axiosInstance } = require('./httpClient');
const config = require('./config');

const log = console;

const { maxRetryCount, retryInterval, pushDestination } = config.jobRunner.messagePush;
const { trustedIPOrName, trustedAuthPort } = config.ivisCore;
const MILIS_RETRY_TIME = retryInterval * 1000;
function getIVIScoreUrl(path) {
  const PUSH_URL_BASE = `https://${trustedIPOrName}:${trustedAuthPort}${pushDestination}/`;
  return `${PUSH_URL_BASE}${path}`;
}

function postponePromise(time) {
  // eslint-disable-next-line no-unused-vars
  return new Promise((resolve, _reject) => {
    setTimeout(resolve, time);
  });
}

/**
 * pushes a message with retry attempts according to the configuration
 * @param {*} url the destination
 * @param {*} requestBody the push endpoint request body
 * @param {*} attemptNumber the number of the current attempt
 */
async function pushAttemptLoop(url, requestBody, attemptNumber = 1) {
  if (maxRetryCount + 1 < attemptNumber) {
    log.error(`All ${maxRetryCount + 1} attempts have failed to push a message to IVIS-core!`);
    log.debug(`Message URL: ${url}`);
    log.debug(`Message Body: ${requestBody}`);
    return;
  }
  axiosInstance.post(url, requestBody)
    .then(async ({ data, status }) => {
      if (status === 400) { // BAD REQUEST
        log.error(`Bad request when pushing a message: ${data}`);
        log.debug(`Message URL: ${url}`);
        log.debug(`Message Body: ${requestBody}`);
      } else if (status !== 200) {
        await postponePromise(MILIS_RETRY_TIME);
        await pushAttemptLoop(url, requestBody, attemptNumber + 1);
      }
    })
    .catch(async (err) => {
      log.error(`An Error was encountered when pushing a message: ${err.toString()}`);
      await postponePromise(MILIS_RETRY_TIME);
      await pushAttemptLoop(url, requestBody, attemptNumber + 1);
    });
}

/**
 * pushes a status update to the IVIS-core instance
 * @param {*} runId  the id of the run whose information will be pushed
 * @param {*} status run status
 * @param {*} sequenceNumber ordering safeguard, ascending
 * @param {*} warns  warnings, not mandatory
 * @param {*} errors errors, not mandatory
 */
async function runStatusUpdate(
  runId,
  status,
  sequenceNumber,
  warns = undefined,
  errors = undefined,
) {
  const requestBody = {
    type: PushType.STATE_UPDATE, sequenceNumber, runId, status, warns, errors,
  };
  await pushAttemptLoop(getIVIScoreUrl('status'), requestBody);
}
// taken from ivis implementation
// hopefully will make the communication more cooperative
const EventTypes = {
  RUN_OUTPUT: 'output',
  INIT: 'init',
  STOP: 'stop',
  FAIL: 'fail',
  SUCCESS: 'success',
  ACCESS_TOKEN: 'access_token',
  ACCESS_TOKEN_REFRESH: 'access_token_refresh',
};

function getOutputEventType(runId) {
  return `run/${runId}/${EventTypes.RUN_OUTPUT}`;
}

function getStopEventType(runId) {
  return `run/${runId}/${EventTypes.STOP}`;
}

function getFailEventType(runId) {
  return `run/${runId}/${EventTypes.FAIL}`;
}

function getSuccessEventType(runId) {
  return `run/${runId}/${EventTypes.SUCCESS}`;
}

async function emitRemote(eventType, data) {
  const requestBody = {
    type: PushType.EMIT,
    payload:
        {
          type: eventType,
          data,
        },
  };
  await pushAttemptLoop(getIVIScoreUrl('emit'), requestBody);
}

module.exports = {
  runStatusUpdate,
  emitRemote,
  getStopEventType,
  getOutputEventType,
  getFailEventType,
  getSuccessEventType,
  EventTypes,
};
