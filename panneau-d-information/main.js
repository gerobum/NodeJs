var express = require('express');
var app = express();
var server = require('http').createServer(app),
        io = require('socket.io').listen(server),
        ent = require('ent'), // Permet de bloquer les caractères HTML (sécurité équivalente à htmlentities en PHP)
        fs = require('fs'),
        session = require('cookie-session'),
        bodyParser = require('body-parser'),
        ChronoMessage = require('./js/ChronoMessage').ChronoMessage,
        Horaire = require('./js/ChronoMessage').Horaire,
        urlencodedParser = bodyParser.urlencoded({extended: false});

function newDayPurge() {
    var liste = [];
    fs.readFile('lperm', 'utf8', (err, data) => {
        if (err) {
            console.log("Erreur de lecture du fichier lperm lors de la purge");
        } else {
            try {
                liste = JSON.parse(data);
                fs.readFile('lfutur', 'utf8', (err, data) => {
                    if (err) {
                        console.log("Erreur de lecture du fichier lfutur lors de la purge");
                    } else {
                        try {
                            var s = new Set(JSON.parse(data));
                            var date = JSON.stringify(new Date()).substring(1);
                            s.append(liste);
                            liste = s.toArray();
                            writeList('lperm', liste.filter(c => c.date === null ||
                                        c.date.substring(0, 10) === date.substring(0, 10))
                                    .sort(function (c1, c2) {
                                        return (c1.debut.h * 60 + c1.debut.m) - (c2.debut.h * 60 + c2.debut.m);
                                    }));

                            writeList('lfutur', liste.filter(c => c.date !== null &&
                                        c.date.substring(0, 10) > date.substring(0, 10)));
                        } catch (e) {
                            console.log("Erreur de chargement de la liste " + e);
                        }
                    }
                });
            } catch (e) {
                console.log("Erreur de chargement de la liste " + e);
            }
        }
    });
}
/*
 * Execute a function everyday at hnext if n == 0
 *                   or n days at hnext if n > 0
 * If rebour then
 *     
 * @param {type} hnext
 * @param {type} afunction
 * @param {type} n
 * @returns {undefined}
 */
function schedule(hnext, afunction, n = null, retro = true, arg = null) {
    var now = new Date();
    var hnow = new Horaire(now.getHours(), now.getMinutes());
    var timeout;
    if (hnow < hnext) {
        timeout = (hnext - hnow) * 60 * 1000;
    } else {
        if (retro)
            timeout = (24 * 60 + (hnext - hnow)) * 1000 * 60;
        else
            timeout = 0;
    }
    if (n === null) {
        setTimeout(() => {
            afunction(arg);
            schedule(hnext, afunction, null, retro, arg);
        }, timeout);
    } else if (n > 0) {
        setTimeout(() => {
            afunction(arg);
            schedule(hnext, afunction, n - 1, retro, arg);
        }, timeout);
}
}

Set.prototype.append = function (s) {
    for (let e of s) {
        this.add(e);
    }
};

Set.prototype.toArray = function () {
    var r = [];
    for (let e of this) {
        r.push(e);
    }
    return r;
};

function readLperm() {
    fs.readFile('lperm', 'utf8', (err, data) => {
        if (err) {
            console.log("Erreur de lecture du fichier lperm");
        } else {
            try {
                todolist = JSON.parse(data);
                nettoyageListe();
            } catch (e) {
                console.log("Erreur de chargement de la liste " + e);
            }
        }
    });
}

function readLfutur() {
    console.log('Lecture de lfutur');
    fs.readFile('lfutur', 'utf8', (err, data) => {
        if (err) {
            console.log("Erreur de lecture du fichier lfutur");
        } else {
            try {
                console.log('avant : ' + JSON.stringify(futurlist));
                futurlist = JSON.parse(data);
                console.log('après : ' + JSON.stringify(futurlist));
            } catch (e) {
                console.log("Erreur de chargement de la liste " + e);
            }
        }
    });
}

function writeList(file = 'lperm', list = todolist) {
    fs.writeFile(file, JSON.stringify(list) + '\n', (err) => {
        if (err) {
            console.log("Problème d'écriture dans le fichier lperm");
        }
    });
}

function writeFuturList(newlist) {
    fs.readFile('lfutur', 'utf8', (err, data) => {
        if (err) {
            fs.writeFile('lfutur', JSON.stringify(newlist) + '\n', (err) => {
                if (err) {
                    console.log("Problème d'écriture dans le fichier lfutur");
                }
            });
        } else {
            try {
                futurlist = JSON.parse(data);
                let s = new Set(futurlist);
                s.append(newlist);

                fs.writeFile('lfutur', JSON.stringify(s.toArray()) + '\n', (err) => {
                    if (err) {
                        console.log("Problème d'écriture dans le fichier lfutur");
                    }
                });
            } catch (e) {
                console.log("Erreur de chargement de la liste " + e);
            }
        }
    });
}

Array.prototype.isEqual = function (b) {
    if (this.length !== b.length)
        return false;
    for (let i in this) {
        if (this[i] !== b[i])
            return false;
    }
    return true;
};

