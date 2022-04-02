const path = require('path');
const confUtil = require('config').util;

console.log('Looking for config in:');
console.log(path.join(__dirname, '..', 'config'));

const config = confUtil.loadFileConfigs(path.join(__dirname, '..', 'config'));

module.exports = config;
