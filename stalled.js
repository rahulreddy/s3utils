const { MongoClientInterface } = require('arsenal').storage.metadata.mongoclient;
const async = require('async');
const { Logger } = require('werelogs');
const ZenkoClient = require('ZenkoClient');
const ENDPOINT = process.env.ENDPOINT;
const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const MONGODB_REPLICASET = process.env.MONGODB_REPLICASET;
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

const zenkoClient = new ZenkoClient({
    apiVersion: '2018-07-08-json',
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    endpoint: ENDPOINT,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    maxRetries: 0,
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
                return cb(null);
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
                    const storageClasses = data._id.storageClasses,
                    return storageClasses.map(storageClass => {
                        return {
                            Bucket: bucketName,
                            Key: i._id.key,
                            VersionId: i._id.versionId,
                            StorageClass: storageClass,
                        }
                    });
                }
            })
            // filter nulls
            .filter(i => i)
            // flatten array of arrays 
            .reduce((accumulator, currVal) => accumulator.concat(currVal));
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
                    value.name.startsWith(constants.mpuBucketPrefix);
                if (skipBucket) {
                    // skip
                    return next();
                }
                const bucketName = value.name;
                this._getStalledObjectsByBucket(bucketName, (err, res) => {
                    if (err) {
                        return next(err);
                    }
                    const stalledObjects = [];
                    while(res.length > 0) {
                        // build arrays of 100 objects each
                        stalledObjects.push(res.splice(0, 100));
                    }
                    // upto 500 objects are retried in parallel
                    return async.mapLimit(stalledObjects, 5, (i, done) => {
                        zenkoClient.retryFailedObjects({
                            Body: JSON.stringify(i)
                        }, done);
                    }, next);
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
	});
});
