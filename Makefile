cmd := `pwd`/server.js examples
server: kill; $(cmd) &
kill:; -pkill -ef "$(cmd)"
