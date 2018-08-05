let cluster = require('cluster');
global.debug = require('tracer').colorConsole({
    format: ['\x1b[36m{{message}}\x1b[0m (in \x1b[31m{{file}}:{{line}}\x1b[0m)', {
        log: '\x1b[36m{{message}}\x1b[0m (in \x1b[31m{{file}}:{{line}}\x1b[0m)',
        info: '\x1b[32m{{message}}\x1b[0m (in \x1b[31m{{file}}:{{line}}\x1b[0m)',
        error: "\x1b[31m{{message}}\x1b[0m (in \x1b[31m{{file}}:{{line}}\x1b[0m)"
    }]
});

if (cluster.isMaster) {
    let workers = require('os').cpus().length;
    debug.log(`Master cluster setting up ${workers} workers.`);
    for (let i = 0; i < workers; i++) {
        cluster.fork();
    }
    cluster.on('online', function (worker) {
        debug.info(`Worker ${worker.process.pid} is online`);
    });
    cluster.on('exit', function (worker, code, signal) {
        debug.error(`Worker ${worker.process.pid} died with code ${code} and signal ${signal}`);
        cluster.fork();
    })
} else {
    let express = require('express');
    let logger = require('morgan');
    let path = require('path');
    let mysql = require('mysql');
    let cookieParser = require('cookie-parser');
    let bodyParser = require('body-parser');
    let validator = require('express-validator');
    let Ddos = require('ddos');
    let ddos = new Ddos({burst: 20, limit: 30, testmode: true, whitelist: ['localhost', '127.0.0.1']});

    let app = express();
    let server = app.listen(3000, function () {
        debug.info(`Process ${process.pid} is listening to all incoming requests`);
    });


    let connectedUsers = {};
    let connectedSockets = {};
    let io = require('socket.io').listen(server, {
        log: false,
        agent: false,
        origins: '*:*'
    });

    let con = mysql.createConnection({
        host: "localhost",
        user: "root",
        password: "",
        database: "TeamFinder"
    });

//// CHAT TEST REMOVE LATER
    let messagesUsers = {};
    let messagesSockets = {};

    let lastMessage = {};

    app.use(express.static(path.join(__dirname, 'public')));
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({extended: false}));
    app.use(cookieParser());
    app.use(logger('dev'));
    app.use(validator());
    app.use(ddos.express);

    app.use(function (req, res, next) {
        debug.log('Request handled by process ' + process.pid);
        let xss = require('xss')
            , S = require('string');
        req.body = JSON.parse(xss(S(JSON.stringify(req.body)).stripTags().s));
        next();
    });

    io.on('connection', function (socket) {
        //add user to connected list
        socket.emit('request email');
        socket.on('receive email', function (res) {
            if (res.email) {
                connectedUsers[res.email] = socket.id;
                connectedSockets[socket.id] = res.email;
            }
        });
        socket.emit('chat?');
        socket.on('chat!', function (res) {
            if (res.chat) {
                connectedUsers[res.uuid] = {
                    uuid: res.uuid,
                    name: res.name,
                    socket: socket,
                }
            }
        });
        socket.on('send chat', (res) => {
            let to = connectedUsers[res.to_uuid].socket;
            to.emit('receive chat', {from: [res.uuid, res.name], message: res.message});
        });

        socket.on('join room', (req) => {
            //debug.log(`-------USER ${req.user.username}(${req.user.uuid}) REQUESTING TO JOIN ROOM ${req.chat_name} -------`);
            socket.join(req.chat_name);
            io.to(req.chat_name).emit('new user to chat', {text: "has joined the chat", from: req.user.username});
        });

        socket.on('send message', (req) => {
            //debug.log(`-------USER ${req.from.username}(${req.from.uuid}) SENT ${req.text} TO ROOM ${req.to} -------`);
            let time = Date.now();
            con.query("SELECT USERNAME FROM accounts WHERE ID = ?", [req.from.uuid], function (error, result) {
                if (error) throw error;
                con.query("INSERT INTO group_messages (id, from_uuid, from_name, group_uuid, message, timestamp) VALUES (?, ?, ?, ?, ?, ?)", [0, req.from.uuid, result[0].USERNAME, req.to, req.text, time], function (err, resultI) {
                    if (err) throw err;
                    let people = req.participants.trim().substr(0, req.participants.trim().length - 1).split(',');
                    if (lastMessage[req.to]) {
                        debug.log(time);
                        debug.log(lastMessage[req.to]);
                        if (time - lastMessage[req.to] > 120000) {
                            people.forEach((person) => {
                                if (connectedUsers[person]) {
                                    let textToSend = "New message in group " + req.group + " from " + result[0].USERNAME;
                                    io.sockets.connected[connectedUsers[person]].emit('notification', textToSend);
                                    lastMessage[req.to] = time;
                                }
                            });
                        }
                    } else {
                        lastMessage[req.to] = time;
                        people.forEach((person) => {
                            if (connectedUsers[person]) {
                                let textToSend = "New message in group " + req.group + " from " + result[0].USERNAME;
                                io.sockets.connected[connectedUsers[person]].emit('notification', textToSend);
                                lastMessage[req.to] = time;
                            }
                        });
                    }
                    io.to(req.to).emit('send message', {text: req.text, from: req.from, time: time});
                });
            });
        });

        socket.on('request join team', function (req) {
            // debug.log("client " + req.username + " requested to join team " + req.teamName + " of user " + req.leader + " with token " + req.token);
            con.query("SELECT NOTIFICATION FROM accounts WHERE EMAIL = ? LIMIT 1", [req.leader], function (err, result, fields) {
                if (err) throw err;
                if (result) {
                    let notifications = JSON.parse(result[0].NOTIFICATION);
                    let id = req.username;
                    require('./other/security').convertBase64ToUUID(req.teamUUID, (uuid) => id += uuid);
                    id = id.replace('/', '');
                    id = id.replace('@', '');
                    id = id.replace('.', '');
                    id = id.replace(/\s/g, '');
                    let newReq = {
                        "user": req.username,
                        "vis": "false",
                        "type": "team",
                        "name": req.teamName,
                        "id": id
                    };
                    if (connectedUsers[req.leader]) {
                        let textToSend = "User " + newReq.user + " has requested to join " + newReq.type + " " + newReq.name;
                        io.sockets.connected[connectedUsers[req.leader]].emit('notification', textToSend);
                    }
                    let reqtest = JSON.stringify(newReq);
                    let isValid = true;
                    for (let i in notifications) {
                        if (reqtest === JSON.stringify(notifications[i])) {
                            socket.emit('request join team', {status: "already requested"});
                            // debug.log("failed to send request, already exists");
                            isValid = false;
                            break;
                        }
                    }
                    if (isValid) {
                        notifications.push(newReq);
                        let notifTxt = JSON.stringify(notifications);
                        con.query("UPDATE accounts SET NOTIFICATION = ? WHERE EMAIL = ?", [notifTxt, req.leader], function (err, result) {
                            if (err) throw err;
                            if (result.affectedRows == 0) {
                                socket.emit('request join team', {status: "failed"});
                                // debug.log('failed to register request to team leader ' + req.leader + " from user " + req.username + " in team " + req.teamName);
                            } else {
                                // debug.log('succesfully registered request to team leader ' + req.leader + " from user " + req.username + " in team " + req.teamName);
                                socket.emit('request join team', {status: "successful"});
                            }
                        });
                    }
                }
            });
        });

        socket.on('request join project', function (req) {
            // debug.log("client " + req.username + " requested to join project " + req.projectName + " of user " + req.leader + " with token " + req.token);
            con.query("SELECT NOTIFICATION FROM accounts WHERE EMAIL = ? LIMIT 1", [req.leader], function (err, result, fields) {
                if (err) throw err;
                if (result) {
                    let notifications = JSON.parse(result[0].NOTIFICATION);
                    let id = req.username;
                    require('./other/security').convertBase64ToUUID(req.projectUUID, (uuid) => id += uuid);
                    id = id.replace('/', '');
                    id = id.replace('@', '');
                    id = id.replace('.', '');
                    id = id.replace(/\s/g, '');
                    let newReq = {
                        "user": req.username,
                        "vis": "false",
                        "type": "project",
                        "name": req.projectName,
                        "id": id
                    };
                    let newAltReq = {
                        "user": req.username,
                        "vis": "true",
                        "type": "project",
                        "name": req.projectName,
                        "id": id
                    };
                    if (connectedUsers[req.leader]) {
                        let textToSend = "User " + newReq.user + " has requested to join " + newReq.type + " " + newReq.name;
                        io.sockets.connected[connectedUsers[req.leader]].emit('notification', textToSend);
                    }
                    let reqtest = JSON.stringify(newReq);
                    let reqAltTest = JSON.stringify(newAltReq);
                    let isValid = true;
                    for (let i in notifications) {
                        if (reqtest === JSON.stringify(notifications[i]) || reqAltTest === JSON.stringify(notifications[i])) {
                            socket.emit('request join project', {status: "already requested"});
                            // debug.log("failed to send request, already exists");
                            isValid = false;
                            break;
                        }
                    }
                    if (isValid) {
                        notifications.push(newReq);
                        let notifTxt = JSON.stringify(notifications);
                        con.query("UPDATE accounts SET NOTIFICATION = ? WHERE EMAIL = ?", [notifTxt, req.leader], function (err, result) {
                            if (err) throw err;
                            if (result.affectedRows == 0) {
                                socket.emit('request join project', {status: "failed"});
                                // debug.log('failed to register request to team leader ' + req.leader + " from user " + req.username + " in team " + req.teamName);
                            } else {
                                // debug.log('succesfully registered request to team leader ' + req.leader + " from user " + req.username + " in team " + req.teamName);
                                socket.emit('request join project', {status: "successful"});
                            }
                        });
                    }
                }
            });
        });
        socket.on('answer request', function (req) {
            // debug.log("leader " + req.leader);
            con.query("SELECT NOTIFICATION FROM accounts WHERE EMAIL = ?", [req.leader], function (err, result) {
                if (err) throw err;
                // debug.log(req.leader);
                let stringNotif = result[0].NOTIFICATION;
                let notif = JSON.parse(stringNotif);
                for (i in notif) {
                    if (notif[i].id === req.id) {
                        notif[i].vis = "true";
                    }
                }
                stringNotif = JSON.stringify(notif);
                con.query("UPDATE accounts SET NOTIFICATION = ? WHERE EMAIL = ?", [stringNotif, req.leader], function (err2, result2) {
                    if (err2) throw err2;
                    if (result2.affectedRows != 0) {
                        // debug.log('updated notifications for leader');
                        if (req.status === "accept") {
                            let table = req.type + 's';
                            let col;
                            if (table === 'projects')
                                col = 'COLLABORATORS';
                            else col = 'POSTS';
                            con.query("SELECT " + col + " FROM " + table + " WHERE NAME = ?", [req.name], function (err3, result3) {
                                if (err3) throw err3;
                                let coll;
                                if (col == 'POSTS')
                                    coll = result3[0].POSTS;
                                else coll = result3[0].COLLABORATORS;
                                coll = coll + req.requester + ',';
                                con.query("UPDATE " + table + " SET " + col + " = ? WHERE NAME = ?", [coll, req.name], function (err4, result4) {
                                    if (err4) throw err4;
                                    if (result4.affectedRows != 0) {
                                        // debug.log('added requester as colaborator');
                                        socket.emit('answer request', {status: 'successful'});
                                    }
                                });
                            });
                        }
                    }
                });
            });
        });
        socket.on('disconnect', function () {
            // debug.log("Client disconected..." + socket.id + " with email " + connectedSockets[socket.id]);
            delete connectedUsers[connectedSockets[socket.id]];
            // debug.log(JSON.stringify(connectedUsers));
            //remove user from conected list
        });
    });

    app.set('views', path.join(__dirname, 'views'));
    app.set('view engine', 'ejs');

    let routes = require('./routes');
    routes.forEach(item => app.use(item.url, item.router));
    app.get('/logout', function (req, res) {
        // debug.log(req.query.skip);
        if (req.query.skip)
            res.render('pages/logout', {time: 1});
        else
            res.render('pages/logout', {time: 5000});
    });
    app.get('/*', (req, res) => {
        res.render('pages/404.ejs', {
            message_main: "The page you're looking for could not be found (404)",
            message_redirect: `Click <a href=\"/\">here</a> to go back to home`,
            message_page: "Requested page: " + req.url.substr(0)
        })
    });

    // server.listen(3000);
    // debug.log('Server listening on port: 3000');
}