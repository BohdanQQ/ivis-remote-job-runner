const { hasParam, walkObject, isInteger } = require('../lib/util');
const runs = require('../models/run');
const { log } = require('../lib/log');

const RUN_SPEC = {
  taskId: 'int',
  subtype: 'int',
  code: 'str',
  runId: 'int',
  jobInputData: 'ignore',
};

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

async function stopRun(request, response) {
  if (!runIdOk(request, response)) {
    response.send('');
    return;
  }
  log.log('alpha');
  // TODO 200
}

function parseRunStatus({ output, runData, errMsg }) {
  return {
    status: runs.getRunStatusFromData(runData),
    output,
    error: errMsg,
  };
}

async function runStatus(request, response) {
  if (!runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  response.send(parseRunStatus(await runs.getRunById(runId)));
  response.status(200);
}

async function buildAndRun(request, response) {
  if (!walkObject(request.body, RUN_SPEC)) {
    respondWith(400, response);
  }
  // TODO 200/503
}

async function deleteRun(request, response) {
  if (!runIdOk(request, response)) {
    response.send('');
    return;
  }
  const runId = parseInt(request.params.run_id, 10);

  try {
    await runs.removeRun(runId);
    response.status(200);
  } catch {
    response.status(503);
  }

  response.send('');
}

module.exports = {
  stopRun,
  deleteRun,
  runStatus,
  buildAndRun,
};
