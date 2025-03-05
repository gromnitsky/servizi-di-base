#!/usr/bin/env node

import http from 'http'
import fs from 'fs'
import path from 'path'
import busboy from 'busboy'

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

function jobdir() {
    try { fs.mkdirSync('jobs') } catch (_) { /**/ }
    return fs.mkdtempSync(path.join('jobs', path.sep))
}

function program(url) {
    return {
        exe: url.pathname.split('/')[1],
        opt: Array.from(url.searchParams).map( ([k, v]) => [`-${k}`, v]).flat()
    }
}

function jobrun(dir, exe, opt, args) {
}

http.createServer( (req, res) => {
    console.error(req.method, req.url)

    let url = new URL(`http://example.com${req.url}`)

    if (req.method === 'GET' && url.pathname.startsWith('/job/')) {
        res.end('todo')

    } else if (req.method === 'POST') {
        let prog = program(url)
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

        try { dir = jobdir() } catch (e) { return error(res, 500, e) }

        let files = []

        bb.on('file', (_name, file, _info) => {
            let save_to = path.join(dir, `payload.${files.length + 1}`)
            files.push(save_to)
            // FIXME: check for errors
            file.pipe(fs.createWriteStream(save_to))
        })

        bb.on('close', () => {
            try {
                jobrun(dir, prog.exe, prog.opt, files)
            } catch (e) {
                return error(res, 500, e)
            }
            res.end(dir)
        })

        // FIXME: listen to filesLimit (too many) and limit (file size)

        req.pipe(bb)

    } else {
        error(res, 400, 'Invalid Request')
    }

}).listen({port: process.env.PORT || 3000})

console.error(process.pid)
