#!/usr/bin/env bash

. helpers.sh

start

printf .
curl -sfi $host:$port | head -10 | grep -q '^HTTP/1.1 400' || errx "/ must return 400"

printf .
curl -sfi $host:$port/missing -X POST | grep -q '^HTTP/1.1 404' || errx "/missing must return 404"

printf .
curl -sfi $host:$port/missing -F a=@/dev/null | grep -q '^HTTP/1.1 404' || errx "/missing must return 404"

printf .
curl -sfi $host:$port/hello -F a=@/dev/null | grep -q '^HTTP/1.1 200' || errx "/hello with a payload must return 200"

printf .
job=`curl -sf $host:$port/hello -F a=@/dev/null`
echo "$job" | grep -qE '^jobs/.+$' || "/hello must return a job id: jobs/XXXXXX"

printf .
curl -sf $host:$port/"$job" | grep -qx world || errx "/hello must return 'world'"

echo
