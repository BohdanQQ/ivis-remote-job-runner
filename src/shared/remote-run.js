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

module.exports = {
  RemoteRunState,
  HandlerMsgType,
};
