#!/bin/bash

set -e

bash /opt/ivis-remote/setup/setupIVISPck.sh
npx knex --knexfile=/opt/ivis-remote/src/knexfile.js migrate:latest

cd /opt/ivis-remote/ 
if [ "$#" -eq 1 ]; then
    npm run watch-docker
else
    node ./src/index.js
fi