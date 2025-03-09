import fs from 'fs'
import path from 'path'

function path_parse() {
    let r = (process.env.PATH || '').split(path.posix.delimiter).filter(Boolean)
    return r.length > 1 ? r : ['/usr/bin', '/bin']
}

function is_exe(file) {
    try { fs.accessSync(file, fs.constants.X_OK) } catch (_) { return }
    return true
}

function is_path(name) {
    return !(-1 === name.indexOf(path.sep) && -1 === name.indexOf('/'))
}

function find(PATH, name) {
    if (is_path(name)) {
        PATH = [path.resolve(path.dirname(name))]
        name = path.basename(name)
    }

    for (let file of PATH.map( v => path.join(v, name))) {
        if (is_exe(file)) return file
    }
}

export default function which(...names) {
    let path = path_parse()
    let r = names.map( v => find(path, v))
    return names.length > 1 ? r : r[0]
}
