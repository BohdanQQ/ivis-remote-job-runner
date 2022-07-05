const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

function getPathFromConfigPath(urlPath) {
  return path.join(__dirname, '..', '..', urlPath);
}

const httpsAgentConfig = {
  cert: fs.readFileSync(getPathFromConfigPath(config.jobRunner.clientCert.certPath)),
  key: fs.readFileSync(getPathFromConfigPath(config.jobRunner.clientCert.keyPath)),
};

if (config.ivisCore.useLocalCA) {
  // directly forces this to be the only certificate authority for upcoming requests
  // this CA takes care of SERVER certificate verification
  httpsAgentConfig.ca = fs.readFileSync(getPathFromConfigPath(config.ivisCore.CACert));
}

const httpsAgent = config.jobRunner.useCertificates ? new https.Agent({
  // directly forces this to be the only certificate authority for upcoming requests
  ca: fs.readFileSync(getPathFromConfigPath(config.ivisCore.CACert)),
  cert: fs.readFileSync(getPathFromConfigPath(config.jobRunner.clientCert.certPath)),
  key: fs.readFileSync(getPathFromConfigPath(config.jobRunner.clientCert.keyPath)),
})
  : new https.Agent({
    rejectUnauthorized: false,
  });

if (!config.jobRunner.useCertificates) {
  console.warn('\n\n\n--------------------------------------------------------------------------------------------------------------------------');
  console.warn('\n\n\nWARNING: USING DANGEROUS VERSION OF HTTPS CLIENT - CERTIFICATES ARE IGNORED AND ANYTHING CAN COMMUNICATE WITH THIS MACHINE\n\n\n');
  console.warn('\n\n\n--------------------------------------------------------------------------------------------------------------------------');
}

const instance = axios.create({ httpsAgent });
module.exports = {
  axiosInstance: instance,
};
