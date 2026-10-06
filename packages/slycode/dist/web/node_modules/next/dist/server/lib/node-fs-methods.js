"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "nodeFs", {
    enumerable: true,
    get: function() {
        return nodeFs;
    }
});
const _fs = /*#__PURE__*/ _interop_require_default(require("fs"));
const _nodecrypto = require("node:crypto");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const nodeFs = {
    existsSync: _fs.default.existsSync,
    readFile: _fs.default.promises.readFile,
    readFileSync: _fs.default.readFileSync,
    writeFile: (f, d)=>_fs.default.promises.writeFile(f, d),
    writeFileAtomic: async (f, d)=>{
        const temporary = `${f}.${(0, _nodecrypto.randomUUID)()}.tmp`;
        try {
            await _fs.default.promises.writeFile(temporary, d);
            await _fs.default.promises.link(temporary, f);
            return true;
        } catch (error) {
            if (error.code === 'EEXIST') return false;
            throw error;
        } finally{
            await _fs.default.promises.unlink(temporary).catch(()=>{});
        }
    },
    mkdir: (dir)=>_fs.default.promises.mkdir(dir, {
            recursive: true
        }),
    stat: (f)=>_fs.default.promises.stat(f)
};

//# sourceMappingURL=node-fs-methods.js.map