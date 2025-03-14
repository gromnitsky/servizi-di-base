port=3011
host=127.0.0.1
pidfile=server.pid

trap stop 0

stop() {
    ps --forest -o pid= -g "`cat "$pidfile"`" | xargs -r kill
    rm -f server.pid
    [ "$DEBUG" ] || rm -rf jobs
    echo
}

start() {
    rm -f cookies.txt
    daemonize -c "`pwd`" -p "$pidfile" -E PORT=$port \
              "`readlink -f ../server.js`"
    VERBOSE=0 try_for_2_sec "failed to start $host:$port" ncat -z $host $port
}

try_for_2_sec() {
    local msg="$1"
    shift
    timeout 2 sh -c "while ! $*; do
[ \"$VERBOSE\" = 0 ] || printf →; sleep 0.1;
done" || errx "$msg"
}

errx() { echo "FAILED: $*" 1>&2; exit 1; }

grep_2_patterns() {
    awk -vp1="$1" -vp2="$2" '$0 ~ p1 || $0 ~p2 { m+=1 } END {exit m != 2}'
}
