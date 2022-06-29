#!/bin/bash

bash ./setup/setupIVISPck.sh

if [ "$#" -eq 1 ]; then
    npm run watch-docker
else
    node src/index.js
fi