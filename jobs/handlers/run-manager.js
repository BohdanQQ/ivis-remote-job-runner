const config = require('../../lib/config');
// const knex = require('../../lib/knex');
const { JobMsgType, STATE_FIELD } = require('../../shared/tasks');
const { RemoteRunState } = require('../../shared/remote-run');
const { log } = require('../../lib/log');
// const { getSuccessEventType, getOutputEventType } = require('../../lib/task-events');
const runs = require('../../models/run');

const LOG_ID = 'Task-handler';

/**
 * Store config from job, overwrites old config
 * @param id ID of the job config belongs to
 * @param state Config to store, JSON format
 * @returns {Promise<void>}
 */
async function storeRunState(id, state) {
  log.log(`store state ${state} with id ${id}`);
  // TODO forward the request to IVIS-core
  // await forwardStoreRunState(id, state);
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
          // TODO: forward the create request to IVIS-core
          const reqResult = null;
          // await forwardCreateRequest(jobId, request.signalSets, request.signals);
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
          // TODO: forward the store request to IVIS-core
          const reqResult = null;
          // await forwardStoreRunState(jobId, request[STATE_FIELD]);
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

  async function cleanBuffer() {
    try {
      if (outputBuffer.length > 0) {
        const output = [...outputBuffer];
        outputBuffer = [];
        // TODO forward
        // runOptions.emit(getOutputEventType(runId), output);
        await runs.appendOutput(runId, output.join(''));
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
    await runOptions.onRunFail(jobId, runId, runData, errMsg);
  }

  /**
     * Callback for successful run.
     * @param cfg config
     * @returns {Promise<void>}
     */
  async function onRunSuccess(cfg) {
    await cleanBuffer();

    runOptions.onRunSuccess();
    runData.finished_at = new Date();
    runData.status = RemoteRunState.SUCCESS;
    try {
      await runs.changeRunData(runId, runData);
      if (cfg) {
        await storeRunState(jobId, cfg);
      }
    } catch (err) {
      log.error(LOG_ID, err);
    }
    // TODO forward
    // runOptions.emit(getSuccessEventType(runId));
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
                    // TODO forward
                    // runOptions.emit(getOutputEventType(runId), maxMsg);
                  } else {
                    outputBuffer.push(maxMsg);
                  }
                } catch (e) {
                  log.error(LOG_ID, `Output handling for the run ${runId} failed`, e);
                }
              }
            } else {
              outputBuffer.push(data);
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
