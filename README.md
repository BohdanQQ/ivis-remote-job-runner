# IVIS Remote Job Runner

## Tests

To run tests, execute `npm test`.



## Setup

Create `cert` folder in the project root. In this folder, create files:

* `ca.cert` - CA certificate
* `rjr.cert` - executor certificate
* `rjr.pem` - executor key

### Normal setup
Check (and edit) the `config/default.yml` config file and the `nginx.conf` file. 

Finally use `docker compose` to run the container:

    docker compose up --build

### Development version

Check (and edit) the `config/default.yml` config file and the `nginx.conf` file. 

Finally use `docker compose` to run the container:

    docker compose -f ./docker-compose-dev.yml up --build