const async = require('async');
const AWS = require('aws-sdk');
const http = require('http');

// configurable params
const BUCKET = '';
const LISTING_LIMIT = 10000;
const ACCESSKEY = '';
const SECRETKEY = '';
const ENDPOINT = 'http://127.0.0.1:8000';
const QUIET_MODE = false;

AWS.config.update({
    accessKeyId: ACCESSKEY,
    secretAccessKey: SECRETKEY,
    region: "us-east-1",
    sslEnabled: false,
    endpoint: ENDPOINT,
    s3ForcePathStyle: true,
    apiVersions: { s3: '2006-03-01' },
    signatureVersion: 'v4',
    signatureCache: false,
});

const s3 = new AWS.S3({
    httpOptions: {
        maxRetries: 0,
        timeout: 0,
        agent: new http.Agent({ keepAlive: true }),
    },
});

// list object versions
function _listObjectVersions(VersionIdMarker, KeyMarker, cb) {
    s3.listObjectVersions({ Bucket: BUCKET, MaxKeys: LISTING_LIMIT, VersionIdMarker, KeyMarker }, cb);
}

// return object with key and version_id
function _getKeys(keys) {
    return keys.map((v) => ({
        Key: v.Key,
        VersionId: v.VersionId,
    }));
}

function logger (msg, val) {
    if (!QUIET_MODE) {
        console.log(msg, val);
    }
}

function rabbitHole(cb) {
    let VersionIdMarker = null;
    let KeyMarker = null;
    let currentVersions = 0;
    let nonCurrentVersions = 0;
    async.doWhilst(
        done => _listObjectVersions(VersionIdMarker, KeyMarker, (err, data) => {
            if (err) {
                console.log('error');
                return done(err);
            }
            // console.log(data)
            data.Versions.forEach(d => {
                if (d.IsLatest) {
                    currentVersions++;
                } else {
                    nonCurrentVersions++;
                }
                // logger('Key', d.Key, 'VersionId', d.VersionId);
            });
            VersionIdMarker = data.NextVersionIdMarker;
            KeyMarker = data.NextKeyMarker;
            logger('VersionIdMarker', VersionIdMarker);
            logger('KeyMarker', KeyMarker);
            return done();
        }),
        () => {
            if (!VersionIdMarker ||  !KeyMarker) {
                return false;
            }
            return true;
        },
        (err, res) => {
            // console.log('err', err, 'res', res);
            console.log('CURRENT: ', currentVersions);
            console.log('NON-CURRENT: ', nonCurrentVersions);
            return cb(err, res);
        }
    );
}

rabbitHole((err, res) => {
    // console.log('err', err, 'res', res);
    if (err) {
        return console.log('error occured listing objects', err);
    }
    return console.log('completed listing');
});
