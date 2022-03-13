"use strict";

async function status(request, response) {
    response.json({ msg: 'HELLO' })
}

module.exports = status;