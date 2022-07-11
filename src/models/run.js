const knex = require('../lib/knex');
const { log } = require('../lib/log');

const { RemoteRunState } = require('../shared/remote-run');

const RID_COLUMN = 'run_id';
const RUNS_TABLE = 'job_runs';

/**
 * @returns {Promise<bool>} rejects on database error!
 */
async function existsRun(runId) {
  const run = await knex(RUNS_TABLE).where(RID_COLUMN, runId).first();

  if (!run) {
    return false;
  }
  return true;
}

/**
 * @returns {Promise<object>} rejects on database error!
 */
async function getRunById(runId) {
  const run = await knex(RUNS_TABLE).where(RID_COLUMN, runId).first();

  if (!run) {
    return null;
  }

  run.runData = JSON.parse(run.runData);

  return run;
}

async function removeRun(runId) {
  try {
    await knex(RUNS_TABLE).where(RID_COLUMN, runId).del();
  } catch (error) {
    log.error('Remove run error:', error);
  }
}

/**
 *
 * @param {Integer} runId
 * @returns {Promise<Boolean>} true or false whether the run has been created
 */
async function createRun(runId) {
  return knex.transaction(
    async (t) => {
      try {
        const run = await t(RUNS_TABLE).where(RID_COLUMN, runId).first();

        if (run) {
          return false;
        }

        await t(RUNS_TABLE).insert({
          run_id: runId, output: '', runData: JSON.stringify({ status: RemoteRunState.QUEUED }), errMsg: '',
        });
        return true;
      } catch (error) {
        log.error('Create run error: ', error);
        return false;
      }
    },
  );
}

function getRunStatusFromData(runData) {
  return runData.status;
}

/**
 * Updates only the run status
 * @param {number} runId
 * @param {number} newState - use RemoteRunState
 * @returns {Promise<Boolean>} true or false whether the state has been changed
 */
async function changeState(runId, newState) {
  return knex.transaction(
    async (t) => {
      try {
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
      } catch (error) {
        log.error('Change State error: ', error);
        return false;
      }
    },
  );
}

/**
 *
 * @returns {Promise<Boolean>} true or false - success of the change
 */
async function changeRunData(runId, newRunData) {
  return knex.transaction(
    async (t) => {
      try {
        const run = await t(RUNS_TABLE).where(RID_COLUMN, runId).first();

        if (!run) {
          return false;
        }

        await t(RUNS_TABLE).where(RID_COLUMN, runId).update({
          runData: JSON.stringify(newRunData),
        });
        return true;
      } catch (error) {
        log.error('Run data change error: ', error);
        return false;
      }
    },
  );
}

async function appendToRunField(runId, field, toAppend) {
  return knex.transaction(
    async (t) => {
      const run = await t(RUNS_TABLE).where(RID_COLUMN, runId).first();
      if (!run) {
        return;
      }
      run[field] += toAppend;

      const mutObj = {};
      mutObj[field] = run[field];
      await t(RUNS_TABLE).where(RID_COLUMN, runId).update(mutObj);
    },
  );
}

/**
 * @returns {Promise<void>} rejects on database error!
 */
async function setOutput(runId, output) {
  await knex(RUNS_TABLE).where(RID_COLUMN, runId).update({ output });
}

/**
 * @returns {Promise<void>} rejects on database error!
 */
async function appendOutput(runId, output) {
  appendToRunField(runId, 'output', output);
}

/**
 * @returns {Promise<void>} rejects on database error!
 */
async function setErrMessage(runId, message) {
  await knex(RUNS_TABLE).where(RID_COLUMN, runId).update({ errMsg: message });
}

/**
 * @returns {Promise<void>} rejects on database error!
 */
async function appendErrMessage(runId, message) {
  appendToRunField(runId, 'errMsg', message);
}

module.exports = {
  getRunById,
  removeRun,
  getRunStatusFromData,
  createRun,
  changeState,
  setOutput,
  appendOutput,
  setErrMessage,
  appendErrMessage,
  existsRun,
  changeRunData,
};
