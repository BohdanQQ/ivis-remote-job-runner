const { fork } = require('child_process');
const { HandlerMsgType } = require('../shared/remote-run');

const workerSource = './src/jobs/remote-job-handler.js';
let workerProcess;

function init() {
    workerProcess = fork(workerSource);
}

/**
 * Sends a message to the worker process, rejecting on error
 */
function promiseSend(message) {
  return new Promise((resolve, reject) => {
    workerProcess.send(message, (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

function sendStop(runId) {
  return promiseSend({
    type: HandlerMsgType.STOP,
    spec: {
      runId,
    },
  });
}

function sendBuildRunBundle(spec) {
  const buildMsg = {
    type: HandlerMsgType.BUILD,
    spec: {
      taskId: spec.taskId,
      type: spec.type,
      subtype: spec.subtype,
      codeArchive: spec.codeArchive,
      runId: spec.runId,
    },
  };

  const runMsg = {
    type: HandlerMsgType.RUN,
    spec: {
      params: spec.params,
      entities: spec.entities,
      owned: spec.owned,
      taskType: spec.type,
      accessToken: spec.accessToken,
      state: spec.state,
      runId: spec.runId,
      taskId: spec.taskId,
      jobId: spec.jobId,
    },
  };
  promiseSend([buildMsg, runMsg]);
}

function sendTaskRemove(taskId) {
    promiseSend({
        type: HandlerMsgType.TASK_DELETE,
        spec: {
            taskId
        }
    });
}

module.exports = {
  process: workerProcess,
  sendStop,
  sendBuildRunBundle,
  sendTaskRemove,
  init,
};
