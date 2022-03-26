'use strict';

const defaultSubtypeKey = '__default__';

const PythonSubtypes = {
    ENERGY_PLUS: 'energy_plus',
    NUMPY: 'numpy',
    PANDAS: 'pandas'
};

const PYTHON_JOB_FILE_NAME = 'job.py';

const defaultPythonLibs = ['elasticsearch6', 'requests'];
const taskSubtypeSpecs = {
    [defaultSubtypeKey]:{
        libs: [...defaultPythonLibs]
    },
    [PythonSubtypes.ENERGY_PLUS]: {
        libs: [...defaultPythonLibs, 'eppy', 'requests']
    },
    [PythonSubtypes.NUMPY]: {
        libs: [...defaultPythonLibs, 'numpy', 'dtw']
    },
    [PythonSubtypes.PANDAS]: {
        libs: [...defaultPythonLibs, 'pandas']
    }
};

module.exports = {
    taskSubtypeSpecs,
    PYTHON_JOB_FILE_NAME,
    PythonSubtypes,
    defaultSubtypeKey
};