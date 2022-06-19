const {
  TID_COLUMN, TYPE_COLUMN, SUBTYPE_COLUMN, HASH_COLUMN, CACHE_TABLE, getHash,
} = require('./shared');

exports.seed = (knex) => knex(CACHE_TABLE).del()
  .then(() => knex(CACHE_TABLE).insert([
    {
      [TID_COLUMN]: 0,
      [TYPE_COLUMN]: 'type0',
      [SUBTYPE_COLUMN]: 'subtype0',
      [HASH_COLUMN]: getHash('task0'),
    },
    {
      [TID_COLUMN]: 1,
      [TYPE_COLUMN]: 'type0',
      [SUBTYPE_COLUMN]: 'subtype0',
      [HASH_COLUMN]: getHash('task1'),
    },
    {
      [TID_COLUMN]: 2,
      [TYPE_COLUMN]: 'type1',
      [SUBTYPE_COLUMN]: 'subtype1',
      [HASH_COLUMN]: getHash('task2'),
    },
  ]));
