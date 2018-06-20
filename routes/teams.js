let express = require('express');
let router = express.Router();
let mysql = require('mysql');

let con = mysql.createConnection({
    host: "localhost",
    user: "root",
    password: "",
    database: "TeamFinder"
});

router.get('/*', (req, res, next) => require('../other/security').routeTokenVerification(req, res, next));

router.get('/', function (req, res) {
    if (req.cookies.username) {
        con.query("SELECT * FROM teams WHERE ACTIVE=1  ORDER BY TIMESTAMP DESC", function (err, teams, fields) {
            if (err) throw err;
            teams.forEach((team) => {
                require('../other/security').convertUUIDToBase64(team.ID, (b64) => team.BASE64 = b64);
            });
            res.render('pages/teams', {email: req.cookies.username, tab: '3', posts: teams, term: ''});
        });
    }
    else {
        res.redirect('/login');
    }
});

router.get('/create', function (req, res) {
    if (req.cookies.username) {
        res.render('pages/create-team', {tab: '3'});
    }
    else {
        res.redirect('/login');
    }
});

router.get('/search', function (req, res) {
    res.redirect('/teams');
});

router.get('/search/:searchTerm', function (req, res) {
    if (!req.cookies.username)
        res.redirect('/login');
    let searchFor = '%' + req.params.searchTerm + '%';
    con.query("SELECT * FROM teams WHERE NAME LIKE ?", [searchFor], function (err, result, fields) {
        if (err) throw err;
        res.render('pages/teams', {
            email: req.cookies.username,
            tab: '3',
            posts: result,
            term: req.params.searchTerm
        });
    });
});

router.get('/register', function (req, res) {
    team = req.query;
    con.query("SELECT * FROM teams WHERE NAME = ? LIMIT 1", [team.name], function (err, result, fields) {
        if (err) throw err;
        if (result[0]) {
            res.send({status: "failed, team already exists"});
        }
        else {
            let platforms = [];
            if (team.platforms) {
                platforms = team.platforms;
            }
            require('../other/security').getUUID((uuid) => {
                con.query("INSERT INTO teams (ID, TIMESTAMP, NAME, SUMMARY, HACKATON, SECTION, START_DATE, END_DATE, PLATFORMS, RESOURCE_LINK, NR_MEMBERS, POSTS, LEADER, ACTIVE) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [uuid, Date.now().toString(), team.name, team.summary, team.hackaton, team.section, team.startDate, team.endDate, JSON.stringify(platforms), team.resource_link, team.nrMembers, '', team.leader, 1], function (err, result) {
                    if (err) {
                        socket.emit('register team', {status: JSON.stringify(err)});
                    }
                    res.send({status: "successful"});
                })
            });
        }
    });
});

router.get('/finish', function (req, res) {
    require('../other/security').convertBase64ToUUID(req.query.BASE64, (uuid) => {
        con.query("UPDATE teams SET ACTIVE=0 WHERE ID=?", [uuid], function (err, result) {
            if (err) throw err;
            res.send({status: "successful"});
        })
    });
});

router.get('/update', function (req, res) {
    team = req.query;
    let platforms = [];
    if (team.platforms) {
        platforms = team.platforms;
    }
    require('../other/security').convertBase64ToUUID(team.id, (uuid) => {
        con.query("UPDATE teams SET SUMMARY=?, RESOURCE_LINK=?, PLATFORMS=?, HACKATON=?, SECTION=?, START_DATE=?, END_DATE=? WHERE ID=?", [team.summary, team.resource_link, JSON.stringify(platforms), team.hackaton, team.section, team.startDate, team.endDate, uuid], function (err, result) {
            if (err) throw err;
            res.send({status: "successful"});
        })
    });
});

router.get('/remove-member', (req, res) => {
    let team = req.query.team;
    let members = team.POSTS.trim().substr(0, team.POSTS.length - 1).split(',');
    let index = members.indexOf(req.query.collaborator);
    // console.log(members);
    members.splice(index, 1);
    // console.log(members);
    let newMembers = '';
    members.forEach((member) => newMembers += member + ',');
    require('../other/security').convertBase64ToUUID(team.ID, (uuid) => {
        con.query('UPDATE teams SET POSTS = ? WHERE ID = ?', [newMembers, uuid], (err, result) => {
            if (err) throw err;
            res.send({status: 'successful'})
        })
    });
});

router.get('/:team', function (req, res) {
    if (!req.cookies.username)
        res.redirect('/login');

    if (req.params.team == 'create')
        return;
    require('../other/security').convertBase64ToUUID(req.params.team, (uuid) => {
        con.query("SELECT * FROM teams WHERE ID = ? LIMIT 1", [uuid], function (err, result, fields) {
            if (err) throw err;
            if (result[0]) {
                result[0].BASE64 = req.params.team;
                res.render('pages/team-page', {email: req.cookies.username, tab: '3', team: result[0]});
            }
            else {
                res.render('pages/404.ejs', {
                    message_main: "The team you're looking for does not exist (404)",
                    message_redirect: `Click <a href=\"/teams\">here</a> to go back`,
                    message_page: "Requested team: " + req.params.team
                });
            }
        })
    });
});


router.get('/edit/:team', function (req, res) {
    if (!req.cookies.username)
        res.redirect('/login');

    // console.log('Access teams from page: ' + req.params.team);

    if (req.params.team == 'create')
        return;
    require('../other/security').convertBase64ToUUID(req.params.team, (uuid) => {
        con.query("SELECT * FROM teams WHERE ID = ? LIMIT 1", [uuid], function (err, result, fields) {
            if (err) throw err;
            if (result[0]) {
                if (result[0].LEADER != req.cookies.username) {
                    res.render('pages/404.ejs', {
                        message_main: "You are not allowed to edit the team (403)",
                        message_redirect: `Click <a href=\"/teams/${req.params.team}\">here</a> to go back`,
                        message_page: "Requested team: " + req.params.team
                    });
                } else {
                    result[0].BASE64 = req.params.team;
                    res.render('pages/edit-team', {email: req.cookies.username, tab: '3', team: result[0]});
                }
            }
            else {
                res.render('pages/404.ejs', {
                    message_main: "The team you're looking for does not exist (404)",
                    message_redirect: `Click <a href=\"/teams\">here</a> to go back`,
                    message_page: "Requested team: " + req.params.team
                });
            }
        })
    });
});


module.exports = {url: '/teams', router: router};