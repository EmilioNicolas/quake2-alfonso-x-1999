/* Read-only HUD access through Quake II's public game API v3 (wasm32).
 * Layouts: Qwasm2 src/game/header/game.h and src/common/header/shared.h.
 * These are structure-relative ABI offsets, never absolute heap addresses.
 * Recheck this adapter when replacing the bundled engine/game binaries.
 */
(function(root) {
    'use strict';
    function createQuakeMobileBridge(memory, imports, exports, invokeCommand) {
        const view = () => new DataView(memory()); // memory.grow can replace the buffer
        const valid = (data, pointer, size) => Number.isInteger(pointer) && pointer > 0 &&
            pointer % 4 === 0 && pointer + size <= data.byteLength;
        let data = view();
        if (!valid(data, exports, 80) || data.getInt32(exports, true) !== 3 ||
            !valid(data, imports, 176)) throw new Error('Unsupported Quake II game API');
        const commandIndex = data.getUint32(imports + 42 * 4, true); // gi.AddCommandString
        if (!commandIndex) throw new Error('Missing Quake II command interface');
        return {
            command(text) { invokeCommand(commandIndex, text); },
            readStats() {
                data = view();
                const edicts = data.getUint32(exports + 64, true);
                const stride = data.getInt32(exports + 68, true);
                const count = data.getInt32(exports + 72, true);
                if (stride < 92 || count < 2 || !valid(data, edicts, stride + 92)) return null;
                // This page runs a local single-player server: edict 1 is its player.
                const player = edicts + stride;
                if (!data.getInt32(player + 88, true)) return null; // edict.inuse
                const client = data.getUint32(player + 84, true); // edict.client
                if (!valid(data, client, 184)) return null;
                // gclient starts with player_state_t; stats are 32 signed shorts at 120.
                const stat = index => data.getInt16(client + 120 + index * 2, true);
                if (!stat(0)) return null; // no health icon until player state is ready
                return { health: stat(1), ammo: stat(2) ? stat(3) : null, armor: stat(5) };
            }
        };
    }
    if (typeof module === 'object' && module.exports) module.exports = { createQuakeMobileBridge };
    else root.createQuakeMobileBridge = createQuakeMobileBridge;
})(typeof window === 'undefined' ? globalThis : window);
