const { log } = require('../lib/log');
const runs = require('../models/run');
const { RemoteRunState, HandlerMsgType } = require('../shared/remote-run');
const config = require('../lib/config');
const { TaskType, BUILD_DIR_PATH } = require('../shared/tasks');
const pythonHandler = require('./handlers/python');
const { createRunManager } = require('./handlers/run-manager');
const {
  updateBuildCache, isBuildCached, invalidateBuildCache,
} = require('../models/task_build_cache');
const tellBack = require('../lib/remotePush');
const { certPaths } = require('../lib/httpClient');

let isWorking = false;
const workQueue = [];
// run_id -> run_handler
const runningHandlers = new Map();
// building -> STOP -> discard the build **and stop the scheduled run as well**
// also holds the build warnings and errors
const afterBuildMessage = new Map();
const checkInterval = config.jobRunner.workCheckInterval * 1000;
const handlerMap = new Map();
handlerMap.set(TaskType.PYTHON, pythonHandler);

function getBuildPromise(type, subtype, code, destDir, runId, taskId) {
  // this promise never rejects! (only resolves or is unresolved forever - which would be a bug)
  const handler = handlerMap.get(type);
  if (handler === undefined) {
    afterBuildMessage.set(runId, {
      run: false,
      warn: '',
      err: `task type ${type} not recognised`,
    });
    return invalidateBuildCache(taskId);
  }
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
        afterBuildMessage.set(runId, {
          run: true,
          warn,
          err: '',
        });
        updateBuildCache(taskId, type, subtype, code, warn)
          .then(resolve);
      },
      (warnings, errors) => {
        const warn = warnings ? `REMOTE BUILD WARNINGS:\n${warnings.join('\n')}\n` : '';
        const errs = errors ? `REMOTE BUILD ERRORS:\n${errors.join('\n')}\n` : '';
        afterBuildMessage.set(runId, {
          run: false,
          warn,
          err: errs,
        });
        invalidateBuildCache(taskId, warn, errs).then(resolve);
      },
    );
  });
}

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
    afterBuildMessage.set(runId, {
      run: true,
      warn: '',
      err: '',
    });
    return;
  }
  await getBuildPromise(type, subtype, code, `${BUILD_DIR_PATH}/${taskId}`, runId, taskId);
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
      const finalRun = await runs.getRunById(runId);

      if (finalRun === null) {
        log.error(`Could not push data to IVIS-core, run ${runId} does not exist!`);
      } else {
        await tellBack.runStatusUpdate(runId, finalRun.runData, finalRun.output, finalRun.errMsg);
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
  // here we expect only one IVIS-core instance will use the the remote runner
  await runs.createRun(runId);

  const afterRunData = afterBuildMessage.get(runId);
  if (!afterRunData) {
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
    await runs.appendErrMessage(runId, 'Remote runner error');
    await tellBack.emitRemote(tellBack.getFailEventType(runId), 'Remote runner error');
    return;
  }

  const { run: runAfterBuild, warn, err } = afterRunData;
  afterBuildMessage.delete(runId);
  if (!runAfterBuild) {
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
    await tellBack.emitRemote(tellBack.getFailEventType(runId), `Remote Build Failed\n${warn}${err}`);
    return;
  }

  if (warn !== '') {
    await runs.appendOutput(warn);
    await tellBack.emitRemote(tellBack.getOutputEventType(runId), warn);
  }

  const handler = handlerMap.get(taskType);
  try {
    if (!handler) {
      await onRunFail(runId, `handler for task type ${taskType} not found`);
      return;
    }

    await runs.changeState(runId, RemoteRunState.RUNNING);
    await tellBack.runStatusUpdate(runId, {
      status: RemoteRunState.RUNNING,
    });
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
  } catch (error) {
    log.error(error);
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
    tellBack.runStatusUpdate(runId, {
      status: RemoteRunState.RUN_FAIL,
    }, '', `Pre-run checks, handler or run manager failed with following error:\n${error}`);
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
  const updateStatusToStopped = async (rId) => {
    // runs in queue are not yet in the database and since the run is removed from queue,
    // no double create will occur
    await runs.createRun(rId);
    const cancelledMsg = 'Run Cancelled\n';
    return runs.appendErrMessage(rId, cancelledMsg)
      .then(() => runs.changeState(rId, RemoteRunState.RUN_FAIL))
      .then((changeStateResult) => {
        if (!changeStateResult) {
          log.warn('Could not change run state on stop!');
        }
      })
      .then(() => tellBack.runStatusUpdate(
        runId,
        { status: RemoteRunState.RUN_FAIL },
        '',
        cancelledMsg,
      ))
      .catch((error) => log.error('stop handling error:', error));
  };
  // remove from queue or stop via corresponding handler
  if (index !== -1) {
    workQueue.splice(index, 1);
    await updateStatusToStopped(runId);
    await tellBack.emitRemote(tellBack.getStopEventType(runId));
  } else {
    const handler = runningHandlers.get(runId);
    if (handler) {
      try {
        // DB updates, etc. will be handled by the onFail handler provided to the run manager
        await runs.appendErrMessage(runId, 'Run Cancelled\n');
        await handler.stop(runId);
        await tellBack.emitRemote(tellBack.getStopEventType(runId));
      } catch (err) {
        log.error(err);
      }
    } else {
      // job not enqueued to run and job not running - should not happen
      log.error('queueing error');
    }
  }
}

async function startWork() {
  while (workQueue.length > 0) {
    const event = workQueue.shift();
    const { type } = event;
    try {
      switch (type) {
        case HandlerMsgType.BUILD:
          // the entire build blocks the loop
          // this is to prevent multiple builds for the same task (but a different job)
          // to race each other
          // eslint-disable-next-line no-await-in-loop
          await handleBuild(event);
          break;
        case HandlerMsgType.RUN:
          // run does not block the loop for the entirety of its runtime
          // here we expect that a rebuild of a task T while a job
          // of a task T is running is incorrect
          // eslint-disable-next-line no-await-in-loop
          await handleRun(event);
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

async function scheduleEvent(event) {
  if (!event) {
    return;
  }

  try {
    // TODO: refactor
    switch (event.type) {
      case HandlerMsgType.BUILD: workQueue.push(event); break;
      case HandlerMsgType.STOP: await handleStop(event); break;
      case HandlerMsgType.RUN: workQueue.push(event); break;
      default: log.log(`Unknown event type ${event.type}`); return;
    }
  } catch (err) {
    log.error(err);
  }
}

process.on('message', (msg) => {
  if (msg instanceof Array) {
    // this is specifically for build and run
    // since the code execution for enqueueing [build, run] won't
    // run into an await, it is guaranteed that build and run will happen in
    // the exact order "build -> run" with no other builds in between
    msg.forEach((event) => {
      scheduleEvent(event);
    });
  } else {
    scheduleEvent(msg);
  }
  tryStartWork();
});
setInterval(tryStartWork, checkInterval);
log.log('Worker process started');
