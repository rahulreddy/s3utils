const async = require('async');
const AWS = require('aws-sdk');

AWS.config.update({
    accessKeyId: "accessKey1",
    secretAccessKey: "verySecretKey1",
    region: "us-west-1",
    sslEnabled: false,
    endpoint:'http://127.0.0.1:8000',
    s3ForcePathStyle: true,
    apiVersions: { s3: '2006-03-01' },
    signatureVersion: 'v4',
    signatureCache: false,
    maxRetries: 0,
});

const s3 = new AWS.S3({
    httpOptions: { maxRetries: 0, timeout: 0 },
});
// configurable params
const BUCKET = 'foo';
const LISTING_LIMIT = 10;
const OBJECT_TOTAL = 20000;
const VERSIONS_TOTAL = 100;
const ASYNC_LIMIT = 10;


function _putObjectVersions(num, count, cb) {
    async.timesLimit(
        count, 2,
        (n, next) => s3.putObject({ Bucket: BUCKET, Key: 'key-' + num, Body: 'foo' }, next),
        cb
    );
}

s3.createBucket({ Bucket: BUCKET}, err => {
    if (err && err.code !== 'BucketAlreadyOwnedByYou') {
        console.log('error creating bucket', err);
        return;
    }
    console.log('created bucket', BUCKET);
    async.timesLimit(OBJECT_TOTAL, ASYNC_LIMIT,
    (n, next) => _putObjectVersions(n, VERSIONS_TOTAL, next),
    (err, res) => {
        if (err) {
            return console.log('error occured', err);
        }
        return console.log('successfully put objects');
    });
});