function nettoyageListe(socket = null) {

    var date = new Date();
    var jsondate = JSON.stringify(date).substring(1);
    var tjour = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
    var jour = tjour[new Date().getDay()];

    // Attention STRINGIFY gère mal les dates. C'est tout ce que j'ai trouvé,
    // pour l'instant, pour filtrer les dates qui correspondent à aujourd'hui.
    // Comme une date stringifyée s'écrit comme ça : 2017-11-04T22:59:00.000Z
    // afin de comparer la date seule (sans l'heure) je prends la sous-chaîne
    // composée des 10 premières lettres.
    //
    // Par ailleurs, le résultat est une chaine avec des guillements. Il faut
    // enlever le premier, d'où le JSON.stringify(new Date()).substring(1)
    newtodolist = todolist
            .filter(c => {
                try {
                    return new Horaire(date.getHours(), date.getMinutes()) < new Horaire(c.fin.h, c.fin.m);
                } catch (e) {
                    console.log('NettoyageListe (erreur) ' + e);
                    return true;
                }
            })
            .filter(c => ((c.date === null && !c.hasOwnProperty("jour")) ||
                        (c.date === null && (c.hasOwnProperty("jour") && (c.jour === "Tous les jours" || c.jour === jour))) ||
                        (c.date !== null && c.date.substring(0, 10) === jsondate.substring(0, 10))))
            .sort(function (c1, c2) {
                return (c1.debut.h * 60 + c1.debut.m) - (c2.debut.h * 60 + c2.debut.m);
            });

    if (socket !== null && !todolist.isEqual(newtodolist)) {
        todolist = newtodolist;
        newtodolist = null;
        socket.broadcast.emit('update', {todolist: todolist});
        socket.emit('update', {todolist: todolist});
        writeList();
    }
}

// Chargement de la page index.html
app.use(session({secret: 'todotopsecret'}))

        /* S'il n'y a pas de todolist dans la session,
         on en crée une vide sous forme d'array avant la suite */
        .use(function (req, res, next) {
            if (typeof (req.session.todolist) === 'undefined') {
                req.session.todolist = [];
            }
            next();
        })
        .get('/read', function (req, res) {
            res.sendFile(__dirname + '/read.html');
        })
        .get('/write', function (req, res) {
            res.sendFile(__dirname + '/write.html');
        })
        /* Edition du fichier lfutur */
        .get('/editlfutur', function (req, res) {
            res.sendFile(__dirname + '/editlfutur.html');
        })

        /* Supprime un élément de la todolist */
        .get('/write/supprimer/:id', function (req, res) {
            if (req.params.id !== '') {
                todolist(req.params.id, 1);
                req.socket.emit('update', {todolist: todolist});
                req.socket.broadcast.emit('update', {todolist: todolist});
            }
            res.redirect('/write');
        })
        // Pour pouvoir importer des modules dans les clients.        
        .use('/js', express.static('js'))
        // Pour pouvoir afficher des images.        
        .use('/images', express.static('images'))

        /* On redirige vers la todolist si la page demandée n'est pas trouvée */
        .use(function (req, res, next) {
            res.redirect('/read');
        });

var todolist = [];
var futurlist = [];

io.sockets.on('connection', function (socket) {

// Lancement de la purge tous les jours à 5h05.
    schedule(new Horaire(5, 5), newDayPurge);
    setInterval(nettoyageListe, 60*60*1000, socket);
    readLfutur();
    
    // Edition de lfutur
    socket.on('neweditlfutur', function (message) {
        socket.emit('updateeditlfutur', {todolist: futurlist});
    });
    // Supprimer la tâche i
    socket.on('sup_msglfutur', function (i) {
        futurlist.splice(i, 1);
        writeList('lfutur', futurlist);
        socket.emit('updateeditlfutur', {todolist: futurlist});
    });
    
    
    // Une tâche a été ajoutée
    socket.on('change_listlfutur', function (liste) {
        
        futurlist = liste;
        writeList('lfutur', futurlist);
        socket.emit('updateeditlfutur', {todolist: futurlist});
    });

    readLperm();

    // Traitement classique
    socket.on('new', function (message) {
        socket.broadcast.emit('update', {todolist: todolist});
        socket.emit('update', {todolist: todolist});
    });
    // Une tâche a été ajoutée
    socket.on('change_list', function (liste) {
        var tjour = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
        var jour = tjour[new Date().getDay()];
        var date = JSON.stringify(new Date()).substring(1);
        var newtodolist = liste
                .filter(c => ((c.date === null && !c.hasOwnProperty("jour")) ||
                            (c.date === null && (c.hasOwnProperty("jour") && (c.jour === "Tous les jours" || c.jour === jour))) ||
                            (c.date !== null && c.date.substring(0, 10) === date.substring(0, 10))))
                .sort(function (c1, c2) {
                    return (c1.debut.h * 60 + c1.debut.m) - (c2.debut.h * 60 + c2.debut.m);
                })
                ;

        // Les nouveaux éléments de la liste.
        // Indique les événements à générer pour supprimer les nouveaux messages.
        newtodolist.forEach(a => {
            var i = 0;
            while(i < todolist.length && (todolist[i].message !== a.message)) {
                ++i;
            }
            if (i === todolist.length || (i < todolist.length && todolist[i].fin.valueOf() !== a.fin.valueOf())) {              
                schedule(new Horaire(a.fin.h, a.fin.m), nettoyageListe, 1, false, socket);
            }
        });
        todolist = newtodolist;


        writeList();
        writeFuturList(liste.filter(c =>
            (c.date !== null && c.date.substring(0, 10) > date.substring(0, 10)) ||
                    c.date === null
        ));

        socket.emit('update', {todolist: todolist});
        socket.broadcast.emit('update', {todolist: todolist});
    });
    // Supprimer la tâche i
    socket.on('sup_msg', function (i) {
        todolist.splice(i, 1);
        writeList();
        socket.emit('update', {todolist: todolist});
        socket.broadcast.emit('update', {todolist: todolist});
    });
});

server.listen(8080);