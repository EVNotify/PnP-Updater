const exec = require('child_process').exec;
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

app.set('view engine', 'ejs');

const getVersions = async () => {
    return new Promise((resolve, reject) => {
        fs.readdir(path.join(__dirname, 'versions'), {
            encoding: 'utf-8'
        }, (err, files) => {
            if (err) return reject(err);
            resolve(files.map(file => file.replace('.json', '')));
        });
    });
};

const getVersion = async (version) => {
    return new Promise(async (resolve, reject) => {
        const versions = await getVersions();

        if (!versions.includes(version)) return reject(404);
        fs.readFile(path.join(__dirname, 'versions', `${version}.json`), {
            encoding: 'utf-8'
        }, (err, data) => {
            if (err || !data) return reject(err);
            resolve(JSON.parse(data));
        });
    });
};

const execCmd = async (cmd) => {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err || stderr) return reject(err || stderr);
            resolve(stdout);
        });
    });
};

// GET / -> html -> select versions
app.get('/', async (req, res, next) => {
    try {
        res.render('index', {
            versions: await getVersions()
        });
    } catch (error) {
        next(error);
    }
});

// POST /update -> git pull updater
app.post('/update', async (req, res, next) => {
    try {
        await execCmd('git pull');
        await execCmd('pm2 flush && pm2 restart all');
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
});

// POST /update/:version -> update evnotipi with cmd
app.post('/update/:version', async (req, res, next) => {
    try {
        let version;

        if (!(version = await getVersion(req.params.version))) return res.sendStatus(404);
        // TODO get current commit -> rollback feature
        // TODO checkout commit, pull automatically?
        for (const key in version.commands) {
            if (version.commands.hasOwnProperty(key)) {
                const command = version.commands[key];

                console.log(await execCmd(command));
            }
        }
        res.sendStatus(200);
    } catch (error) {
        next(error);
    }
});

app.listen(3333, () => console.log('[HTTP] Server started on port 3333'));

module.exports = app;