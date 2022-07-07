const express = require('express');
const run = require('./routes/run');

let app;

function buildApp() {
  app = express();
  app.use(express.json());
  app.post('/run/:run_id', run.buildAndRun);
  app.delete('/run/:run_id', run.deleteRun);
  app.post('/run/:run_id/stop', run.stopRun);
  app.get('/run/:run_id', run.runStatus);
  return app;
}

module.exports = buildApp;
