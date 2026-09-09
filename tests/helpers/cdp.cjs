// Dependency-free Chromium DevTools client (Node.js 22+).
const fs = require('node:fs/promises');

async function connect(port = 9366, targetId) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const target = targets.find(target => target.type === 'page' && (!targetId || target.id === targetId));
    if (!target) throw new Error('Open a Chromium page before running the browser checks');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
        socket.onopen = resolve;
        socket.onerror = reject;
    });
    let sequence = 0;
    const pending = new Map();
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
    };
    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = ++sequence;
            const timeout = setTimeout(() => {
                pending.delete(id);
                reject(new Error(`CDP timeout: ${method}`));
            }, 30000);
            pending.set(id, { resolve, reject, timeout });
            socket.send(JSON.stringify({ id, method, params }));
        });
    }
    async function evaluate(expression) {
        const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
        return response.result.value;
    }
    async function screenshot(path) {
        const { data } = await send('Page.captureScreenshot', { format: 'png' });
        await fs.writeFile(path, Buffer.from(data, 'base64'));
    }
    return { send, evaluate, screenshot, targetId: target.id, close: () => socket.close() };
}

module.exports = { connect };
