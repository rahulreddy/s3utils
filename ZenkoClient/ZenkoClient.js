const AWS = require('aws-sdk');
const Service = AWS.Service;

AWS.apiLoader.services.zenko = {};
const ZenkoClient = Service.defineService(
    'zenko', ['2018-07-08-json', '2018-07-11-xml']);

/*
 * Note: a version is identified by the first 10 chars if it is not a valid
 * date format. As such, ZenkoClient version suffixes will only serve to
 * help differentiate between JSON and XML apis, and is not used to determine
 * the api version.
 * Ex. 2018-07-08-json and 2018-07-08-xml are both evaluated as version
 * 2018-07-08
 */

Object.assign(ZenkoClient.prototype, {
    validateService() {
        if (!this.config.region) {
            this.config.region = 'us-east-1';
        }
    },
});

// default to use XML when apiVersion is not specified by the user
Object.defineProperty(AWS.apiLoader.services.zenko, 'latest', {
    get: function get() {
        const model = require('./zenko-2018-07-11-xml.api.json');
        return model;
    },
    enumerable: true,
    configurable: true,
});

// Backbeat api specific client methods, handles JSON responses
Object.defineProperty(AWS.apiLoader.services.zenko, '2018-07-08-json', {
    get: function get() {
        const model = require('./zenko-2018-07-08-json.api.json');
        return model;
    },
    enumerable: true,
    configurable: true,
});

// Search specific client, regular s3 cilent, handles XML responses
Object.defineProperty(AWS.apiLoader.services.zenko, '2018-07-11-xml', {
    get: function get() {
        const model = require('./zenko-2018-07-11-xml.api.json');
        return model;
    },
    enumerable: true,
    configurable: true,
});

export { ZenkoClient };