const { hasParam, walkObject, isInteger } = require('../lib/util');
const runs = require('../models/run');
const { log } = require('../lib/log');
const { sendStop, sendBuildRunBundle } = require('../lib/worker-process');
const { defaultSubtypeKey } = require('../shared/tasks');

/** sends an empty response with an HTTP code */
function respondWith(code, response) {
  response.status(code);
  response.send('');
}

/** sends a json response with an HTTP code */
function jsonRespondWith(code, json, response) {
  response.status(code);
  response.json(json);
}
/**
 * Checks that the original request contains a valid runId integer parameter
 * and adjust response accordingly
 * @returns {Promise<bool>} validity of runId param
 */
async function runIdOk(request, response) {
  if (!hasParam('run_id', request, isInteger)) {
    response.status(400);
    return false;
  }
  const runId = parseInt(request.params.run_id, 10);

  try {
    if (!await runs.existsRun(runId)) {
      response.status(404);
      return false;
    }
  } catch (error) {
    log.log('Exists run error', error);
    response.status(500);
    return false;
  }
  return true;
}

function commonErrResponseFormat(errObj) {
  return {
    error: `${errObj}`,
  };
}
async function stopRun(request, response) {
  if (!await runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  try {
    await sendStop(runId);
    respondWith(200, response);
  } catch (error) {
    log.log('Stop Request Error', error);
    jsonRespondWith(503, commonErrResponseFormat(error), response);
  }
}

function parseRunStatus({ output, runData, errMsg }) {
  return {
    status: runs.getRunStatusFromData(runData),
    output,
    error: errMsg,
    finished_at: runs.getFinishedTimeFromData(runData),
  };
}

async function runStatus(request, response) {
  if (!await runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  try {
    const jsonResponse = parseRunStatus(await runs.getRunById(runId));
    jsonRespondWith(200, jsonResponse, response);
  } catch (error) {
    log.error('HTTP GET run status: get run by id error', error);
    jsonRespondWith(503, commonErrResponseFormat(error), response);
  }
}

const RUN_SPEC = {
  taskId: 'int',
  type: 'str',
  codeArchive: {
    type: 'str',
    data: 'ignore',
  },
  runId: 'int',
  jobId: 'int',
  params: 'ignore',
  entities: 'ignore',
  owned: 'ignore',
  accessToken: 'ignore',
  state: 'ignore',
};

async function buildAndRun(request, response) {
  if (!walkObject(request.body, RUN_SPEC)) {
    respondWith(400, response);
    return;
  }

  const runSpec = request.body;
  if (runSpec.subtype !== undefined && typeof (runSpec.subtype) !== 'string') {
    respondWith(400, response);
    return;
  }

  // TODO: remove RunId from request body & inject the query runId into the runSpec
  const qryRunId = parseInt(request.params.run_id, 10);
  const bodyRunId = parseInt(request.body.runId, 10);
  if (qryRunId !== bodyRunId) {
    jsonRespondWith(400, commonErrResponseFormat('Inconsistent run request parameters - run ID'), response);
    return;
  }

  runSpec.subtype = runSpec.subtype || defaultSubtypeKey;

  try {
    await sendBuildRunBundle(runSpec);
    respondWith(200, response);
  } catch (error) {
    jsonRespondWith(503, commonErrResponseFormat(error), response);
  }
}

async function deleteRun(request, response) {
  if (!await runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  try {
    await runs.removeRun(runId);
    respondWith(200, response);
  } catch (error) {
    jsonRespondWith(503, commonErrResponseFormat(error), response);
  }
}

module.exports = {
  stopRun,
  deleteRun,
  runStatus,
  buildAndRun,
};
