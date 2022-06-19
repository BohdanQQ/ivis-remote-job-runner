const crypto = require('crypto');
const knex = require('../lib/knex');

const TID_COLUMN = 'task_id';
const TYPE_COLUMN = 'type';
const SUBTYPE_COLUMN = 'subtype';
const HASH_COLUMN = 'code_hash';
const CACHE_TABLE = 'task_build_cache';

const HASH_INPUT_ENCODING = 'utf-8';
const HASH_OUTPUT_ENCODING = 'hex';

async function isBuildCached(taskId, type, subtype, code) {
  const hashedCode = crypto.createHash('sha512').update(code, HASH_INPUT_ENCODING).digest(HASH_OUTPUT_ENCODING);

  const cacheEntry = await knex(CACHE_TABLE)
    .where(TID_COLUMN, taskId)
    .where(TYPE_COLUMN, type)
    .where(SUBTYPE_COLUMN, subtype)
    .where(HASH_COLUMN, hashedCode)
    .first();

  if (!cacheEntry) {
    return false;
  }

  return true;
}

async function updateBuildCache(taskId, type, subtype, code) {
  return knex.transaction(
    async (t) => {
      const run = await t(CACHE_TABLE).where(TID_COLUMN, taskId).first();
      const diffObj = {};

      diffObj[TYPE_COLUMN] = type;
      diffObj[SUBTYPE_COLUMN] = subtype;
      diffObj[HASH_COLUMN] = crypto.createHash('sha512').update(code, HASH_INPUT_ENCODING).digest(HASH_OUTPUT_ENCODING);

      if (run) {
        await t(CACHE_TABLE).where(TID_COLUMN, taskId).update(diffObj);
        return;
      }

      diffObj[TID_COLUMN] = taskId;

      await t(CACHE_TABLE).insert(diffObj);
    },
  );
}

module.exports = {
  isBuildCached,
  updateBuildCache,
};
