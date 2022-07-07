const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('./config');

function getPathFromConfigPath(urlPath) {
  return path.join(__dirname, '..', '..', urlPath);
}

const certPaths = {
  ca: getPathFromConfigPath(config.ivisCore.CACert),
  cliCert: getPathFromConfigPath(config.jobRunner.clientCert.certPath),
  cliKey: getPathFromConfigPath(config.jobRunner.clientCert.keyPath),
};

const httpsAgent = config.jobRunner.useCertificates ? new https.Agent({
  // directly forces this to be the only certificate authority for upcoming requests
  // this CA takes care of SERVER certificate verification
  ca: fs.readFileSync(certPaths.ca),
  cert: fs.readFileSync(certPaths.cliCert),
  key: fs.readFileSync(certPaths.cliKey),
})
  : null;

if (!config.jobRunner.useCertificates) {
  console.warn('\n\n\n--------------------------------------------------------------------------------------------------------------------------');
  console.warn('\n\n\nWARNING: USING INSECURE HTTP CLIENT - CERTIFICATES ARE IGNORED AND ANYTHING CAN COMMUNICATE WITH THIS MACHINE\n\n\n');
  console.warn('\n\n\n--------------------------------------------------------------------------------------------------------------------------');
}

const instance = config.jobRunner.useCertificates ? axios.create({ httpsAgent }) : axios.create();
module.exports = {
  axiosInstance: instance, certPaths,
};
