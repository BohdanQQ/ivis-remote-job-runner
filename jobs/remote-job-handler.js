const { log } = require('../lib/log');
const runs = require('../models/run');
const { RemoteRunState, HandlerMsgType } = require('../shared/remote-run');
const config = require('../lib/config');
const { TaskType, BUILD_DIR_PATH } = require('../shared/tasks');
const pythonHandler = require('./handlers/python');
const { createRunManager } = require('./handlers/run-manager');

let isWorking = false;
const workQueue = [];
// run_id -> run_handler
const runningHandlers = new Map();
// task_id -> promise(bool) (success of the build task)
const buildingWork = new Map();
// building -> STOP -> discard the build **and stop the scheduled run as well**
const runAfterBuildPermission = new Map();
const checkInterval = config.jobRunner.workCheckInterval * 1000;
const handlerMap = new Map();
handlerMap.set(TaskType.PYTHON, pythonHandler);

async function onBuildSuccess(runId, warnings) {
  const output = {};
  output.warnings = warnings || [];
  output.errors = [];
  if (warnings) {
    // TODO: refactor `REMOTE BUILD WARNINGS: ${warnings.join('\n')}` into a function
    return runs.appendErrMessage(runId, `REMOTE BUILD WARNINGS: ${warnings.join('\n')}`);
  }
  return runs.changeState(runId, RemoteRunState.QUEUED).then((success) => {
    if (!success) {
      return Promise.reject(new Error('Could not write run status to database'));
    }
    return Promise.resolve();
  });
}

function onBuildFail(runId, warnings, errors) {
  const output = {};
  output.warnings = warnings || [];
  output.errors = errors || [];

  return runs.changeState(runId, RemoteRunState.BUILD_FAIL).then((success) => {
    if (!success) {
      return Promise.reject(new Error('Could not write run status to database'));
    }
    if (warnings) {
      return runs.appendErrMessage(runId, `REMOTE BUILD WARNINGS: ${warnings.join('\n')}\nREMOTE BUILD ERRORS: ${errors.join('\n')}`);
    }
    return Promise.resolve();
  });
}

function getBuildPromise(handler, runId, subtype, code, destDir) {
  // eslint-disable-next-line no-unused-vars
  return new Promise((resolve, reject) => {
    handler.init(
      {
        subtype,
        code,
        destDir,
      },
      (warnings) => {
        onBuildSuccess(runId, warnings).then(() => resolve(true));
      },
      (warnings, errors) => {
        onBuildFail(runId, warnings, errors).then(() => resolve(false));
      },
    );
  });
}

// TODO remove subtype - move to a general config
async function handleBuild({
  spec: {
    taskId,
    type,
    subtype,
    code,
    runId,
  },
}) {
  const handler = handlerMap.get(type);
  runs.createRun(runId);
  if (!handler) {
    await onBuildFail(runId, null, [`Handler for type not found: ${type}`]);
  } else {
    buildingWork.set(taskId, getBuildPromise(handler, runId, subtype, code, `${BUILD_DIR_PATH}/${taskId}`));
    const buildPromise = buildingWork.get(taskId);
    await buildPromise.then(() => buildingWork.delete(taskId));
  }
}

/**
 * Load saved config from elasticsearch
 * @param id
 * @returns {Promise<void>} config field retrieved from ES
 */
// eslint-disable-next-line no-unused-vars
async function loadJobState(id) {
  return null;// TODO await forwardJobStateRequest(id);
}

async function handleRunFail(jobId, runId, runData, errMsg) {
  if (runId) {
    let dataToSave = runData;
    if (!runData) {
      dataToSave = {};
    }

    dataToSave.finished_at = new Date();
    dataToSave.status = RemoteRunState.RUN_FAIL;
    try {
      await runs.appendErrMessage(runId, errMsg);
      if (!await runs.changeRunData(runId, dataToSave)) {
        log.error('Could not save run data when handling run failure');
      }
    } catch (err) {
      log.error(err);
    }
  } else if (errMsg) {
    log.error(`Job ${jobId} run failed: ${errMsg}`);
  }
}

/**
 * Run fail handler. Used as the exit point for run msg handling process.
 * @param jobId
 * @param runId
 * @param runData
 * @param errMsg Error description
 * @returns {Promise<void>}
 */
async function onRunFail(jobId, runId, runData, errMsg) {
  runningHandlers.delete(runId);
  await handleRunFail(jobId, runId, runData, errMsg);
  // TODO emitToCoreSystem(getFailEventType(runId), errMsg);
}

