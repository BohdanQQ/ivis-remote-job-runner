const run = require('./routes/run');

function buildApp(app) {
  app.post('/run/:run_id', run.buildAndRun);
  app.delete('/run/:run_id', run.remove);
  app.post('/run/:run_id/stop', run.stop);
  app.get('/run');
}

module.exports = buildApp;
