cmd := `pwd`/server.js
server: kill; $(cmd) &
kill:; -pkill -ef "$(cmd)"
