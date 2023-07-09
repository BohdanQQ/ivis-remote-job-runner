const { log } = require('../lib/log');
const fs = require('fs');
const runs = require('../models/run');
const { RemoteRunState, HandlerMsgType } = require('../shared/remote-run');
const config = require('../lib/config');
const { TaskType, BUILD_DIR_PATH } = require('../shared/tasks');
const pythonHandler = require('./handlers/python');
const { createRunManager } = require('./handlers/run-manager');
const {
  updateBuildCache, isBuildCached, invalidateBuildCache,
} = require('../models/task-build-cache');
const remotePush = require('../lib/remote-push');
const { certPaths } = require('../lib/http-client');

let isWorking = false;
const workQueue = [];
// run ID -> handler which corresponds with the run's task type
// used in case of a run stop request
const runningHandlers = new Map();

// run ID -> message of the following structure: {run: bool, warn: string, err: string}
// due to the BUILD-RUN relationship, this serves to propagate build warnings and errors
// to the scheduled run
const afterBuildMessage = new Map();
const checkInterval = config.jobRunner.workCheckInterval * 1000;

// task type -> task type handler
// handler is a type-specialized functionality which implements an interface for
// building tasks, running and stopping jobs of a particular task type
const handlerMap = new Map();
handlerMap.set(TaskType.PYTHON, pythonHandler);

/**
 * Builds a task
 * @param {number} type see shared/tasks
 * @param {string} subtype see shared/tasks
 * @param {object} codeArchiveBuff code archive stored in a buffer object
 * @param {string} destDir directory where the task shall be built
 * @param {number} runId runId associated with this build
 * @param {number} taskId
 * @returns {Promise<void>} A promise which never rejects, builds supplied task and saves
 * the last build result (a success flag with output) to the afterBuildMessage map.
 */
function getBuildPromise(type, subtype, codeArchiveBuff, destDir, runId, taskId) {
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
  // invalidate cache first just to be sure
  return invalidateBuildCache(taskId).then(() => new Promise((resolve) => {
    handler.init(
      {
        subtype,
        codeArchiveBuff,
        destDir,
      },
      (warnings) => {
        const warn = warnings ? `REMOTE BUILD WARNINGS:\n${warnings.join('\n')}\n` : '';
        afterBuildMessage.set(runId, {
          run: true,
          warn,
          err: '',
        });
        updateBuildCache(taskId, type, subtype, codeArchiveBuff, warn)
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
        // making sure cache stays invalid
        invalidateBuildCache(taskId, warn, errs).then(resolve);
      },
    );
  }));
}


/**
 * @param {string} taskId
 */
function getTaskDirectory(taskId) {
    return `${BUILD_DIR_PATH}/${taskId}`;
}

/**
 * Performs a cache-checked build.
 * @param {object} build message
 * @returns a promise which finishes when the build is finished
 */
async function handleBuild({
  spec: {
    taskId,
    type,
    subtype,
    codeArchive,
    runId,
  },
}) {
  const codeBuff = Buffer.from(codeArchive);
  if (await isBuildCached(taskId, type, subtype, codeBuff)) {
    afterBuildMessage.set(runId, {
      run: true,
      warn: '',
      err: '',
    });
    return;
  }
  await getBuildPromise(type, subtype, codeBuff, getTaskDirectory(taskId), runId, taskId);
}

/**
 * Writes and propagates run failure data where necessary.
 * Formally terminates the run with failed status.
 * @param {number} runId
 * @param {object} runData
 * @param {string} errMsg
 */
async function handleRunFail(runId, runData, errMsg) {
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
      await remotePush.runStatusUpdate(runId, finalRun.runData, `${errMsg}\n\nLog:\n${finalRun.output}`);
    }
  } catch (err) {
    log.error(err);
  }
  await remotePush.emitRemote(remotePush.getFailEventType(runId), errMsg);
}

/**
 * Run fail handler. Used as the exit point for run msg handling process.
 * @param runId
 * @param runData
 * @param errMsg Error description
 * @returns {Promise<void>}
 */
async function onRunFail(runId, runData, errMsg) {
  runningHandlers.delete(runId);
  await handleRunFail(runId, runData, errMsg);
}

