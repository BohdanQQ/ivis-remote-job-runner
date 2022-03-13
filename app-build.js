"use strict";
const config = require('./lib/config');
const runJob = require('./routes/run');
const stopJob = require('./routes/stop');
const getStatus = require('./routes/status');

function buildApp(app) {
    app.post('/run', runJob);
    app.delete('/run', stopJob);
    app.get('/run', getStatus);
}

module.exports = buildApp;