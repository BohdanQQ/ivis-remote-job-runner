# IVIS Remote Job Runner

## Tests

To run tests, execute `npm test`.

## Development with Docker

prepare the database:

    npx knex migrate:latest

check (and edit) the `config/default.yml` config file 

finally use `docker-compose` to run the container:

    docker-compose -f ./docker-compose-dev.yml up --build