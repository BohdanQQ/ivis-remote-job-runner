#!/bin/bash

bash ./setup/setupIVISPck.sh
npx knex --knexfile=./src/knexfile.js migrate:latest

if [ "$#" -eq 1 ]; then
    npm run watch-docker
else
    node src/index.js
fi