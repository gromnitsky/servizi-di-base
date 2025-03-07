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
    let body = `HTTP ${status}: ${msg}\n`
    if (text) body = [body, "\n", text, "\n"].join``
    writable.end(body)
}

function detect_program(url) {
    return {
        exe: url.pathname.split('/')[1],
        opt: Array.from(url.searchParams).flat()
    }
}

function job_dir() {
    fs.mkdirSync('jobs', {recursive: true, mode: 0o700})
    return fs.mkdtempSync(path.join('jobs', path.sep))
}

function job_rmdir(dir) {
    fs.rm(dir, {recursive: true, force: true}, () => {})
}

function job_create(req, res, url) {
    let prog = detect_program(url)
    if (!fs.existsSync(prog.exe)) return error(res, 500, 'no such program')

    let bb, dir
    try { dir = job_dir() } catch (e) { return error(res, 500, e) }
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
            return error(res, 500, 'job_run failed', e)
        }
        res.end(dir + "\n")
    })

    req.pipe(bb)
}

function job_run(dir, exe, opt, args) {
    exe = path.resolve(exe)
    args = opt.concat(args)
    let meta = dir_meta_files(dir)
    let IGNERR = e => console.error(dir, e)

    let log_stream = fs.createWriteStream(meta.log)
    log_stream.on('error', IGNERR)

    let child = child_process.spawn(exe, args, {
        cwd: dir,
        stdio: ['ignore', 'pipe', 'pipe']
    })

    child.stderr.pipe(log_stream)
    child.stdout.pipe(log_stream)

    // removing a pid file is an indicator that the job is finished
    child.on('error', err => {
        fs.writeFile(meta.error, err.toString(), IGNERR)
        fs.unlink(meta.pid, IGNERR)
    }).on('exit', (code, sig) => {
        fs.unlink(meta.pid, IGNERR)
        if (code === 0) return
        let msg = code != null ? `exit code ${code}` : sig
        fs.writeFile(meta.error, msg, IGNERR)
    })

    if (child.pid != null)
        fs.writeFileSync(meta.pid, child.pid.toString())
}

function dir_meta_files(dir) {
    return ['error', 'pid', 'log', 'result'].reduce( (acc, cur) => {
        acc[cur] = path.join(dir, cur)
        return acc
    }, {})
}

function job_result(res, dir) {
    if (!fs.existsSync(dir)) return error(res, 404, 'job not found')

    let meta = dir_meta_files(dir)

    let r
    try { r = fs.readFileSync(meta.error) } catch (_) { /**/ }
    if (r) return error(res, 500, 'job failed', r)

    if (fs.existsSync(meta.pid)) { // job is not finished
        job_log(res, dir, 'job is running')

    } else {
        if (fs.existsSync(meta.result)) {
            let s = fs.createReadStream(meta.result)
            res.setHeader('Content-Type', 'application/octet-stream')

            s.on('error', err => error(res, 500, err))
                .on('close', () => job_rmdir(dir))

            s.pipe(res)

        } else { // job is finished, but unsuccessfully
            res.statusCode = 500
            job_log(res, dir, 'job failed w/o logs')
        }
    }
}

function job_kill(res, dir) {
    if (!fs.existsSync(dir)) return error(res, 404, 'job not found')
    let meta = dir_meta_files(dir)
    let pid
    try { pid = fs.readFileSync(meta.pid) } catch (_) { /**/ }
    pid = parseInt(pid)
    if (isNaN(pid) || pid <= 0) return error(res, 400, `job is not running`)

    try {
        process.kill(pid, 9)    // FIXME: kill all children too
    } catch (err) {
        return error(res, 500, err)
    }

    res.end()
}

function job_log(res, dir, alt_msg) {
    if (!fs.existsSync(dir)) return error(res, 404, 'job not found')
    let meta = dir_meta_files(dir)
    let s = fs.createReadStream(meta.log)
    if (fs.existsSync(meta.pid) && res.statusCode !== 500) res.statusCode = 418
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    s.on('error', () => res.end(alt_msg ? `${alt_msg}\n`: ''))
    s.pipe(res)
}

function request(req, res) {
    console.error(req.method, req.url)

    let url = new URL(`http://example.com${req.url}`)

    if (req.method === 'POST') {
        job_create(req, res, url)
    } else if (req.method === 'GET') {
        if (url.pathname.startsWith('/jobs/')) {
            let s = url.pathname.split('/')
            if (/^[a-zA-Z0-9]{6,20}$/.test(s[2])) {
                let dir = `jobs/${s[2]}`
                let fn = {
                    'result': job_result,
                    'kill'  : job_kill,
                    'log'   : job_log,
                    'logs'  : job_log,
                }[s[3] || 'result']

                if (fn) return fn(res, dir)
            }
        }
        error(res, 400, 'bad request')
    } else {
        error(res, 501, 'not implemented')
    }
}


if (process.argv[2]) process.chdir(process.argv[2])

http.createServer()
    .on('request', request)
    .on('listening', function() {
        let addr = this.address()
        console.error('PID: ', process.pid)
        console.error('CWD: ', process.cwd())
        console.error('ADDR:', `${addr.address}:${addr.port}`)
    }).listen(process.env.PORT || 3000, process.env.HOST || '127.0.0.1')
