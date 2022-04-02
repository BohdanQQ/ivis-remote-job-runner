const run = require('./routes/run');

function buildApp(app) {
  app.post('/run/:rid', run.buildAndRun);
  app.delete('/run/:rid', run.remove);
  app.post('/run/:rid/stop', run.stop);
  app.get('/run');
}

module.exports = buildApp;
