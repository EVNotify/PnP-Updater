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

// GET /client/status -> status of evnotipi service
app.get('/client/status', async (req, res, next) => {
    try {
        res.send(await execCmd('sudo systemctl status evnotipi.service'));
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
    let currentCommit;

    try {
        let version;

        if (!(version = await getVersion(req.params.version))) return res.sendStatus(404);
        currentCommit = await execCmd('cd /opt/evnotipi && sudo git rev-parse HEAD');

        await execCmd('cd /opt/evnotipi && sudo git checkout master && sudo git pull');
        await execCmd(`cd /opt/evnotipi && sudo git checkout ${version.commit}`);
        for (const key in version.commands) {
            if (version.commands.hasOwnProperty(key)) {
                const command = version.commands[key];

                await execCmd(command);
            }
        }
        res.sendStatus(200);
    } catch (error) {
        if (currentCommit) {
            // rollback to last working version
            try {
                await execCmd(`cd /opt/evnotipi && sudo git checkout ${currentCommit}`);
                return next(new Error('Update failed. Rolled back to previous working version'));
            } catch (error) {
                return next(error);
            }
        }
        next(error);
    }
});

app.listen(3333, () => console.log('[HTTP] Server started on port 3333'));

module.exports = app;