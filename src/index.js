const config = require('./lib/config');
const appBuild = require('./app-build');
const { log } = require('./lib/log');

function main() {
  const app = appBuild();

  const host = '0.0.0.0';

  app.listen(config.jobRunner.port, host, () => {
    log.debug(`IVIS Job runner is listening on ${host}:${config.jobRunner.port}`);
  });
}

main();
