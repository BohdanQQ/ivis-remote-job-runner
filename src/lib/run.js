const knex = require('./knex');
const remotePush = require('./remotePush');
const { RemoteRunState } = require('../shared/remote-run');
const { log } = require('./log');

async function updateRun(run, runData) {
  try {
    const out = 'Cancelled upon start';
    await knex('job_runs').where('run_id', run.run_id).update({
      runData: JSON.stringify(runData),
      // this discards the already present output, but IVIS-core does the same
      output: out,
    });
    await Promise.all([
      remotePush.runStatusUpdate(run.run_id, runData, out, run.errMsg),
      remotePush.emitRemote(remotePush.getFailEventType(run.id), out),
    ]);
  } catch (err) {
    log.error(`Failed to clear run with id ${run.run_id}: ${err}`);
  }
}

/**
 * Initialize runs, ensure correct state after shutdown
 */
async function init() {
  const runs = await knex('job_runs');
  if (!runs) {
    return;
  }

  const promises = [];
  runs.forEach((run) => {
    const runData = JSON.parse(run.runData);
    const runStatus = runData.status;
    if (runStatus === RemoteRunState.QUEUED || runStatus === RemoteRunState.RUNNING) {
      runData.status = RemoteRunState.RUN_FAIL;
      promises.push(updateRun(run, runData));
    }
  });

  await Promise.all(promises);
}

module.exports.init = init;
