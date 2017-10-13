const async = require('async');
const AWS = require('aws-sdk');
const http = require('http');

// configurable params
const BUCKET = 'foo';
const LISTING_LIMIT = 300;
const ACCESSKEY = 'accessKey1';
const SECRETKEY = 'verySecretKey1';
const ENDPOINT = 'http://127.0.0.1:8000';

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

// delete all versions of an object
function _deleteVersions(matrix, cb) {
    return async.each(matrix, (Objects, next) => {
        s3.deleteObjects({ Bucket: BUCKET, Delete: { Objects, Quiet: true } },
            (err, res) => {
                if (err) {
                    return next(err);
                }
                Objects.forEach(v => console.log('deleted key: ' + v.Key));
                return next();
            });
        }, cb);
}

function nukeObjects(cb) {
    let VersionIdMarker = null;
    let KeyMarker = null;
    const matrix = [];
    async.doWhilst(
        done => _listObjectVersions(VersionIdMarker, KeyMarker, (err, data) => {
            if (err) {
                return done(err);
            }
            VersionIdMarker = data.NextVersionIdMarker;
            KeyMarker = data.NextKeyMarker;
            const keysToDelete = _getKeys(data.Versions);
            const markersToDelete = _getKeys(data.DeleteMarkers);
            matrix.push(keysToDelete.concat(markersToDelete));
            return done();
        }),
        () => {
            if (VersionIdMarker || KeyMarker) {
                return true;
            }
            return false;
        },
        err => {
            if (err) {
                return cb(err);
            }
            return _deleteVersions(matrix, cb);
        }
    );
}

nukeObjects((err, res) => {
    if (err) {
        return console.log('error occured deleting objects', err);
    }
    return console.log('completed deletion');
});
