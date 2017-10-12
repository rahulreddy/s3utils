const async = require('async');
const AWS = require('aws-sdk');

// configurable params
const BUCKET = '';
const LISTING_LIMIT = 300;
const ACCESSKEY = '';
const SECRETKEY = '';
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
    httpOptions: { maxRetries: 0, timeout: 0 },
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
function _deleteVersions(objectsToDelete, cb) {
    // multi object delete can delete max 1000 objects
    const key = objectsToDelete[0].Key;
    let Objects = objectsToDelete.splice(0, 999);
    async.doWhilst(
        done => s3.deleteObjects({ Bucket: BUCKET, Delete: { Objects } }, (err, res) => {
            if (err) {
                return done(err);
            }
            console.log('deleted key: ' + key);
            return done();
        }),
        () => Object.keys(objectsToDelete).length > 0,
        cb
    );

}

function nukeObjects(cb) {
    let VersionIdMarker = null;
    let KeyMarker = null;
    async.doWhilst(
        done => _listObjectVersions(VersionIdMarker, KeyMarker, (err, data) => {
            if (err) {
                return done(err);
            }
            VersionIdMarker = data.NextVersionIdMarker;
            KeyMarker = data.NextKeyMarker;
            const keysToDelete = _getKeys(data.Versions);
            const markersToDelete = _getKeys(data.DeleteMarkers);
            _deleteVersions(keysToDelete.concat(markersToDelete), done);
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

nukeObjects((err, res) => {
    if (err) {
        return console.log('error occured deleting objects', err);
    }
    return console.log('completed deletion');
});