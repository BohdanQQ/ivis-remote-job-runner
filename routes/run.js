const {hasParam, walkObject} = require('../lib/util')

const RUN_SPEC = {
  "taskId": "int",
  "subtype": "int",
  "code": "str",
  "runId": "int",
  "jobInputData": "ignore"
}

async function stopRun(request, response) {
  if (!hasParam('run_id', request, isInteger)) {
    // 400
  }
  let runId = parseInt(request.params.run_id);
  if (/** run with run_id not found */) {
    // 404
  }
  // TODO 200
}

async function runStatus(request, response) {
  if (!hasParam('run_id', request, isInteger)) {
    // 400
  }
  let runId = parseInt(request.params.run_id);
  if (/** run with run_id not found */) {
    // 404
  }
  // TODO 200
}

async function buildAndRun(request, response) {
  if (!walkObject(request.body, RUN_SPEC)) {
    // 400
  }
  // TODO 200/503
}

async function deleteRun(request, response) {
  if (!ensureParam('run_id', request, isInteger)) {
    // 400
  }
  let runId = parseInt(request.params.run_id);
  if (/** run with run_id not found */) {
    // 404
  }
  // TODO 200/503
}

module.exports = {
  stopRun,
  deleteRun,
  runStatus,
  buildAndRun
};
