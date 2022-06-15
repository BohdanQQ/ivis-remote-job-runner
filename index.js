// const express = require('express');
// const config = require('./lib/config');
// const appBuild = require('./app-build');

// const app = express();
// const jobBuild = require('./jobs/handlers/python');
// const { defaultSubtypeKey } = require('./shared/tasks');

// function main() {
//   const { port } = config.jobRunner;

//   appBuild(app);

//   app.listen(port, config.jobRunner.hostName, () => {
//     console.log(`IVIS Job runner is listening on port ${port}`);
//   });
// }

const { fork } = require('child_process');

const workerSource = './jobs/remote-job-handler.js';
const workerProcess = fork(workerSource);

const { HandlerMsgType } = require('./shared/remote-run');
const { TaskType, defaultSubtypeKey } = require('./shared/tasks');

const build11 = {
  type: HandlerMsgType.BUILD,
  spec: {
    taskId: 123456,
    type: TaskType.PYTHON,
    subtype: defaultSubtypeKey,
    code: `
x = 5
print(x)
x = 6
print(x)
raise aaaaaa
`,
    runId: 11,
  },
};

const run12 = {
  type: HandlerMsgType.RUN,
  spec: {
    params: { i: 'PARAMS' },
    entities: { i: 'ENTITIES' },
    owned: { i: 'OWNED' },
    taskType: TaskType.PYTHON,
    runId: 12,
    taskId: 123456,
    dir: '123456',
    jobId: 0,
  },
};

const run14 = {
  type: HandlerMsgType.RUN,
  spec: {
    params: { i: 'PARAMS' },
    entities: { i: 'ENTITIES' },
    owned: { i: 'OWNED' },
    taskType: TaskType.PYTHON,
    runId: 14,
    taskId: 123456,
    dir: '123456',
    jobId: 0,
  },
};

const stop14 = {
  type: HandlerMsgType.STOP,
  spec: {
    runId: 14,
  },
};

try {
  workerProcess.send(build11);
  workerProcess.send(run12);
  workerProcess.send(run14);
  setTimeout(() => {
    workerProcess.send(stop14);
  }, 10000);
} catch (err) {
  console.error(err);
}
