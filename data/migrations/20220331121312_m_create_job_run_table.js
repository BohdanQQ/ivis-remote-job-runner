exports.up = (knex) => knex.schema
  .createTable('job_runs', (table) => {
    table.integer('run_id').primary();
    table.string('output', 1000000).notNullable();
    table.string('runData', 1000000).notNullable();
    table.string('errMsg', 1000).notNullable();
  });

exports.down = (knex) => knex.schema.dropTable('job_runs');
