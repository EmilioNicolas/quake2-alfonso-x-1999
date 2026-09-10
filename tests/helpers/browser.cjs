const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class BrowserEvent {
    constructor(type, properties = {}) {
        Object.assign(this, { type, bubbles: false, defaultPrevented: false }, properties);
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() { this.propagationStopped = true; }
}

function createBrowser({ mobile = false, globals = {} } = {}) {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const events = [];
    class Element {
        constructor(id = '') {
            this.id = id;
            this.style = {};
            this.value = '';
            this.textContent = '';
            this.disabled = false;
            this.children = [];
            this.attributes = {};
            this.listeners = new Map();
            this.capturedPointers = new Set();
            const classes = new Set();
            this.classList = {
                add: (...names) => names.forEach(name => classes.add(name)),
                remove: (...names) => names.forEach(name => classes.delete(name)),
                contains: name => classes.has(name)
            };
        }
        addEventListener(type, callback, options = {}) {
            const listeners = this.listeners.get(type) || [];
            listeners.push({ callback, once: options.once });
            this.listeners.set(type, listeners);
        }
        removeEventListener(type, callback) {
            this.listeners.set(type, (this.listeners.get(type) || []).filter(listener => listener.callback !== callback));
        }
        dispatchEvent(event) {
            if (!event.target) event.target = this;
            event.currentTarget = this;
            if (this.id === 'canvas') events.push(event);
            for (const listener of [...(this.listeners.get(event.type) || [])]) {
                if (listener.once) this.removeEventListener(event.type, listener.callback);
                listener.callback.call(this, event);
            }
            const handler = this['on' + event.type];
            if (typeof handler === 'function') handler.call(this, event);
            if (event.bubbles && !event.propagationStopped && this.parentNode) this.parentNode.dispatchEvent(event);
            return !event.defaultPrevented;
        }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        remove() {
            if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        }
        getAttribute(name) { return this.attributes[name] ?? null; }
        setAttribute(name, value) { this.attributes[name] = String(value); }
        removeAttribute(name) { delete this.attributes[name]; }
        getBoundingClientRect() { return this.bounds || { left: 0, top: 0, width: 800, height: 400 }; }
        setPointerCapture(id) { this.capturedPointers.add(id); }
        hasPointerCapture(id) { return this.capturedPointers.has(id); }
        releasePointerCapture(id) {
            if (this.capturedPointers.delete(id)) this.dispatchEvent(new BrowserEvent('lostpointercapture', { pointerId: id, pointerType: 'touch' }));
        }
        focus() { document.activeElement = this; }
        click() { this.dispatchEvent(new BrowserEvent('click', { bubbles: true })); }
    }
    const document = new Element('document');
    document.hidden = false;
    document.pointerLockElement = null;
    document.body = new Element('body');
    document.body.parentNode = document;
    document.documentElement = new Element('html');
    const elements = new Map();
    for (const match of html.matchAll(/\bid="([^"]+)"/g)) {
        if (!elements.has(match[1])) elements.set(match[1], new Element(match[1]));
    }
    const weapons = [...html.matchAll(/class="weapon-btn" data-key="(\d+)"/g)].map(match => {
        const button = new Element();
        button.attributes['data-key'] = match[1];
        return button;
    });
    for (const element of [...elements.values(), ...weapons]) element.parentNode = document;
    document.getElementById = id => elements.get(id) || null;
    document.querySelectorAll = selector => selector === '.weapon-btn' ? weapons : [];
    document.createElement = tagName => Object.assign(new Element(), { tagName: tagName.toUpperCase() });
    const timers = new Map();
    let nextTimer = 1;
    const windowEvents = new Element('window');
    const context = {
        document,
        navigator: { userAgent: mobile ? 'Android' : 'Desktop' },
        innerWidth: mobile ? 800 : 1280,
        innerHeight: mobile ? 400 : 720,
        location: { reload() {}, pathname: '/', href: '/' },
        screen: { orientation: { lock: () => Promise.resolve() } },
        console: { log() {}, warn() {}, error() {} },
        Event: BrowserEvent,
        KeyboardEvent: BrowserEvent,
        MouseEvent: BrowserEvent,
        performance: { now: () => 1000 },
        Uint8Array, Blob, URL, Response, AbortController, TextEncoder,
        fetch: async () => { throw new Error('Unexpected network request in test'); },
        alert() {},
        setTimeout(callback, delay) {
            const id = nextTimer++;
            timers.set(id, { callback, delay });
            return id;
        },
        clearTimeout(id) { timers.delete(id); },
        addEventListener: windowEvents.addEventListener.bind(windowEvents),
        removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
        dispatchEvent: windowEvents.dispatchEvent.bind(windowEvents),
        ...globals
    };
    context.window = context;
    document.parentNode = windowEvents;
    vm.createContext(context);
    const inlineScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(match => match[1]).join('\n');
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../../mobile-runtime.js'), 'utf8'), context, { filename: 'mobile-runtime.js' });
    vm.runInContext(inlineScript, context, { filename: 'index.html' });
    function runTimer(id) {
        const timer = timers.get(id);
        if (!timer) return;
        timers.delete(id);
        return timer.callback();
    }
    return {
        context, window: context, document, elements, events, timers,
        element: id => document.getElementById(id),
        runTimer,
        runTimers() { for (const id of [...timers.keys()]) runTimer(id); }
    };
}

module.exports = { createBrowser, BrowserEvent };
