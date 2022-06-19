// Update with your config settings.

const env = process.env.NODE_ENV || 'normal';

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  normal: {
    client: 'sqlite3',
    connection: {
      filename: `${__dirname}/../data/db.db`,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: `${__dirname}/../data/migrations`,
    },
    useNullAsDefault: true,
  },
  test: {
    client: 'sqlite3',
    connection: {
      filename: `${__dirname}/../data/test/test.db`,
    },
    migrations: {
      tableName: 'knex_migrations',
      directory: `${__dirname}/../data/migrations`,
    },
    seeds: {
      directory: `${__dirname}/../data/seed`,
    },
    useNullAsDefault: true,
  },
}[env];
