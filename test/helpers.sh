port=3011
host=127.0.0.1
pidfile=server.pid

trap stop 0

stop() {
    ps --forest -o pid= -g "`cat "$pidfile"`" | xargs -r kill
    rm -rf server.pid
}

start() {
    rm -f cookies.txt
    daemonize -c "`pwd`" -p "$pidfile" -E PORT=$port \
              "`readlink -f ../server.js`"
    timeout 2 sh -c "while ! ncat -z $host $port; do sleep 0.1; done" ||
        errx "failed to connect to $host:$port"
}

errx() { echo "FAILED: $*" 1>&2; exit 1; }

grep_2_patterns() {
    awk -vp1="$1" -vp2="$2" '$0 ~ p1 || $0 ~p2 { m+=1 } END {exit m != 2}'
}
