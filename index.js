const exec = require('child_process').exec;
const express = require('express');
const fs = require('fs');
const path = require('path');

let Rollbar;
let rollbar;
try {
    Rollbar = require('rollbar');
} catch (error) {

}

if (Rollbar) {
    rollbar = new Rollbar({
        accessToken: '006dc99967de4f7a86715216e779d6c3',
        captureUncaught: true,
        environment: 'production',
        captureUnhandledRejections: true
    });
}

const app = express();

app.set('view engine', 'ejs');

const getVersions = async () => {
    return new Promise((resolve, reject) => {
        fs.readdir(path.join(__dirname, 'versions'), {
            encoding: 'utf-8'
        }, (err, files) => {
            if (err) {
                if (rollbar) rollbar.error(err);
                return reject(err);
            }
            resolve(files.map(file => file.replace('.json', '')));
        });
    });
};

const getServerVersion = async () => {
    return new Promise((resolve) => {
        execCmd('git rev-parse HEAD')
            .then(resolve)
            .catch(() => resolve('?'));
    });
};

const getClientVersion = async () => {
    return new Promise((resolve) => {
        execCmd('cd /opt/evnotipi && sudo git rev-parse HEAD')
            .then(resolve)
            .catch(() => resolve('?'));
    });
};

const getVersion = async (version) => {
    return new Promise(async (resolve, reject) => {
        const versions = await getVersions();

        if (!versions.includes(version)) return reject(404);
        fs.readFile(path.join(__dirname, 'versions', `${version}.json`), {
            encoding: 'utf-8'
        }, (err, data) => {
            if (err || !data) {
                if (rollbar) rollbar.error(err || 'no data for version');
                return reject(err);
            }
            resolve(JSON.parse(data));
        });
    });
};

const execCmd = async (cmd) => {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            // some commands unfortunately go to stderr, even if there are no errors..
            // if (err || stderr) {
            //     if (rollbar) rollbar.error(err || stderr);
            //     return reject(err || stderr);
            // }
            resolve(stdout);
        });
    });
};

// GET / -> html -> select versions
app.get('/', async (req, res, next) => {
    try {
        const [
            versions,
            serverVersion,
            clientVersion
        ] = await Promise.all([getVersions(), getServerVersion(), getClientVersion()]);

        res.render('index', {
            versions: versions || [],
            serverVersion: serverVersion || '?',
            clientVersion: clientVersion || '?'
        });
    } catch (error) {
        if (rollbar) rollbar.error(error);
        setTimeout(async () => {
            await execCmd('pm2 flush && pm2 restart all');
            await execCmd('sudo systemctl restart pnpupdater.service');
        }, 3000);
        next(error);
    }
});

// GET /client/status -> status of evnotipi service
app.get('/client/status', async (req, res, next) => {
    try {
        res.send(await execCmd('sudo systemctl status evnotipi.service'));
        if (rollbar) rollbar.info('Client status requested');
    } catch (error) {
        if (rollbar) rollbar.error(error);
        next(error);
    }
});

// POST /update -> git pull updater
app.post('/update', async (req, res, next) => {
    try {
        await execCmd('sudo mount -o remount,rw /');
        await execCmd('git pull');
        await execCmd('npm i');
        await execCmd('sync');
        res.sendStatus(200);
        await execCmd('sudo mount -o remount,ro /');
        if (rollbar) rollbar.info('Server updated');
        await execCmd('pm2 flush && pm2 restart all');
        await execCmd('sudo systemctl restart pnpupdater.service');
    } catch (error) {
        if (rollbar) rollbar.error(error);
        next(error);
    }
});

// POST /update/:version -> update evnotipi with cmd
app.post('/update/:version', async (req, res, next) => {
    let currentCommit;

    try {
        let version;

        await execCmd('sudo mount -o remount,rw /');
        if (!(version = await getVersion(req.params.version))) return res.sendStatus(404);
        currentCommit = await execCmd('cd /opt/evnotipi && sudo git rev-parse HEAD');

        await execCmd('cd /opt/evnotipi && sudo git checkout master && sudo git pull --recurse-submodules');
        await execCmd(`cd /opt/evnotipi && sudo git checkout ${version.commit}`);
        for (const key in version.commands) {
            if (version.commands.hasOwnProperty(key)) {
                const command = version.commands[key];

                await execCmd(command);
            }
        }
        await execCmd('sync');
        await execCmd('sudo systemctl restart evnotipi.service');
        await execCmd('sudo mount -o remount,ro /');
        res.sendStatus(200);
        if (rollbar) rollbar.info('Client updated');
    } catch (error) {
        if (rollbar) rollbar.error(error);
        if (currentCommit) {
            // rollback to last working version
            try {
                await execCmd(`cd /opt/evnotipi && sudo git checkout ${currentCommit}`);
                if (rollbar) rollbar.info('Client update failed, rolled back');
                await execCmd('sync');
                await execCmd('sudo systemctl restart evnotipi.service');
                return next(new Error('Update failed. Rolled back to previous working version'));
            } catch (error) {
                if (rollbar) rollbar.error(error);
                return next(error);
            }
        }
        next(error);
    }
});

app.post('/volatilestorage', async (req, res, next) => {
    await execCmd(`sudo sed -i 's/#Storage=auto/Storage=volatile' /etc/systemd/journald.conf`);
    await execCmd(`sudo sed -i 's/#RuntimeMaxUse=/RuntimeMaxUse=10M' /etc/systemd/journald.conf`);
    res.sendStatus(200);
});

app.listen(3333, () => console.log('[HTTP] Server started on port 3333'));

module.exports = app;
