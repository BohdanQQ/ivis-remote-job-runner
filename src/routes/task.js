const { hasParam, isInteger } = require('../lib/util');
const sendTaskRemove = require('../lib/worker-process').sendTaskRemove

function deleteTask(request, response) {
    if (!hasParam('task_id', request, isInteger)) {
        response.status(400);
        response.send('');
        return;
    }

    const taskId = parseInt(request.params.task_id, 10);
    try {
        sendTaskRemove(taskId);
    } catch (ex) {
        response.status(503);
        response.json({
            error: `${ex}`,
        });
    }
    response.status(200);
    response.send('');
    return;
}

module.exports = {
    deleteTask,
};