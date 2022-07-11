const config = require('../../lib/config');
const { JobMsgType, STATE_FIELD } = require('../../shared/tasks');
const { RemoteRunState } = require('../../shared/remote-run');
const { log } = require('../../lib/log');
const runs = require('../../models/run');
const remotePush = require('../../lib/remotePush');

const LOG_ID = 'Task-handler';

/**
 * Run manager is a set of functions which are to be called when a job is being run and
 * a) a run event happens
 * b) run ends with success
 * c) run ends with failure
 *
 * The creation of run manager only involves a function closure which encapsulates data
 * relevant to the particular run requesting the creation of run manager.
 *
 * Functions returned by the createRunManager are passed to the run handler which
 * executes the run (and uses the functions, for example, in the event listeners for
 * the above-mentioned events)
 */

/**
 * Store config from job, overwrites old config
 * @param id ID of the job config belongs to
 * @param state Config to store, JSON format
 * @returns {Promise<void>}
 */
async function storeRunState(id, state) {
  log.log(`store state ${state} with id ${id}`);
  remotePush.requestStoreState(id, state);
}

function parseRequest(req) {
  return JSON.parse(req);
}

/**
 * Parses a request string into a parsed request and a response.
 * @param {string} requestStr
 * @returns {{request: object, response: object}} If request is null, response contains
 *  errors encountered when parsing the requestStr.
 */
function parseRequestResponse(requestStr) {
  const response = {};
  let request = {};

  if (!requestStr) {
    response.error = 'Request not specified';
    return [null, response];
  }

  try {
    request = parseRequest(requestStr);
    if (request.id) {
      response.id = request.id;
    }
  } catch (err) {
    response.error = `Request parsing failed: ${err.message}`;
    return [null, response];
  }

  if (!request.type && request.type !== 0) {
    response.error = 'Type not specified';
    return [null, response];
  }

  return { request, response };
}

/** Processes a raw run request (as picked up).
 * @returns {Promise<object>} On error, the resulting object's
 * error key contains the error message.
 */
async function handleRequest(jobId, requestStr) {
  // eslint-disable-next-line prefer-const
  let { request, response } = parseRequestResponse(requestStr);
  if (!request) {
    return response;
  }

  try {
    switch (request.type) {
      // here we only forward the requests to IVIS-core
      case JobMsgType.CREATE_SIGNALS:
        if (request.signalSets || request.signals) {
          const reqResult = await remotePush.requestCreateSig(jobId, request.signalSets, request.signals);
          response = {
            ...response,
            ...reqResult,
          };
        } else {
          response.error = 'Either signalSets or signals have to be specified';
        }
        break;
      case JobMsgType.STORE_STATE:
        if (request[STATE_FIELD]) {
          const reqResult = await remotePush.requestStoreState(jobId, request[STATE_FIELD]);
          response = {
            ...response,
            ...reqResult,
          };
        } else {
          response.error = `${STATE_FIELD} not specified`;
        }
        break;
      default:
        response.error = `Type ${request.type} not recognized`;
        break;
    }
  } catch (error) {
    log.warn(LOG_ID, error);
    response.error = error.message;
  }
  return response;
}

/**
 * Creates a closure encapsulating all (future) run data.
 * @param {number} jobId
 * @param {number} runId
 * @param {object} runOptions
 * @returns {{ onRunEvent: function, onRunSuccess: function, onRunFail: function}}
 * functions for run data manipulation
 */
