const config = require('./lib/config');
const appBuild = require('./app-build');
const { log } = require('./lib/log');
const runInit = require('./lib/run').init;
const initWorker = require('./lib/worker-process').init

async function main() {
  log.log('Reseting runs');
  await runInit();
  log.log('Starting Task Handler');
  await initWorker();
  const app = appBuild();

  const host = '0.0.0.0';

  app.listen(config.jobRunner.port, host, () => {
    log.debug(`IVIS Job runner is listening on ${host}:${config.jobRunner.port}`);
  });
}

main();
