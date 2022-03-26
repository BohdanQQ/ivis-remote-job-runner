'use strict';
const path = require('path');
const fs = require('fs');
const spawn = require('child_process').spawn;
const { taskSubtypeSpecs, PYTHON_JOB_FILE_NAME } = require('../../shared/tasks');
const ivisConfig = require('../../lib/config').ivisCore;

/** The virtual environment folder for a task */
const ENV_NAME = '.env';
/** The folder containing the IVIS Python package */
const IVIS_PCKG_DIR = path.join(__dirname, '..', '..', 'lib', 'jobs', 'python', 'ivis', 'dist');

function getPackages(subtype) {
    return subtype ? taskSubtypeSpecs[subtype].libs : defaultPythonLibs;
}

/**
 * Initialize and build task.
 * @param config
 * @param onSuccess Callback on success
 * @param onFail Callback on failed attempt
 * @returns {Promise<void>}
 */
async function init(config, onSuccess, onFail) {
    const { subtype, code, destDir } = config;
    try {
        if (fs.existsSync(destDir))
        {
            await fs.promises.rm(destDir, {recursive: true});
        }
        await fs.promises.mkdir(destDir);
        
        const codeFilePath = path.join(destDir, PYTHON_JOB_FILE_NAME)
        await fs.promises.writeFile(codeFilePath, code);
        
        await buildEnvironment(destDir, subtype, onSuccess, onFail);

    } catch (error) {
        console.error(error);
        onFail(null, [error.toString()]);
    }
}

/**
 * @param {string} subtype 
 * @param {string} destDir 
 * @returns {string} a single command which initializes virtual environment and
 * installs dependencies
 */
function getVenvInitScript(subtype, destDir) {
    const packages = getPackages(subtype);
    const venvDir = path.join(destDir, ENV_NAME);
    const venvActivateScriptPath = path.join(venvDir, 'bin', 'activate');

    const cmdsChain = [];
    cmdsChain.push(`${ivisConfig.venvCmd} ${venvDir}`);
    cmdsChain.push(`. ${venvActivateScriptPath}`);
    if (packages) {
        cmdsChain.push(`pip install ${packages.join(' ')} `);
    }
    cmdsChain.push(`pip install --no-index --find-links=${IVIS_PCKG_DIR} ivis`);
    cmdsChain.push(`deactivate`);

    return cmdsChain.join(' && ');
}

/**
 * Spawns a process which will initialize the Python task virtual environment and
 * call back
 * @param {string} destDir 
 * @param {string} subtype 
 * @param {*} onSuccess
 * @param {*} onFail
 */
async function buildEnvironment(destDir, subtype, onSuccess, onFail) {
    const virtEnv = spawn(
        getVenvInitScript(subtype, destDir),
        {
            shell: '/bin/bash'
        }
    );

    virtEnv.on('error', async (error) => {
        console.error(error)
        onFail(null, [error.toString()]);
    });

    let output = '';
    for (const fDescriptor of [virtEnv.stderr, virtEnv.stdout]) {
        fDescriptor.setEncoding('utf-8');
        fDescriptor.on('data', data => {
            output += data.toString();
        });
    }

    virtEnv.on('exit', async (code, signal) => {
        try {
            if (code === 0) {
                await onSuccess(null);
            } else {
                await onFail(null, [`Environment build ended with code ${code}, signal ${signal} and the following output (stderr, stdout):\n${output}`]);
            }
        } catch (error) {
            console.error(error);
        }
    });
}

module.exports = {
    init
}