function createRunManager(jobId, runId, runOptions) {
  const runData = {};
  runData.started_at = new Date();

  const maxOutput = config.jobRunner.maxJobOutput || 1000000;
  let outputBytes = 0;
  let limitReached = false;
  let outputBuffer = [];
  let timer;
  let accessTokenRefreshTimer;
  const { accessToken } = runOptions.config.inputData;

  async function refreshAccessToken() {
    remotePush.emitRemote(remotePush.getAccessTokenRefreshType(), {
      runId,
      jobId,
      accessToken,
    });
    // TODO: might be better to make this configurable since the remote run
    // should require shorter period to account for networking losses
    accessTokenRefreshTimer = setTimeout(refreshAccessToken, 30 * 1000);
  }

  if (accessToken) {
    refreshAccessToken().catch(
      (e) => log.error(e),
    );
  }

  // flushes buffer into db, propagates to IVIS-core
  async function cleanBuffer() {
    try {
      if (outputBuffer.length > 0) {
        const output = [...outputBuffer];
        outputBuffer = [];
        await runs.appendOutput(runId, output.join(''));
        await remotePush.emitRemote(remotePush.getOutputEventType(runId), output);
      }
      timer = null;
    } catch (e) {
      log.error(`Output handling for the run ${runId} failed : ${e}`);
      outputBuffer = [];
      timer = null;
    }
  }

  // cleanup + call specified fail handler
  async function onRunFailFromRunningStatus(errMsg) {
    await cleanBuffer();
    clearTimeout(accessTokenRefreshTimer);
    // TODO move finished_at modification here? (see onRunSuccess)
    await runOptions.onRunFail(runId, runData, errMsg);
  }

  /**
     * Callback for successful run. Persists data, propagates to IVIS-core
     * @param cfg config
     * @returns {Promise<void>}
     */
  async function onRunSuccess(cfg) {
    await cleanBuffer();
    clearTimeout(accessTokenRefreshTimer);
    runOptions.onRunSuccess();
    runData.finished_at = new Date();
    runData.status = RemoteRunState.SUCCESS;
    try {
      await runs.changeRunData(runId, runData);
      if (cfg) {
        await storeRunState(jobId, cfg);
      }
      const finalRun = await runs.getRunById(runId);

      if (finalRun === null) {
        log.error(`Could not push data to IVIS-core, run ${runId} does not exist!`);
      } else {
        await remotePush.runStatusUpdate(runId, finalRun.runData, finalRun.output, finalRun.errMsg);
      }
    } catch (err) {
      log.error(LOG_ID, err);
    }
    remotePush.emitRemote(remotePush.getSuccessEventType(runId));
  }

  async function onRunEvent(type, data) {
    switch (type) {
      case 'output':
        try {
          if (!limitReached) {
            const byteLength = Buffer.byteLength(data, 'utf8');
            outputBytes += byteLength;

            if (outputBytes >= maxOutput) {
              limitReached = true;
              if (config.jobRunner.printLimitReachedMessage === true) {
                try {
                  await runs.appendOutput(runId, 'INFO: max output storage capacity reached\n');
                  const maxMsg = 'INFO: max output capacity reached';
                  if (!timer) {
                    // TODO: do we require emissions ordered?
                    // if yes, this call should be awaited
                    remotePush.emitRemote(remotePush.getOutputEventType(runId), maxMsg);
                  } else {
                    outputBuffer.push(maxMsg);
                  }
                } catch (e) {
                  log.error(LOG_ID, `Output handling for the run ${runId} failed`, e);
                }
              }
            } else {
              outputBuffer.push(data);
              /* Note:
              this (timer reset, cleanbuffer after 1s) is here to limit the amount of DB
              interactions when there is a rapid output generation
              */
              // TODO Don't know how well this will scale
              // --   it might be better to append to a file, but this will require further syncing
              // --   as we need full output for task development in the UI, not only output after
              // --   the register of listener therefore keeping it this way for now
              if (!timer) {
                timer = setTimeout(cleanBuffer, 1000);
              }
            }
          }
        } catch (e) {
          log.error(LOG_ID, `Output handling for the run ${runId} failed`, e);
        }
        break;
      case 'request':
        return handleRequest(jobId, data);
      default:
        log.warn(LOG_ID, `Job ${jobId} run ${runId}: unknown event ${type} `);
        break;
    }
    // only request type is supposed to return something (which it does)
    return null;
  }

  return {
    onRunEvent,
    onRunSuccess,
    onRunFail: onRunFailFromRunningStatus,
  };
}

module.exports = {
  createRunManager,
};
