const { hasParam, walkObject, isInteger } = require('../lib/util');
const runs = require('../models/run');
const { log } = require('../lib/log');
const { sendStop, sendBuildRunBundle } = require('../lib/worker-process');

function respondWith(code, response) {
  response.status(code);
  response.send('');
}

async function runIdOk(request, response) {
  if (!hasParam('run_id', request, isInteger)) {
    response.status(400);
    return false;
  }
  const runId = parseInt(request.params.run_id, 10);

  if (!await runs.existsRun(runId)) {
    response.status(404);
    return false;
  }
  return true;
}

function parseErrorResponse(errObj) {
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
    response.status(200);
    response.send('');
  } catch (error) {
    log.log('Stop Request Error', error);
    response.status(503);
    response.json(parseErrorResponse(error));
  }
}

function parseRunStatus({ output, runData, errMsg }) {
  return {
    status: runs.getRunStatusFromData(runData),
    output,
    error: errMsg,
  };
}

async function runStatus(request, response) {
  if (!await runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  response.status(200);
  response.json(parseRunStatus(await runs.getRunById(runId)));
}

const RUN_SPEC = {
  taskId: 'int',
  subtype: 'str',
  type: 'int',
  code: 'str',
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

  try {
    await sendBuildRunBundle(runSpec);
    response.status(200);
    response.send('');
  } catch (error) {
    response.json(parseErrorResponse(error));
    response.status(503);
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
    response.status(200);
    response.send('');
  } catch (error) {
    response.status(503);
    response.json(parseErrorResponse(error));
  }
}

module.exports = {
  stopRun,
  deleteRun,
  runStatus,
  buildAndRun,
};
