const knex = require('../lib/knex');

const { REMOTE_RUN_STATE } = require('../shared/remoteRun');

const RID_COLUMN = 'run_id';
const RUNS_TABLE = 'job_runs';

async function existsRun(runId) {
  const run = await knex(RUNS_TABLE).where(RID_COLUMN, runId).first();

  if (!run) {
    return false;
  }
  return true;
}

async function getRunById(runId) {
  const run = await knex(RUNS_TABLE).where(RID_COLUMN, runId).first();

  if (!run) {
    return null;
  }

  run.runData = JSON.parse(run.runData);

  return run;
}

async function removeRun(runId) {
  await knex(RUNS_TABLE).where(RID_COLUMN, runId).del();
}

/**
 *
 * @param {Integer} runId
 * @returns {Promise<Boolean>} true or false whether the run has been created
 */
async function createRun(runId) {
  return knex.transaction(
    async (t) => {
      const run = await t(RUNS_TABLE).where(RID_COLUMN, runId).first();

      if (run) {
        return false;
      }

      await t(RUNS_TABLE).insert({
        run_id: runId, output: '', runData: JSON.stringify({ status: REMOTE_RUN_STATE.QUEUED }), errMsg: '',
      });
      return true;
    },
  );
}

function getRunStatusFromData(runData) {
  return runData.status;
}

/**
 *
 * @param {Integer} runId
 * @returns {Promise<Boolean>} true or false whether the state has been changed
 */
async function changeState(runId, newState) {
  return knex.transaction(
    async (t) => {
      const run = await t(RUNS_TABLE).where(RID_COLUMN, runId).first();

      if (!run) {
        return false;
      }

      const runData = JSON.parse(run.runData);
      runData.status = newState;
      await t(RUNS_TABLE).where(RID_COLUMN, runId).update({
        runData: JSON.stringify(runData),
      });
      return true;
    },
  );
}

async function setOutput(runId, output) {
  await knex(RUNS_TABLE).where(RID_COLUMN, runId).update({ output });
}

async function setErrMessage(runId, message) {
  await knex(RUNS_TABLE).where(RID_COLUMN, runId).update({ errMsg: message });
}

module.exports = {
  getRunById,
  removeRun,
  getRunStatusFromData,
  createRun,
  changeState,
  setOutput,
  setErrMessage,
  existsRun,
};
