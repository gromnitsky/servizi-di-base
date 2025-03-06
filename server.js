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

function job_rmdir(dir) {
    fs.rm(dir, {recursive: true, force: true}, () => {})
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
                files: 2
            }
        })
    } catch (e) {
        return error(res, 412, e)
    }

    try { dir = job_dir() } catch (e) { return error(res, 500, e) }

    let files = []
    let payload_failed = false

    bb.on('file', (_name, file, _info) => {
        let save_to = path.join(dir, `payload.${files.length}`)
        //save_to = `/LOL`
        files.push(path.basename(save_to))

        let s = fs.createWriteStream(save_to)
        s.on('error', err => {
            console.error(`${dir}:`, err.message)
            payload_failed = err
            bb.destroy()
        })

        file.on('error', err => {
            payload_failed = err
        }).on('limit', () => {
            payload_failed = new Error('file is too big')
        }).pipe(s)

    }).on('filesLimit', () => {
        payload_failed = new Error('too many files')
    }).on('error', err => {
        payload_failed = err
    }).on('close', () => {
        if (payload_failed) {
            error(res, 413, payload_failed)
            return job_rmdir(dir)
        }

        try {
            job_run(dir, prog.exe, prog.opt, files)
        } catch (e) {
            return error(res, 500, e)
        }
        res.end(dir)
    })

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
        fs.unlink(pidfile, () => {})
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

    // 'error' file contains a short message from
    // child_process.execFile, no need to make a stream
    let r
    try { r = fs.readFileSync(meta.error) } catch (_) { /**/ }
    if (r) return error(res, 500, r)

    let log_check = msg => {
        let s = fs.createReadStream(meta.log)
        res.setHeader('Content-Type', 'text/plain; charset=utf-8')
        s.on('error', () => res.end(msg))
        s.pipe(res)
    }

    if (fs.existsSync(meta.pid)) { // job is still running
        res.statusCode = 418
        log_check('job is running')

    } else {
        if (fs.existsSync(meta.result)) {
            let s = fs.createReadStream(meta.result)
            res.setHeader('Content-Type', 'application/octet-stream')

            s.on('error', err => error(res, 500, err))
                .on('close', () => job_rmdir(dir))

            s.pipe(res)

        } else { // job finished, but unsuccessfully
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
        error(res, 400, 'invalid request')
    }

}).listen({port: process.env.PORT || 3000})

console.error('CWD:', process.cwd())
console.error('PID:', process.pid)
