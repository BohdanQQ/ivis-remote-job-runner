const RemoteRunState = {
  SUCCESS: 0,
  BUILD_FAIL: 1,
  RUN_FAIL: 2,
  RUNNING: 3,
  QUEUED: 4,
};

const HandlerMsgType = {
  BUILD: 0,
  RUN: 1,
  STOP: 2,
};

const PushType = {
  STATE_UPDATE: 0, // TODO: only emit? (no? - what if IVIS-core adds standalone even types - !!! possible overlap !!!)
  EMIT: 1,
};

module.exports = {
  RemoteRunState,
  HandlerMsgType,
  PushType,
};
