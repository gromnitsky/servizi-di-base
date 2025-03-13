## Reqs

node v22, script(1)

## Usage

The simplest "webhook" script:

~~~
$ cat my-uptime
#!/bin/sh
uptime > result
~~~

Trigger such a script:

~~~
$ curl -si http://127.0.0.1:3000/my-uptime -F a=@/dev/null
HTTP/1.1 100 Continue

HTTP/1.1 200 OK
Date: Mon, 10 Mar 2025 18:27:07 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Content-Length: 12

jobs/Dxh6Wf
~~~

To get the result, use a job id, `jobs/Dxh6Wf` in this case:

~~~
$ curl -si http://127.0.0.1:3000/jobs/Dxh6Wf
HTTP/1.1 200 OK
Content-Type: application/octet-stream
Date: Mon, 10 Mar 2025 18:29:46 GMT
Connection: keep-alive
Keep-Alive: timeout=5
Transfer-Encoding: chunked

 20:27:12 up 13 days,  7:27,  2 users,  load average: 0.20, 0.32, 0.31
~~~

## Reqs for scripts

1. collect all data you want to return in a tmp file, then do an
   atomic:

        $ mv my-tmp-file result

2. your script runs in a temp dir that is automatically deleted once a
   user retrieves `result` file;

3. don't write to `pid` and `log` files (all your stdout/stderr
   automatically goes to `log` file);

4. don't read stdin, it's null;

5. the files the user submits have names like `payload.0`, `payload.1`,
   &c; these names are passed to your script as arguments.

6. do the usual command line arguments parsing; when a user submits

        http://127.0.0.1:3000/my-uptime?-f=1&-b=2

    your script gets 4 distinct arguments `-f`, `1`, `-b`, `2` and
    `payload.0` as the last argument;

7. any other exit code except 0 indicates that your script has failed.

## Server usage

    [HOST=127.0.0.1] [PORT=3000] ./server.js [dir-with-scripts]

If no `dir-with-scripts` is provided the current directory is used.

## Invoking scripts

    $ curl -si http://$HOST:$PORT/script-name -F a=@/dev/null

Even if the remote script doesn't need a payload, an empty file in a
multipart/form-data POST request is required.

To pass any options, use url search params:

    script-name?--foo=bar&--baz=quix

would appear to remote script as 4 arguments `--foo`, `bar`, `--baz`,
`quix`. It's up to the script what to do with them.

Endpoints:

* POST `/script-name`. This returns a job id in the form of
  `jobs/XXXXXX`.
* GET `/jobs/XXXXXX` returns either 200 with the script result, 500 if
  the script failed, 418 if the script is still running, or 404 if the
  job is missing. If you get 200, the job XXXXXX is also removed from
  the server, meaning you can read a successful response only once.
* GET `/jobs/XXXXXX/log` returns either 418 (with the stdout/stderr of
  the script) if the job is pending, or 200 if it's finished.
* GET `/jobs/XXXXXX/kill` sends SIGKILL to the script & its children.

## &#x2672; Loicense

MIT
