"use strict";
const config = require('./lib/config');
const express = require('express');
const appBuild = require('./app-build');
const app = express();

function main() {
    const port = config.jobRunner.port;

    appBuild(app);

    app.listen(port, config.jobRunner.hostName, () => {
        console.log(`IVIS Job runner is listening on port ${port}`);
    });
}

try {
    main();
}
catch (err) {
    console.error(err);
}