/** Prepares and dispatches a run. */
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
    jobId,
  },
}) {
  const afterRunData = afterBuildMessage.get(runId);
  if (!afterRunData) {
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
    await runs.appendErrMessage(runId, 'Remote runner error');
    await remotePush.emitRemote(remotePush.getFailEventType(runId), 'Remote runner error');
    return;
  }

  const { run: runAfterBuild, warn, err } = afterRunData;
  afterBuildMessage.delete(runId);
  if (!runAfterBuild) {
    await runs.changeState(runId, RemoteRunState.RUN_FAIL);
    await remotePush.emitRemote(remotePush.getFailEventType(runId), `Remote Build Failed\n${warn}${err}`);
    return;
  }

  if (warn !== '') {
    await runs.appendOutput(warn);
    await remotePush.emitRemote(remotePush.getOutputEventType(runId), warn);
  }

  const handler = handlerMap.get(taskType);
  try {
    if (!handler) {
      await onRunFail(runId, undefined, `handler for task type ${taskType} not found`);
      return;
    }

    await runs.changeState(runId, RemoteRunState.RUNNING);
    await remotePush.runStatusUpdate(runId, {
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
    remotePush.runStatusUpdate(runId, {
      status: RemoteRunState.RUN_FAIL,
    }, `Pre-run checks, handler or run manager failed with following error:\n${error}`);
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
    const cancelledMsg = 'INFO: Run Cancelled\n';
    return runs.appendErrMessage(rId, cancelledMsg)
      .then(() => runs.changeState(rId, RemoteRunState.RUN_FAIL))
      .then((changeStateResult) => {
        if (!changeStateResult) {
          log.warn('Could not change run state on stop!');
        }
      })
      .then(async () => {
        const run = await runs.getRunById(runId);
        return remotePush.runStatusUpdate(
          runId,
          { status: RemoteRunState.RUN_FAIL },
          `${cancelledMsg}\n\nLog:\n${run ? run.output : ''}`,
        );
      })
      .catch((error) => log.error('stop handling error:', error));
  };
  // remove from queue or stop via corresponding handler
  if (index !== -1) {
    workQueue.splice(index, 1);
    await updateStatusToStopped(runId);
    await remotePush.emitRemote(remotePush.getStopEventType(runId));
  } else {
    const handler = runningHandlers.get(runId);
    if (handler) {
      try {
        await runs.appendErrMessage(runId, 'Run Cancelled\n');
        // other DB updates, etc. will be handled by the onFail handler provided to the run manager
        await handler.stop(runId);
        await remotePush.emitRemote(remotePush.getStopEventType(runId));
      } catch (err) {
        log.error(err);
      }
    } else {
      // job not enqueued to run and job not running - should not happen
      log.error('queueing error');
    }
  }
}

/**
 * Try to delete a task.
 * @param msg
 * @returns {Promise<void>}
 */
async function handleTaskDelete({ spec: { taskId }}) {
    const toDelete = getTaskDirectory(taskId);
    if (fs.existsSync(toDelete)) {
        await fs.promises.rmdir(getTaskDirectory(taskId));
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
      case HandlerMsgType.TASK_DELETE:
        await handleTaskDelete(event);
      default:
        log.error(`Unknown event type ${type} of event: ${event}`);
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
    switch (event.type) {
    case HandlerMsgType.BUILD: workQueue.push(event); break;
    case HandlerMsgType.STOP: await handleStop(event); break;
    case HandlerMsgType.RUN: {
      await runs.createRun(event.spec.runId);
      // around this point, a build for a different code can be enqueued
      // before this run event is pushed -> run will be executed using different
      // source code (thus scheduleBuildRunBundle)
      workQueue.push(event);
      break;
    }
    default: log.log(`Unknown event type ${event.type}`); return;
    }
  } catch (err) {
    log.error(err);
  }
}

// this is specifically for build and run
// since the code execution for enqueueing [build, run] won't
// run into an await, it is guaranteed that build and run will happen in
// the exact order "build -> run" with no other builds in between
// also the correct order of CREATE RUN -> run is ensured
async function scheduleBuildRunBundle([buildMsg, runMsg]) {
  // here we expect only one IVIS-core instance will use the the remote runner
  // (that runId will be unique for each run, or at least that 2 duplicate ids
  // won't exist at the same time)
  await runs.createRun(runMsg.spec.runId);
  workQueue.push(buildMsg);
  workQueue.push(runMsg);
}

process.on('message', (msg) => {
  if (msg instanceof Array) {
    scheduleBuildRunBundle(msg);
  } else {
    scheduleEvent(msg);
  }
  tryStartWork();
});
setInterval(tryStartWork, checkInterval);
log.log('Worker process started');
