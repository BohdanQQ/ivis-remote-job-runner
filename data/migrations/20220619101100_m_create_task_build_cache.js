exports.up = (knex) => knex.schema
  .createTable('task_build_cache', (table) => {
    table.integer('task_id').primary();
    table.string('type', 1000).notNullable();
    table.string('subtype', 1000).notNullable();
    table.string('code_hash', 10000).notNullable();
  });

exports.down = (knex) => knex.schema.dropTable('task_build_cache');
