const { inspect } = require('node:util');
const { PushType, RequestType, EventTypes } = require('../shared/remote-run');
const { axiosInstance } = require('./httpClient');
const config = require('./config');

const log = console;

const { maxRetryCount, retryInterval, pushDestination } = config.jobRunner.messagePush;
const { trustedIPOrName, trustedAuthPort } = config.ivisCore;
const MILIS_RETRY_TIME = retryInterval * 1000;
function getIVIScoreUrl(path) {
  const PROTOCOL = config.jobRunner.useCertificates ? 'https' : 'http';
  const PUSH_URL_BASE = `${PROTOCOL}://${trustedIPOrName}:${trustedAuthPort}${pushDestination}/`;
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
 * @param {*} runId  the id of the run whose information will be pushed
 * @param {*} status run status
 * @param {*} warns  warnings, not mandatory
 * @param {*} errors errors, not mandatory
 */
async function runStatusUpdate(
  runId,
  status,
  output = undefined,
  errors = undefined,
) {
  const requestBody = {
    type: PushType.STATE_UPDATE, runId, status, output, errors,
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
// TODO: translation layer (not direct sharing!) on the IVIS-core side for this exact purpose?

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
    type: eventType,
    data,
  };
  await pushAttemptLoop(getIVIScoreUrl('emit'), requestBody);
}

/**
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
    log.log('error when running remote job request with body');
    log.log(requestBody);
    log.log('and error ', error);
    return null;
  }
}

/**
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
