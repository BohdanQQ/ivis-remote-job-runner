const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');
const { taskSubtypeSpecs, PYTHON_JOB_FILE_NAME, defaultPythonLibs } = require('../../shared/tasks');
const ivisConfig = require('../../lib/config').ivisCore;
const { log } = require('../../lib/log');

/** The virtual environment folder for a task */
const ENV_NAME = '.env';
/** The folder containing the IVIS Python package */
const IVIS_PCKG_DIR = path.join(__dirname, '..', '..', 'lib', 'jobs', 'python', 'ivis', 'dist');

function getPackages(subtype) {
  return subtype ? taskSubtypeSpecs[subtype].libs : defaultPythonLibs;
}

// ------------------------
// Job Environment Building
// ------------------------

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
  cmdsChain.push('deactivate');

  return cmdsChain.join(' && ');
}

/**
 * Spawns a process which will initialize the Python task virtual environment and
 * call back
 * @param {string} destDir
 * @param {string} subtype
 * @param {*} onSuccess
 * @param {*} onFail
 * @returns {Promise<void>}
 */
async function buildEnvironment(destDir, subtype, onSuccess, onFail) {
  const virtEnv = spawn(
    getVenvInitScript(subtype, destDir),
    {
      shell: '/bin/bash',
    },
  );

  virtEnv.on('error', async (error) => {
    log.error(error);
    onFail(null, [error.toString()]);
  });

  let output = '';
  [virtEnv.stderr, virtEnv.stdout].forEach((fDescriptor) => {
    fDescriptor.setEncoding('utf-8');
    fDescriptor.on('data', (data) => {
      output += data.toString();
    });
  });

  virtEnv.on('exit', async (code, signal) => {
    try {
      if (code === 0) {
        await onSuccess(null);
      } else {
        await onFail(null, [`Environment build ended with code ${code}, signal ${signal} and the following output (stderr, stdout):\n${output}`]);
      }
    } catch (error) {
      log.error(error);
    }
  });
}

/**
 * Initialize and build task.
 * @param config {*}
 * @param onSuccess Callback on success
 * @param onFail Callback on failed attempt
 * @returns {Promise<void>}
 */
async function init(config, onSuccess, onFail) {
  const { subtype, code, destDir } = config;
  try {
    if (fs.existsSync(destDir)) {
      await fs.promises.rm(destDir, { recursive: true });
    }
    await fs.promises.mkdir(destDir);

    const codeFilePath = path.join(destDir, PYTHON_JOB_FILE_NAME);
    await fs.promises.writeFile(codeFilePath, code);

    await buildEnvironment(destDir, subtype, onSuccess, onFail);
  } catch (error) {
    log.error(error);
    onFail(null, [error.toString()]);
  }
}

// ------------------------
// Job Run Management
// ------------------------

const runningJobProcesses = new Map();

/**
 * @param runId used by stop command
 * @param taskDir Directory with the task
 * @param onEvent
 * @param onSuccess Callback on successful run
 * @param onFail callback on failed run
 * @returns {Promise<void>}
 */
async function run({ runId, taskDir, inputData }, onEvent, onSuccess, onFail) {
  let errorBuffer = '';
  const pythonExec = path.join(taskDir, ENV_NAME, 'bin', 'python');
  const IVIS_MESSAGE_FD = 3;

  try {
    const jobProc = spawn(`${pythonExec} ${PYTHON_JOB_FILE_NAME}`, {
      cwd: taskDir,
      shell: '/bin/bash',
      // exposes the I/O to the parent process
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
    });

    // register listeners on a special file descriptor meant for messaging
    // for more information look into the `helpers.py` IVIS pyhton package file
    const jobOutStream = readline.createInterface({
      input: jobProc.stdio[IVIS_MESSAGE_FD],
    });

    jobOutStream.on('line', (input) => {
      onEvent('request', input)
        .then((msg) => {
          jobProc.stdin.write(`${JSON.stringify(msg)}\n`);
        })
        .catch((err) => {
          errorBuffer += err;
        });
    });

    runningJobProcesses.set(runId, jobProc);

    // Send all configs and params to process on stdin in json format
    jobProc.stdin.write(`${JSON.stringify(inputData)}\n`);

    // Error output is just gathered throughout the run and stored after run is done
    // the error output is used only if the job itself has ended unsuccessfully
    jobProc.stderr.on('data', (data) => {
      errorBuffer += `${data}\n`;
    });

    // Same as with error output
    jobProc.stdout.on('data', (data) => {
      const outputStr = data.toString();
      onEvent('output', outputStr);
    });

    const pipeErrHandler = (err) => {
      errorBuffer += err;
      onEvent('output', err.toString());
      log.error(err);
    };

    [jobProc.stdin, jobProc.stdout, jobProc.stderr, jobProc.stdio[IVIS_MESSAGE_FD]]
      .forEach((fileDescriptor) => fileDescriptor.on('error', pipeErrHandler));

    jobProc.on('error', (err) => {
      log.error(err);
      runningJobProcesses.delete(runId);
      const failMsg = [err.toString(), `Error log:\n${errorBuffer}`].join('\n\n');
      onFail(failMsg);
    });

    jobProc.on('exit', (code, signal) => {
      runningJobProcesses.delete(runId);
      if (code === 0) {
        onSuccess(null);
      } else {
        const failMsg = [`Run failed with code ${code} and signal ${signal}`, `Error log:\n${errorBuffer}`].join('\n\n');
        onFail(failMsg);
      }
    });
  } catch (error) {
    onFail([`${error.toString()}\nWith errors: ${errorBuffer}`]);
  }
}

/**
 * @param runId
 * @returns {Promise<void>}
 */
async function stop(runId) {
  const jobProcess = runningJobProcesses.get(runId);
  if (jobProcess) {
    jobProcess.kill('SIGINT');
  }
}

module.exports = {
  init, run, stop,
};
