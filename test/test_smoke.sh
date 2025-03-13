#!/usr/bin/env bash

. helpers.sh

start

echo "job start badly"

printf .
curl -si $host:$port | head -10 | grep -q '^HTTP/1.1 400' || errx "/ must return 400"

printf .
curl -si $host:$port/missing -X POST | grep -q '^HTTP/1.1 404' || errx "/missing must return 404"

printf .
curl -si $host:$port/missing -F a=@/dev/null | grep -q '^HTTP/1.1 404' || errx "/missing must return 404"

printf .
curl -si $host:$port/hello -F a=@/dev/null | grep -q '^HTTP/1.1 200' || errx "POST /hello with a payload must return 200"

printf .
curl -si $host:$port/hello -F a=@/dev/null -F a=@/dev/null -F a=@/dev/null |
    grep -q '^HTTP/1.1 413' || errx "POST /hello with 3 files must be 413"

printf .
head -c $((1024*1024*11)) < /dev/zero > 11M
curl -si $host:$port/hello -F a=@11M |
    grep -q '^HTTP/1.1 413' || errx "POST /hello with 11MB file must be 413"
rm 11M

# ------------------------------------------------------------------------------

printf "\n%s\n" "job start to get a result"

printf .
job=`curl -sf $host:$port/hello -F a=@/dev/null`
echo "$job" | grep -qE '^jobs/.+$' || "/hello must return a job id: jobs/XXXXXX"

printf .
try_for_2_sec "$job/log must contain 'hello'" grep -qx hello$'\r' "$job/log"

printf .
curl -sf $host:$port/"$job" | grep -qx world || errx "/hello must return 'world'"

printf .
try_for_2_sec "$job must not exist" test ! -d "$job"

# ------------------------------------------------------------------------------

printf "\n%s\n" "job lifespan edge cases"

printf .
job=`mktemp -u jobs/XXXXXX`
mkdir "$job"
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 500' 'job failed' ||
    errx "$job must fail"

printf .
touch "$job/result"
chmod 0 "$job/result"
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 500' 'EACCES' ||
    errx "$job result must be unreadable"

printf .
rm -f "$job/result"
touch "$job/pid"
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 418' 'is running' ||
    errx "$job result must be running"

printf .
echo qwerty > "$job/log"
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 418' 'qwerty' ||
    errx "$job result must be running & return its log"

printf .
echo qwerty > "$job/log"
curl -si $host:$port/"$job"/log | grep_2_patterns '^HTTP/1.1 418' 'qwerty' ||
    errx "$job must return its log with 418"

printf .
chmod 0 "$job/log"
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 418' 'is running' ||
    errx "$job log is unreadable hence it must resort to the default message"

# ------------------------------------------------------------------------------

printf "\n%s\n" "job kill"

printf .
curl -si $host:$port/jobs/000000/kill | grep -q '^HTTP/1.1 404' ||
    errx "$job must not exists"

printf .
job=`mktemp -u jobs/XXXXXX`
mkdir "$job"
curl -si $host:$port/"$job"/kill |
    grep_2_patterns '^HTTP/1.1 400' 'not running' ||
    errx "$job must not run"

printf .
job=`curl -sf $host:$port/slow-uptime -F a=@/dev/null`
try_for_2_sec "$job must have a pid file" test -r "$job/pid"

printf .
curl -si $host:$port/"$job"/kill | grep -q '^HTTP/1.1 200' ||
    errx "/$job/kill must return 200"

printf .
try_for_2_sec "$job must not have a pid file" test ! -r "$job/pid"

printf .
curl -si $host:$port/"$job" | grep_2_patterns '^HTTP/1.1 500' '^SIGKILL' ||
    errx "/$job must return 500, for it was killed"

echo
