const express = require('express');
const run = require('./routes/run');
const task = require('./routes/task');

let app;

function buildApp() {
  app = express();
  app.use(express.json());
  app.post('/run/:run_id', run.buildAndRun);
  app.delete('/run/:run_id', run.deleteRun);
  app.post('/run/:run_id/stop', run.stopRun);
  app.get('/run/:run_id', run.runStatus);
  app.delete('/task/:task_id', task.deleteTask);
  return app;
}

module.exports = buildApp;
