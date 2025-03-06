#!/usr/bin/env node

import http from 'http'
import fs from 'fs'
import path from 'path'
import busboy from 'busboy'
import child_process from 'child_process'

function error(writable, status, err, text) {
    let msg = err.message || err
    if (!writable.headersSent) {
        writable.statusCode = status
        try {
            writable.setHeader('Content-Type', 'text/plain; charset=utf-8')
            writable.statusMessage = msg
        } catch {/**/}
    }
    let body = `HTTP ${status}: ${msg}`
    if (text) body = [body, "\n\n", text].join``
    writable.end(body)
}

function detect_program(url) {
    return {
        exe: url.pathname.split('/')[1],
        opt: Array.from(url.searchParams).map( ([k, v]) => [`-${k}`, v]).flat()
    }
}

function job_dir() {
    try { fs.mkdirSync('jobs') } catch (_) { /**/ }
    return fs.mkdtempSync(path.join('jobs', path.sep))
}

function job_create(req, res, url) {
    let prog = detect_program(url)
    if (!fs.existsSync(prog.exe)) return error(res, 500, 'no such service')

    let bb, dir
    try {
        bb = busboy({
            headers: req.headers,
            limits: {
                fileSize: 1024*1024*10,
                files: 5
            }
        })
    } catch (e) {
        return error(res, 412, e)
    }

    try { dir = job_dir() } catch (e) { return error(res, 500, e) }

    let files = []

    bb.on('file', (_name, file, _info) => {
        let save_to = path.join(dir, `payload.${files.length + 1}`)
        files.push(path.basename(save_to))
        // FIXME: check for errors
        file.pipe(fs.createWriteStream(save_to))
    })

    bb.on('close', () => {
        try {
            job_run(dir, prog.exe, prog.opt, files)
        } catch (e) {
            return error(res, 500, e)
        }
        res.end(dir)
    })

    // FIXME: listen to filesLimit (too many) and limit (file size)

    req.pipe(bb)
}

function job_run(dir, exe, opt, args) {
    exe = path.resolve(exe)
    args = opt.concat(args)
    let errorfile = path.join(dir, 'error')
    let pidfile = path.join(dir, 'pid')

    let child = child_process.execFile(exe, args, {cwd: dir}, err => {
        if (err) return fs.writeFileSync(errorfile, err.toString())
        // indicate the job is finished
        try { fs.unlinkSync(pidfile) } catch (_) { /**/ }
    })

    if (child.pid != null)
        fs.writeFileSync(pidfile, child.pid.toString())
}

function dir_meta_files(dir) {
    return ['error', 'pid', 'log', 'result'].reduce( (acc, cur) => {
        acc[cur] = path.join(dir, cur)
        return acc
    }, {})
}

function job_results(res, dir) {
    if (!fs.existsSync(dir)) return error(res, 404, 'job not found')

    let meta = dir_meta_files(dir)
    let r

    //  errors are short, no need to make a stream
    try { r = fs.readFileSync(meta.error) } catch (_) { /**/ }
    if (r) return error(res, 500, r)

    let log_check = msg => {
        let s = fs.createReadStream(meta.log)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        s.on('error', () => res.end(msg))
        s.pipe(res)
    }

    try { r = fs.readFileSync(meta.pid) } catch (_) { /**/ }
    if (r) { // job is running
        res.statusCode = 418
        log_check('job not ready')

    } else {
        if (fs.existsSync(meta.result)) {
            let s = fs.createReadStream(meta.result)
            res.setHeader('Content-Type', 'application/octet-stream')

            s.on('error', err => {
                error(res, 500, err)
            }).on('close', () => {
                fs.rm(dir, {recursive: true, force: true}, () => {})
            })

            s.pipe(res)

        } else { // job finished unsuccessfully
            res.statusCode = 500
            log_check('job failed w/o logs')
        }
    }
}

if (process.argv[2]) process.chdir(process.argv[2])

http.createServer( (req, res) => {
    console.error(req.method, req.url)

    let url = new URL(`http://example.com${req.url}`)

    if (req.method === 'GET' && /^\/jobs\/[a-zA-Z0-9]{6,}$/.test(url.pathname)){
        job_results(res, url.pathname.slice(1))
    } else if (req.method === 'POST') {
        job_create(req, res, url)
    } else {
        error(res, 400, 'Invalid Request')
    }

}).listen({port: process.env.PORT || 3000})

console.error('CWD:', process.cwd())
console.error('PID:', process.pid)
