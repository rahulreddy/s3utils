const { MongoClientInterface } = 
    require('arsenal').storage.metadata.mongoclient;
const async = require('async');
const { Logger } = require('werelogs');
const ZenkoClient = require('ZenkoClient');
const BUCKET = 'transient-src-test-bucket-2';
const ENDPOINT = '';
const ACCESS_KEY = '';
const SECRET_KEY = '';
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
    }

    getStalledObjects(cb) {
	const c = this.getCollection(BUCKET);
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
            const count = res.filter(data => {
                if (!data || typeof data !== 'object' ||
                    !data.value || typeof data.value !== 'object') {
                    return false;
                }
                const time = data.value['last-modified'] || null;
                if (isNaN(Date.parse(time))) {
                    return false;
                }
                const testDate = new Date(time);
                const result = testDate <= cmpDate;
                return result;
            }).length;
            return cb(null, count);
        });
    }
}

const config = {
    "replicaSetHosts": "bloomberg-zenko-mongodb-replicaset-0.bloomberg-zenko-mongodb-replicaset:27017,bloomberg-zenko-mongodb-replicaset-1.bloomberg-zenko-mongodb-replicaset:27017,bloomberg-zenko-mongodb-replicaset-2.bloomberg-zenko-mongodb-replicaset:27017,bloomberg-zenko-mongodb-replicaset-3.bloomberg-zenko-mongodb-replicaset:27017,bloomberg-zenko-mongodb-replicaset-4.bloomberg-zenko-mongodb-replicaset:27017",
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
	mongoclient.getStalledObjects((err, res) => {
    	if (err) {
            return console.error('error occurred', err);
        }
        const stalled = res.map(i => {
            const storageClasses = i._id.storageClasses,
            return storageClasses.map(storageClass => {
                return {
                    Bucket: BUCKET,
                    Key: i._id.key,
                    VersionId: i._id.versionId,
                    StorageClass: storageClass,
                }
            });
        }).reduce((accumulator, currVal) => accumulator.concat(currVal));


        async.mapLimit(res, 100, (i, next) => {
            zenkoClient.retryFailedObjects({
                Body: JSON.stringify(retryBody)
            }, next);
        }, (err, res) => {
            if (err) {
                return console.error('error occured', err);
            }
            return console.log(res);
        });
	});
});
