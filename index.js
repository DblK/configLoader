const { EventEmitter } = require('events');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const mime = require('mime-types');
const debug = require('debug')('cicp:configLoader');

const MODE_RECORD = 1;
const MODE_REPLAY = 2;

class ConfigLoader extends EventEmitter {
  /**
   *
   * @constructor
   * @param {{autopilot: object, recorder: object}} param Constructor object
   */
  constructor({ autopilot, recorder }) {
    super();
    debug('constructor');

    assert(autopilot, 'Autopilot must be present');
    this.autopilot = autopilot;
    assert(recorder, 'Recorder must be present');
    this.recorder = recorder;

    const that = this;

    // Begin to start a record for a recordset
    this.autopilot.registerCommand({
      command: 'RECORD',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('RECORD', (params) => {
      this.handleRecord.call(that, params);
    });

    // Load a specific recordset
    this.autopilot.registerCommand({
      command: 'REPLAY-FILE',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('REPLAY-FILE', (params) => {
      this.handleRecordOrReplay.call(that, params);
    });

    // Load a specific recordset or record if not exist
    this.autopilot.registerCommand({
      command: 'REPLAY-FILE-OR-RECORD',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('REPLAY-FILE-OR-RECORD', (params) => {
      this.handleRecordOrReplay.call(that, params);
    });

    // Ends the recording of a recordset
    this.autopilot.registerCommand({
      command: 'RECORD-END',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('RECORD-END', (params) => {
      this.handleRecordEnd.call(that, params);
    });

    // Loads all recordset in memory
    this.autopilot.registerCommand({
      command: 'LOAD-ALL',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('LOAD-ALL', (params) => {
      this.handleLoadAll.call(that, params);
    });

    // Specify the current recordset in which the recorder should look into
    this.autopilot.registerCommand({
      command: 'RECORD-SET',
      bypassQuery: true,
      waitForContinue: true,
    });
    this.autopilot.on('RECORD-SET', (params) => {
      this.handleRecordSet.call(that, params);
    });

    this.currentFile = null;
    this.currentMode = null;
    this.configs = {};
    this.defaultConfig = {
      general: {},
      requests: [],
    };
  }

  handleRecord({ value, res }) {
    debug('handleRecord');
    debug(value);

    this.currentFile = value;
    this.recorder.start(value);
    this.autopilot._ignoreQuery(null, res);
  }

  handleRecordOrReplay({ command, value, res }) {
    debug('handleRecordOrReplay');
    debug(command, value);

    let message = '';

    if (this.currentFile !== null && this.currentMode === MODE_RECORD) {
      this.recorder.stop(this.currentFile);
      this.saveConfig(this.currentFile);
    }
    this.currentFile = value;

    if (this.loadConfig(value)) {
      this.recorder.replay(value);
      this.currentMode = MODE_REPLAY;
      message = `Loaded ${this.configs[this.currentFile].requests.length} requests of recordset '${value}'`;
    } else if (command === 'REPLAY-FILE-OR-RECORD') {
      this.recorder.start(value);
      this.currentMode = MODE_RECORD;
      this.configs[this.currentFile] = this._defaultConfig();
      message = `Beginning recording of recordset '${value}'`;
    } else {
      this.currentFile = null;
      this.currentMode = null;
      throw new Error(`Config folder '${value}' not found!`);
    }
    this.autopilot._ignoreQuery(null, res, message);
  }

  handleRecordEnd({ value, res }) {
    debug('handleRecordEnd');
    debug(value);

    if (this.currentFile !== null) {
      this.recorder.stop(this.currentFile);

      // if (this.currentFile !== null) {
      if (this.currentMode === MODE_RECORD) {
        // debug(this.configs[this.currentFile].requests[0].res);
        this.saveConfig(this.currentFile);
        this.autopilot._ignoreQuery(null, res, `Saving ${this.recorder.matcherGetRequests(this.currentFile).length} requests`);
        this.currentFile = null;
        this.currentMode = null;
      } else {
        this.autopilot._ignoreQuery(null, res);
      }
    } else {
      this.autopilot._ignoreQuery(null, res);
    }
  }

  handleLoadAll({ value, res }) {
    debug('handleLoadAll');
    debug(value);

    const resultLoad = this.loadAllConfigs();
    if (resultLoad) {
      this.currentMode = MODE_REPLAY;
    }

    // eslint-disable-next-line max-len
    this.autopilot._ignoreQuery(null, res, `Loaded ${resultLoad.numConfig} configs for a total of ${resultLoad.numRequest} requests (Memory usage: ${Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100} MB)`);
  }

  handleRecordSet({ value, req, next }) {
    debug('handleRecordSet');
    debug(value);

    req.currentFile = value;

    next();
  }

  /**
   * Handle Request to dynamically load configuration
   *
   * @param {http.ClientRequest} req Request
   * @param {http.ServerResponse} res Response
   * @param {Promise} next Pass to the next registered function
   */
  handleRequest(req, res, next) {
    if (req.currentFile === undefined) {
      req.currentFile = this.currentFile;
    }
    next();
  }

  /**
   * Set additional properties after object constructor
   *
   * @param {{logger: object, options: object, util: object}} param Additional Object
   */
  setInitialProperties({ logger, options, util }) {
    // debug('setInitialProperties');
    assert(logger, 'Logger must be present');
    this.logger = logger;
    assert(options, 'Options must be present');
    this.options = options;
    assert(util, 'Util must be present');
    this.util = util;
  }

  /**
   * Load a config file
   *
   * @param folderName string Represent the path to folder of the wanted config
   */
  loadConfig(folderName) {
    const hrstart = process.hrtime();
    const configFile = path.join(process.cwd(), this.options.folder, folderName, 'config.json');
    debug(`loadConfig: ${configFile}`);

    // Check if file exist
    if (!fs.existsSync(configFile)) {
      return false;
    }
    this.logger.info(`Config file found for ${folderName}, loading configuration`);

    // Check if config already in memory
    if (this.configs[folderName]) {
      return this.configs[folderName].requests.length;
    }
    // Load Config
    this.configs[folderName] = {};

    const configJSON = JSON.parse(fs.readFileSync(configFile));
    configJSON.requests = configJSON.requests.map((request) => {
      const newReq = { ...request };

      if (newReq.req.rawBody && newReq.req.rawBody.length > 0) {
        newReq.req.rawBody = Buffer.from(newReq.req.rawBody);
        // delete newReq.req.body;
      }

      if (newReq.res.file && newReq.res.file.length > 0) {
        const file = fs.readFileSync(path.join(process.cwd(), this.options.folder, folderName, newReq.res.file));
        newReq.res.body = Buffer.from(file);
      } else if (newReq.res.body === undefined) {
        newReq.res.body = Buffer.from('');
      }

      return newReq;
    });
    // debug(configJSON);

    this.configs[folderName] = configJSON;

    // Amend request to add plugin specific parameters (like speed, ...)
    const requestsWithConfig = configJSON.requests.map((request) => {
      if (!request.general) {
        request.general = {};
      }
      Object.keys(this.configs[folderName].general).forEach((plugin) => {
        if (!request.general[plugin]) {
          request.general[plugin] = {};
          this.util.extendDeep(request.general[plugin], this.configs[folderName].general[plugin]);
        }
      });

      return request;
    });

    // Emit the event for other plugins to catch
    this.emit('NEW_SET', {
      recordset: folderName,
      requests: requestsWithConfig,
    });
    this.recorder.matcherSetRequests(folderName, requestsWithConfig);

    debug(`Memory usage: ${Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100} MB`);
    const hrend = process.hrtime(hrstart);
    debug('loadConfig end (%ds %dms)', hrend[0], hrend[1] / 1000000);
    return requestsWithConfig.length;
  }

  /**
   * Load all configs present in record folder
   */
  loadAllConfigs() {
    this.logger.info('Load all configs');
    const folders = fs.readdirSync(path.join(process.cwd(), this.options.folder));
    let loadedStatus;
    try {
      loadedStatus = folders.map(folder => this.loadConfig(folder));
    } catch (err) {
      this.logger.error(err);
      return false;
    }

    debug(`Memory usage: ${Math.round((process.memoryUsage().heapUsed / 1024 / 1024) * 100) / 100} MB`);
    return {
      numConfig: loadedStatus.length,
      numRequest: loadedStatus.reduce((prev, newVal) => prev + newVal),
    };
  }

  /**
   * Save a config file
   *
   * @param folderName string Represent the path to folder of the wanted config
   */
  saveConfig(folderName) {
    const folderToCreate = path.join(process.cwd(), this.options.folder, folderName);
    const configFile = path.join(folderToCreate, 'config.json');
    debug(`saveConfig: ${configFile}`);

    // Save config.json (global parameters)
    try {
      const newConfig = this._defaultConfig();
      newConfig.requests = this.recorder.matcherGetRequests(folderName);
      // debug(newConfig.requests);
      this.configs[folderName] = newConfig;

      // Create directory for storing everthing
      if (!fs.existsSync(folderToCreate)) {
        fs.mkdirSync(folderToCreate);
      }

      // Save response to files
      debug(`Saving x${this.configs[folderName].requests.length} requests`);
      this.configs[folderName].requests = this.configs[folderName].requests.map((request, idx) => {
        const newReq = { ...request };

        let hashFile;
        try {
          hashFile = crypto.createHash('md5').update(request.res.body).digest('hex');
        } catch (err) {
          debug(request.res.body);
          hashFile = idx;
        }

        try {
          const file = `${hashFile}.${this._defaultExt(request.res.headers['content-type'])}`;
          newReq.res.file = file;

          fs.writeFileSync(path.join(folderToCreate, file), request.res.body);
          delete newReq.res.body;
        } catch (err) {
          this.logger.error(err);
        }

        try {
          // Remove properties from plugins that equals general
          Object.keys(this.configs[folderName].general).forEach((plugin) => {
            if (this.util.compareObject(this.configs[folderName].general[plugin], newReq.general[plugin])) {
              delete newReq.general[plugin];
            }
          });

          if (this.util.isEmptyObject(newReq.general)) {
            delete newReq.general;
          }
          if (newReq.req.rawBody && newReq.req.rawBody.length > 0) {
            newReq.req.rawBody = newReq.req.rawBody.toString();
          }
          // delete newReq.rawBody;
        } catch (err) {
          this.logger.error(err);
        }

        return newReq;
      });

      fs.writeFileSync(configFile, JSON.stringify(this.configs[folderName]));
    } catch (err) {
      this.logger.error(err);
    }
  }

  /**
   * Tell the right extension
   *
   * @param {string} contentType Content-Type of a request
   * @private
   */
  _defaultExt(contentType) {
    const ext = mime.extension(contentType);
    if (ext) {
      return ext;
    }

    // Custom handling until it's present on module
    switch (contentType) {
      case 'application/x-font-ttf':
        return 'ttf';

      default:
        return 'unknown';
    }
  }

  defaultPluginConfig({ plugin, data }) {
    debug(plugin);
    const newData = {};
    newData[plugin] = data;
    this.defaultConfig.general = this.util.extendDeep(newData, this.defaultConfig.general);

    debug(this.defaultConfig);
  }

  _defaultConfig() {
    return this.defaultConfig;
  }
}

module.exports = function setup(options, imports, register) {
  const configLoader = new ConfigLoader(imports);

  register(null, {
    configLoader,
  });
};