async function handleRun({
  spec: {
    params,
    entities,
    owned,
    taskType,
    runId,
    taskId,
    // eslint-disable-next-line no-unused-vars
    dir,
    jobId,
  },
}) {
  const handler = handlerMap.get(taskType);
  try {
    if (!handler) {
      await onRunFail(runId, `handler for task type ${taskType} not found`);
      return;
    }

    await runs.changeState(runId, RemoteRunState.RUNNING);
    runningHandlers.set(runId, handler);

    const runConfig = {
      jobId,
      runId,
      taskDir: `${BUILD_DIR_PATH}/${taskId}`,
      inputData: {
        context: {
          jobId,
        },
        params: params || {},
        entities,
        owned,
        // accessToken: spec.accessToken || null,
        es: {
          host: `${config.ivisCore.trustedIPOrName}`,
          port: `${config.ivisCore.ivisElasticSearchPort}`,
        },
        // server: {
        //   trustedUrlBase: config.www.trustedUrlBase,
        //   sandboxUrlBase: config.www.sandboxUrlBase,
        // },
        state: await loadJobState(jobId),
      },
    };

    const runManager = createRunManager(jobId, runId, {
      onRunFail,
      onRunSuccess: () => {
        runningHandlers.delete(runId);
      },
      emit: (x) => { log.log(`emit: ${x}}`); },
      // TODO emit: emitToCoreSystem,
    });

    handler.run(
      runConfig,
      runManager.onRunEvent,
      runManager.onRunSuccess,
      runManager.onRunFail,
    );
  } catch (err) {
    log.error(err);
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
  }
}

/**
 * Stop running job, if still running.
 * @param msg
 * @returns {Promise<void>}
 */
async function handleStop(msg) {
  const { runId } = msg.spec;
  const index = workQueue.findIndex((i) => i.spec.runId === runId);
  const updateStatusToStopped = async (rId) => runs.setErrMessage(rId, 'Run Cancelled\n')
    .then(() => runs.changeState(rId, RemoteRunState.RUN_FAIL))
    .then((changeStateResult) => {
      if (!changeStateResult) {
        log.warn('Could not change run state!');
      }
    });

  // remove from queue or stop via corresponding handler
  if (index !== -1) {
    workQueue.splice(index, 1);
    await updateStatusToStopped(runId);
  } else {
    const handler = runningHandlers.get(runId);
    if (handler) {
      try {
        // DB updates, etc. will be handled by the onFail handler provided to the run manager
        await handler.stop(runId);
      } catch (err) {
        log.error(err);
      }
    } else if (runAfterBuildPermission.get(runId)) {
      // If the job is not running, it is possible that it is waiting for a build to finish
      runAfterBuildPermission.set(runId, false);
      await updateStatusToStopped(runId);
    }
  }

  // TODO:
  // emitToCoreSystem(getStopEventType(runId));
}

async function startWork() {
  while (workQueue.length > 0) {
    const event = workQueue.shift();

    const { type } = event;
    // TODO: refactor
    try {
      switch (type) {
        case HandlerMsgType.BUILD:
          // eslint-disable-next-line no-await-in-loop
          await handleBuild(event);
          break;
        case HandlerMsgType.RUN:
          // eslint-disable-next-line no-await-in-loop
          await handleRun(event);
          break;
        case HandlerMsgType.STOP:
          // eslint-disable-next-line no-await-in-loop
          await handleStop(event);
          break;
        default:
          break;
      }
    } catch (err) {
      log.error(err);
    }
  }

  isWorking = false;
}

function tryStartWork() {
  if (isWorking) {
    return;
  }
  isWorking = true;

  startWork().catch((err) => log.error(err));
}

async function scheduleRun({
  type,
  spec: {
    params,
    entities,
    owned,
    taskType,
    runId,
    taskId,
    dir,
    jobId,
  },
}) {
  async function pushRun() {
    workQueue.push({
      type,
      spec: {
        params,
        entities,
        owned,
        taskType,
        runId,
        taskId,
        dir,
        jobId,
      },
    });
    tryStartWork();
  }

  const buildPromise = buildingWork.get(taskId);
  if (buildPromise) {
    if (runAfterBuildPermission.get(runId) !== false) {
      runAfterBuildPermission.set(runId, true);
    }
    await runs.createRun(runId);
    await runs.changeState(runId, RemoteRunState.QUEUED);
    buildPromise.then((success) => {
      if (!runAfterBuildPermission.get(runId)) {
        runs.changeState(runId, RemoteRunState.RUN_FAIL);
        return false;
      }
      runAfterBuildPermission.delete(runId);
      if (!success) {
        runs.changeState(runId, RemoteRunState.BUILD_FAIL);
        return false;
      }
      return runs.changeState(runId, RemoteRunState.RUNNING);
    })
      .then((canRun) => {
        if (canRun) pushRun();
      });
  } else {
    await runs.changeState(runId, RemoteRunState.RUNNING);
    pushRun();
  }
}

function scheduleEvent(event) {
  if (!event) {
    return;
  }

  try {
    // TODO: refactor
    switch (event.type) {
      case HandlerMsgType.BUILD: workQueue.push(event); break;
      case HandlerMsgType.STOP: workQueue.push(event); break;
      case HandlerMsgType.RUN: scheduleRun(event); break;
      default: log.log(`Unknown event type ${event.type}`); return;
    }
    tryStartWork();
  } catch (err) {
    log.error(err);
  }
}

process.on('message', (msg) => {
  if (msg instanceof Array) {
    msg.forEach((event) => {
      scheduleEvent(event);
    });
  } else {
    scheduleEvent(msg);
  }
});
setInterval(tryStartWork, checkInterval);
log.log('Worker process started');