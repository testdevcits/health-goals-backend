let io = null;

function setIo(server) { io = server; }
function getIo() { return io; }

module.exports = { setIo, getIo };
