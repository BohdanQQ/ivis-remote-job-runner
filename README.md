# IVIS Remote Job Runner

## Tests

To run tests, execute `npm test`.

## Development with Docker

check (and edit) the `config/default.yml` config file 

finally use `docker-compose` to run the container:

    docker compose -f ./docker-compose-dev.yml up --build

## Setup

Create `cert` folder in the project root. In this folder, create files:

* `ca.cert` - CA certificate
* `rjr.cert` - executor certificate
* `rjr.pem` - executor key

Run TODO