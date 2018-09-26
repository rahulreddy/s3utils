const { MongoClientInterface } = require('arsenal').storage.metadata.mongoclient;
const  VersionID = require('arsenal').versioning.VersionID;
const encode = VersionID.encode;
const async = require('async');
const { Logger } = require('werelogs');
const ZenkoClient = require('./ZenkoClient');
const ENDPOINT = process.env.ENDPOINT;
const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const MONGODB_REPLICASET = process.env.MONGODB_REPLICASET;
const DRY_RUN = !!process.env.DRY_RUN;
if (!ENDPOINT) {
    throw new Error('ENDPOINT not defined!');
}
if (!ACCESS_KEY) {
    throw new Error('ACCESS_KEY not defined');
}
if (!SECRET_KEY) {
    throw new Error('SECRET_KEY not defined');
}
if (!MONGODB_REPLICASET) {
    throw new Error('MONGODB_REPLICASET not defined');
}
const USERSBUCKET = '__usersbucket';
const METASTORE = '__metastore';
const INFOSTORE = '__infostore';
const __UUID = 'uuid';
const PENSIEVE = 'PENSIEVE';
const MPU_BUCKET_PREFIX = 'mpuShadowBucket';
const zenkoClient = new ZenkoClient({
    apiVersion: '2018-07-08-json',
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    endpoint: ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    maxRetries: 0,
    sslEnabled: false,
    httpOptions: { timeout: 0 },
});
//const log = new werelogs.Logger('stalled');

class MongoClientInterfaceStalled extends MongoClientInterface {
    constructor(params) {
        super(params);
        this.zenkoClient = zenkoClient;
    }

    _getStalledObjectsByBucket(bucketName, cb) {
        const c = this.getCollection(bucketName);
        const cmpDate = new Date();
        cmpDate.setHours(cmpDate.getHours() - 1);
        const reducedFields = {
            '_id': {
                id: '$_id',
                storageClasses: '$value.replicationInfo.storageClass',
		status: '$value.replicationInfo.status',
                key: '$value.key',
                versionId: '$value.versionId',
            },
            'value.last-modified': 1,
        };
        return c.aggregate([
            { $project: reducedFields },
            { $match: {
                '_id.id': { $regex: /\0/ },
                '_id.status': { $eq: 'PENDING' },
            } },
        ]).toArray((err, res) => {
            if (err) {
                log.debug('unable to retrieve stalled entries', {
                    error: err,
                });
                return cb(err);
            }
            const stalledObjects = res.map(data => {
                if (!data || typeof data !== 'object' ||
                    !data.value || typeof data.value !== 'object') {
                    return false;
                }
                const time = data.value['last-modified'] || null;
                if (isNaN(Date.parse(time))) {
                    return false;
                }
                const testDate = new Date(time);
                const withinRange = testDate <= cmpDate;
                if (withinRange) {
                    const storageClasses = data._id.storageClasses.split(',');
                    return storageClasses.map(i => {
			        const storageClass = i.split(':')[0];
                        return {
                            Bucket: bucketName,
                            Key: data._id.key,
                            VersionId: encode(data._id.versionId),
                            StorageClass: storageClass,
                            ForceRetry: true,
                        }
                    });
                }
            })
            // filter nulls
            .filter(i => !!i)
            // flatten array of arrays
            if (stalledObjects.length > 0) {
                return cb(null, stalledObjects
                    .reduce((accumulator, currVal) => accumulator.concat(currVal)));
	    }
            return cb(null, stalledObjects);
        });
    }

    queueStalledObjects(cb) {
        this.db.listCollections().toArray((err, collections) => {
            if (err) {
                return cb(err);
            }
            async.eachLimit(collections, 1, (value, next) => {
                const skipBucket = value.name === METASTORE ||
                    value.name === INFOSTORE ||
                    value.name === USERSBUCKET ||
                    value.name === PENSIEVE ||
                    value.name.startsWith(MPU_BUCKET_PREFIX);
                if (skipBucket) {
                    // skip
                    return next();
                }
                const bucketName = value.name;
                this._getStalledObjectsByBucket(bucketName, (err, res) => {
                    if (err) {
                        return next(err);
                    }
                    if (!res) {
                        console.log('no stalled objects for bucket: ', bucketName);
                        return next();
                    }
                    const count = res.length;
                    const stalledObjects = [];
                    while(res.length > 0) {
                        // build arrays of 10 objects each
                        stalledObjects.push(res.splice(0, 10));
                    }
                    // upto 50 objects are retried in parallel
                    return async.mapLimit(stalledObjects, 5, (i, done) => {
                        console.log('retrying stalled objects, count# ', i.length);
                        if (DRY_RUN) {
                            console.log('dry run, skipping retry request');
                            return done();
                        }
                        zenkoClient.retryFailedObjects({
                            Body: JSON.stringify(i)
                        }, done);
                    }, (err) => {
                        if (err) {
                            return next(err);
                        }
                        return next(null, { bucket: bucketName, count });
                    });
                });
                return;
            }, cb);
        });
    }
}

const config = {
    "replicaSetHosts": MONGODB_REPLICASET,
    "writeConcern": "majority",
    "replicaSet": "rs0",
    "readPreference": "primary",
    "database": "metadata",
    "replicationGroupId": "RG001",
    logger: console,
};

const mongoclient = new MongoClientInterfaceStalled(config);
mongoclient.setup(err => {
    if(err) {
        console.error('error connecting to mongodb', err);
		return;
	}
	mongoclient.queueStalledObjects((err, res) => {
    	if (err) {
            return console.error('error occurred', err);
        }
        if (res && res.length > 0) {
            console.log('stalled objects are queued for retries');
            return;
        }
        console.log('stalled objects retry job completed');
        process.exit(0);
	});
});