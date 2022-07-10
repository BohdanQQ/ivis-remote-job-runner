const config = require('../../lib/config');
const { JobMsgType, STATE_FIELD } = require('../../shared/tasks');
const { RemoteRunState } = require('../../shared/remote-run');
const { log } = require('../../lib/log');
const runs = require('../../models/run');
const remotePush = require('../../lib/remotePush');

const LOG_ID = 'Task-handler';

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

  return [request, response];
}

async function handleRequest(jobId, requestStr) {
  // eslint-disable-next-line prefer-const
  let [request, response] = parseRequestResponse(requestStr);
  if (!request) {
    return response;
  }

  try {
    switch (request.type) {
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
    accessTokenRefreshTimer = setTimeout(refreshAccessToken, 30 * 1000);
  }

  if (accessToken) {
    refreshAccessToken().catch(
      (e) => log.error(e),
    );
  }

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

  async function onRunFailFromRunningStatus(errMsg) {
    await cleanBuffer();
    clearTimeout(accessTokenRefreshTimer);
    await runOptions.onRunFail(jobId, runId, runData, errMsg);
  }

  /**
       * Callback for successful run.
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

  // eslint-disable-next-line consistent-return
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
in the ivis-core version, this (timer reset, periodic cleanbuffer) is here because
the buffer is being periodically flushed; further investigation is needed as to whether
there is more than a performance benefit to it
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
