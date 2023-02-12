const crypto = require('crypto');
const knex = require('../lib/knex');

const TID_COLUMN = 'task_id';
const TYPE_COLUMN = 'type';
const SUBTYPE_COLUMN = 'subtype';
const HASH_COLUMN = 'code_hash';
const CACHE_TABLE = 'task_build_cache';

const HASH_INPUT_ENCODING = 'utf-8';
const HASH_OUTPUT_ENCODING = 'hex';

function getCodeHash(codeBuff) {
  return crypto.createHash('sha512').update(codeBuff, HASH_INPUT_ENCODING).digest(HASH_OUTPUT_ENCODING);
}

async function isBuildCached(taskId, type, subtype, codeBuff) {
  const hashedCode = getCodeHash(codeBuff, HASH_INPUT_ENCODING);

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
      const cacheEntry = await t(CACHE_TABLE).where(TID_COLUMN, taskId).first();
      const diffObj = {};

      diffObj[TYPE_COLUMN] = type;
      diffObj[SUBTYPE_COLUMN] = subtype;
      diffObj[HASH_COLUMN] = getCodeHash(code, HASH_INPUT_ENCODING);

      if (cacheEntry) {
        await t(CACHE_TABLE).where(TID_COLUMN, taskId).update(diffObj);
        return;
      }

      diffObj[TID_COLUMN] = taskId;

      await t(CACHE_TABLE).insert(diffObj);
    },
  );
}

async function invalidateBuildCache(taskId) {
  return knex.transaction(
    async (t) => {
      const cacheEntry = await t(CACHE_TABLE).where(TID_COLUMN, taskId).first();
      const diffObj = {};

      diffObj[HASH_COLUMN] = '\0';

      if (cacheEntry) {
        await t(CACHE_TABLE).where(TID_COLUMN, taskId).update(diffObj);
        return;
      }

      diffObj[TID_COLUMN] = taskId;
      diffObj[TYPE_COLUMN] = '\0';
      diffObj[SUBTYPE_COLUMN] = '\0';

      await t(CACHE_TABLE).insert(diffObj);
    },
  );
}

module.exports = {
  isBuildCached,
  updateBuildCache,
  invalidateBuildCache,
};
