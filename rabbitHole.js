const async = require('async');
const AWS = require('aws-sdk');
const http = require('http');

// configurable params
const BUCKET = 'foo';
const LISTING_LIMIT = 300;
const ACCESSKEY = 'accessKey1';
const SECRETKEY = 'verySecretKey1';
const ENDPOINT = 'http://127.0.0.1:8000';
const QUIET_MODE = true;

AWS.config.update({
    accessKeyId: ACCESSKEY,
    secretAccessKey: SECRETKEY,
    region: "us-west-1",
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

function rabbitHole(cb) {
    let VersionIdMarker = null;
    let KeyMarker = null;
    async.doWhilst(
        done => _listObjectVersions(VersionIdMarker, KeyMarker, (err, data) => {
            if (err) {
                return done(err);
            }
            console.log(data);
            VersionIdMarker = data.NextVersionIdMarker;
            KeyMarker = data.NextKeyMarker;
        }),
        () => {
            if (VersionIdMarker ||  KeyMarker) {
                return true;
            }
            return false;
        },
        cb
    );
}

rabbitHole((err, res) => {
    if (err) {
        return console.log('error occured deleting objects', err);
    }
    return console.log('completed deletion');
});
