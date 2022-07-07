const { log } = require('../lib/log');
const runs = require('../models/run');
const { RemoteRunState, HandlerMsgType } = require('../shared/remote-run');
const config = require('../lib/config');
const { TaskType, BUILD_DIR_PATH } = require('../shared/tasks');
const pythonHandler = require('./handlers/python');
const { createRunManager } = require('./handlers/run-manager');
const { updateBuildCache, isBuildCached } = require('../models/task_build_cache');
const tellBack = require('../lib/remotePush');
const { certPaths } = require('../lib/httpClient');

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
  return runs.changeState(runId, RemoteRunState.SUCCESS).then((success) => {
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
      return runs.appendErrMessage(runId, `REMOTE BUILD WARNINGS:\n${warnings.join('\n')}\nREMOTE BUILD ERRORS: ${errors.join('\n')}`);
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
        const warn = warnings ? `REMOTE BUILD WARNINGS:\n${warnings.join('\n')}\n` : '';
        onBuildSuccess(runId, warnings)
          .then(() => resolve({ success: true, warn, err: '' }))
          .catch((e) => resolve({ success: false, warn, err: e.toString() }));
      },
      (warnings, errors) => {
        const warn = warnings ? `REMOTE BUILD WARNINGS:\n${warnings.join('\n')}\n` : '';
        const errs = errors ? `REMOTE BUILD ERRORS:\n${errors.join('\n')}\n` : '';
        onBuildFail(runId, warnings, errors)
          .then(() => resolve({ success: false, warn, err: errs }))
          .catch((e) => resolve({ success: false, warn, err: errs + e.toString() }));
      },
    );
  });
}

// TODO remove subtype - move to a general config
// NOTE: build cache depends on subtype -> restructure build cache?
async function handleBuild({
  spec: {
    taskId,
    type,
    subtype,
    code,
    runId,
  },
}) {
  if (await isBuildCached(taskId, type, subtype, code)) {
    return;
  }
  const handler = handlerMap.get(type);
  runs.createRun(runId);
  if (!handler) {
    await onBuildFail(runId, null, [`Handler for type not found: ${type}`]);
  } else {
    buildingWork.set(taskId, getBuildPromise(handler, runId, subtype, code, `${BUILD_DIR_PATH}/${taskId}`));
    const buildPromise = buildingWork.get(taskId);
    await buildPromise.then(() => buildingWork.delete(taskId))
      .then(() => updateBuildCache(taskId, type, subtype, code));
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
  await tellBack.emitRemote(tellBack.getFailEventType(runId), errMsg);
}

async function handleRun({
  spec: {
    params,
    entities,
    owned,
    taskType,
    runId,
    accessToken,
    state,
    taskId,
    // eslint-disable-next-line no-unused-vars
    dir,
    jobId,
  },
}) {
  const runAfterBuild = runAfterBuildPermission.get(runId);
  if (runAfterBuild !== undefined && !runAfterBuild) {
    runs.changeState(runId, RemoteRunState.RUN_FAIL);
    await tellBack.emitRemote(tellBack.getFailEventType(runId), 'Remote Build Failed, check job output for details');
    return;
  }
  runAfterBuildPermission.delete(runId);

  const handler = handlerMap.get(taskType);
  try {
    if (!handler) {
      await onRunFail(runId, `handler for task type ${taskType} not found`);
      return;
    }

    await runs.changeState(runId, RemoteRunState.RUNNING);
    runningHandlers.set(runId, handler);
    const PROTOCOL = config.jobRunner.useCertificates ? 'https' : 'http';
    const runConfig = {
      jobId,
      runId,
      taskDir: `${BUILD_DIR_PATH}/${taskId}`,
      inputData: {
        context: {
          jobId,
        },
        params,
        entities,
        owned,
        accessToken,
        certs: config.jobRunner.useCertificates,
        caPath: certPaths.ca,
        certPath: certPaths.cliCert,
        keyPath: certPaths.cliKey,
        es: {
          host: config.ivisCore.es.host,
          port: `${config.ivisCore.es.port}`,
        },
        server: {
          trustedUrlBase: `${PROTOCOL}://${config.ivisCore.trustedIPOrName}:${config.ivisCore.trustedAuthPort}`,
          sandboxUrlBase: `${PROTOCOL}://${config.ivisCore.sandboxIPOrName}:${config.ivisCore.sandboxPort}`,
        },
        state,
      },
    };

    const runManager = createRunManager(jobId, runId, {
      onRunFail,
      onRunSuccess: () => {
        runningHandlers.delete(runId);
      },
      config: runConfig,
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
  const updateStatusToStopped = async (rId) => runs.appendErrMessage(rId, 'Run Cancelled\n')
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
        await runs.appendErrMessage(runId, 'Run Cancelled\n');
      } catch (err) {
        log.error(err);
      }
    } else if (runAfterBuildPermission.get(runId)) {
      // If the job is not running, it is possible that it is waiting for a build to finish
      runAfterBuildPermission.set(runId, false);
      await updateStatusToStopped(runId);
    }
  }

  await tellBack.emitRemote(tellBack.getStopEventType(runId));
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
  spec,
}) {
  async function pushRun() {
    workQueue.push({
      type,
      spec,
    });
    tryStartWork();
  }
  const { runId, taskId } = spec;

  await runs.createRun(runId);
  await runs.changeState(runId, RemoteRunState.QUEUED);

  const buildPromise = buildingWork.get(taskId);
  if (buildPromise === undefined) {
    if (runAfterBuildPermission.get(runId) === false) {
      runs.changeState(runId, RemoteRunState.RUN_FAIL);
      await tellBack.emitRemote(tellBack.getFailEventType(runId), 'Remote Build Failed, check job output for details');
      return;
    }

    await runs.changeState(runId, RemoteRunState.RUNNING);
    pushRun();
    return;
  }

  if (runAfterBuildPermission.get(runId) !== false) {
    runAfterBuildPermission.set(runId, true);
  }

  const { success, warn, err } = await buildPromise;

  const toWriteWarn = warn || '';
  const toWriteErr = err || '';

  await runs.appendErrMessage(runId, toWriteWarn + toWriteErr);
  if (!success) {
    runs.changeState(runId, RemoteRunState.BUILD_FAIL);
    await tellBack.emitRemote(tellBack.getFailEventType(runId), 'Remote Build Failed, check job output for details');
    return;
  }
  pushRun();
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
