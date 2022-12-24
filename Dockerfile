FROM node:16-alpine
RUN apk add --no-cache python3 py3-pip bash curl
WORKDIR /opt/ivis-remote

COPY package*.json ./
RUN npm install
RUN npm install sqlite3

COPY . /opt/ivis-remote
ENTRYPOINT [ "./setup/docker-entry.sh" ]