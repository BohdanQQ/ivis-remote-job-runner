const { inspect } = require('node:util');
const { RequestType, EventTypes } = require('../shared/remote-run');
const { axiosInstance } = require('./httpClient');
const config = require('./config');
const { log } = require('./log');

const { maxRetryCount, retryInterval, pushDestination } = config.jobRunner.messagePush;
const { trustedIPOrName, trustedAuthPort } = config.ivisCore;
const MILIS_RETRY_TIME = retryInterval * 1000;

/**
 * @param {string} path
 * @returns {string} the full URL to requested IVIS-core path
 */
function getIVIScoreUrl(path) {
  const PROTOCOL = config.jobRunner.useCertificates ? 'https' : 'http';
  const PUSH_URL_BASE = `${PROTOCOL}://${trustedIPOrName}:${trustedAuthPort}${pushDestination}/`;
  return `${PUSH_URL_BASE}${path}`;
}

/**
 * @param {nubmer} time in milliseconds
 * @returns {Promise<void>} a promise which resolves after time specified
 */
function postponePromise(time) {
  // eslint-disable-next-line no-unused-vars
  return new Promise((resolve, _reject) => {
    setTimeout(resolve, time);
  });
}

/**
 * pushes a message with retry attempts according to the configuration
 * @param {string} url the destination
 * @param {object} requestBody the push endpoint request body
 * @param {number} attemptNumber the number of the current attempt
 */
async function pushAttemptLoop(url, requestBody, attemptNumber = 1) {
  if (maxRetryCount + 1 < attemptNumber) {
    log.error(`All ${maxRetryCount + 1} attempts have failed to push a message to IVIS-core!`);
    log.debug(`Message URL: ${url}`);
    log.debug(`Message Body: ${inspect(requestBody)}`);
    return;
  }

  axiosInstance.post(url, requestBody)
    .then(async ({ data, status }) => {
      if (status === 400) { // BAD REQUEST
        log.error(`Bad request when pushing a message: ${data}`);
        log.debug(`Message URL: ${url}`);
        log.debug(`Message Body: ${inspect(requestBody)}`);
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
 * @param {number} runId  the id of the run whose information will be pushed
 * @param {object} status run status
 * @param {string} output  run output, not mandatory
 * @param {string} errors errors, not mandatory
 */
async function runStatusUpdate(
  runId,
  status,
  output = undefined,
) {
  const requestBody = {
    runId, status, output,
  };
  await pushAttemptLoop(getIVIScoreUrl('status'), requestBody);
}

function getAccessTokenRefreshType() {
  return EventTypes.ACCESS_TOKEN_REFRESH;
}
// taken from ivis implementation
// hopefully will make the communication more cooperative
// these functions may be replaced with named functions, like requestStoreState and requestCreateSig
// the reason they are kept is to make it easier to propagate change from IVIS-core behavior

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
/**
 * Sends emission emulation request to the IVIS-core instance
 * @param {string} eventType, use the get...EventType functions
 * @param {object} data
 */
async function emitRemote(eventType, data) {
  const requestBody = {
    type: eventType,
    data,
  };
  await pushAttemptLoop(getIVIScoreUrl('emit'), requestBody);
}

/**
 * Forwards a run request to IVIS-core
 * @param {number} type
 * @param {object} request
 * @returns {Promise<object>} response from IVIS-core or null on error
 */
async function runRequest(type, request) {
  const requestBody = {
    type,
    payload: request,
  };
  try {
    const response = (await axiosInstance.post(getIVIScoreUrl('runRequest'), requestBody)).data;
    return response;
  } catch (error) {
    log.error('error when running remote job request with body');
    log.error(requestBody);

    if (error.response && error.response.data) {
      log.error('and error ', error.response.data);
      return error.response.data;
    }

    log.error('and an unknown error');
    return {
      error: 'unknown error, see the logs of the corresponding remote executor',
    };
  }
}

/**
 * Forwards a store-state request to IVIS-core
 * @param {jobId} job ID
 * @param {object} request
 * @returns {Promise<object>} response from IVIS-core or null on error
 */
async function requestStoreState(jobId, request) {
  return runRequest(RequestType.STORE_STATE, {
    jobId,
    request,
  });
}

/**
 * Forwards a signal set creation request to IVIS-core
 * @param {object} request
 * @returns {Promise<object>} response from IVIS-core or null on error
 */
async function requestCreateSig(jobId, signalSets, signalsSpec) {
  return runRequest(RequestType.CREATE_SIG, { jobId, signalSets, signalsSpec });
}

module.exports = {
  runStatusUpdate,
  emitRemote,
  getStopEventType,
  getOutputEventType,
  getFailEventType,
  getSuccessEventType,
  EventTypes,
  requestStoreState,
  requestCreateSig,
  getAccessTokenRefreshType,
};
