// Update with your config settings.

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  client: 'sqlite3',
  connection: {
    filename: `${__dirname}/data/db.db`,
  },
  migrations: {
    tableName: 'knex_migrations',
    directory: `${__dirname}/data/migrations`,
  },
  useNullAsDefault: true,
};
