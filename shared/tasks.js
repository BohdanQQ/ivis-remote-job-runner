const defaultSubtypeKey = '__default__';

const PythonSubtypes = {
  ENERGY_PLUS: 'energy_plus',
  NUMPY: 'numpy',
  PANDAS: 'pandas',
};

const TaskType = {
  PYTHON: 0,
};

const PYTHON_JOB_FILE_NAME = 'job.py';

const defaultPythonLibs = ['elasticsearch6', 'requests'];
const taskSubtypeSpecs = {
  [defaultSubtypeKey]: {
    libs: [...defaultPythonLibs],
  },
  [PythonSubtypes.ENERGY_PLUS]: {
    libs: [...defaultPythonLibs, 'eppy', 'requests'],
  },
  [PythonSubtypes.NUMPY]: {
    libs: [...defaultPythonLibs, 'numpy', 'dtw'],
  },
  [PythonSubtypes.PANDAS]: {
    libs: [...defaultPythonLibs, 'pandas'],
  },
};

const BUILD_DIR_PATH = `${__dirname}/../files`;

const JobMsgType = {
  STORE_STATE: 'store_state',
  CREATE_SIGNALS: 'create_signals',
};

const STATE_FIELD = 'state';

module.exports = {
  taskSubtypeSpecs,
  PYTHON_JOB_FILE_NAME,
  PythonSubtypes,
  defaultSubtypeKey,
  JobMsgType,
  STATE_FIELD,
  TaskType,
  BUILD_DIR_PATH,
};
