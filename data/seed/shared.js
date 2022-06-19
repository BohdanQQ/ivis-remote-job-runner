const TID_COLUMN = 'task_id';
const TYPE_COLUMN = 'type';
const SUBTYPE_COLUMN = 'subtype';
const HASH_COLUMN = 'code_hash';
const CACHE_TABLE = 'task_build_cache';
const HASH_INPUT_ENCODING = 'utf-8';
const HASH_OUTPUT_ENCODING = 'hex';

const crypto = require('crypto');

function getHash(str) {
  return crypto.createHash('sha512').update(str, HASH_INPUT_ENCODING).digest(HASH_OUTPUT_ENCODING);
}

module.exports = {
  TID_COLUMN, TYPE_COLUMN, SUBTYPE_COLUMN, HASH_COLUMN, CACHE_TABLE, getHash, seed: () => {},
};
