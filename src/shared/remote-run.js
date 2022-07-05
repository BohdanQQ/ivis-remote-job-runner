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
  STATE_UPDATE: 0,
  APPEND_OUTPUT: 1,
  EMIT: 2,
};

module.exports = {
  RemoteRunState,
  HandlerMsgType,
  PushType,
};
