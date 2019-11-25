const fs = require("fs");
const mqtt = require('mqtt')
const os = require("os");
const onoff = require("onoff");

async function readFile(filename) {
  if (!fs.existsSync(filename))
    return null;
  
  let data = await fs.promises.readFile(filename, "utf8");
  data = data.trim();
  if (!data)
    return null;
  
  return data;
}

async function loadJson(filename) {
  let data = await readFile(filename);
  if (!data)
    return null;
  
  data = JSON.parse(data);
  return data;
}

function log(str) {
  console.log(str);
}
function error(str) {
  console.log(str);
}
function debug(str) {
  if (CONFIG && CONFIG.debug)
    console.log(str);
}

let CONFIG = null;
let mqttClient = null;
let SENSOR_VALUES = {};
let INPUTS = {};

let onShutdownCallbacks = [];
process.on('SIGINT', () => onShutdownCallbacks.forEach(fn => {
  try {
    fn();
  } catch(ex) {
    error(`Error in shutdown function: ${ex}`); 
  }
  process.exit();
}));

function getTopic(alias) {
  if (alias.indexOf('/') > -1)
    return alias;
  return CONFIG.mqtt.topic + "/" + alias;
}

function sendSensorValue(alias, value) {
  let topic = getTopic(alias);
  debug(`Publishing ${topic} = ${value}`); 
  mqttClient.publish(topic, "" + value);
  SENSOR_VALUES[alias] = value;
}

async function pollSensors(repeat) {
  if (CONFIG.sensors) {
    for (let i = 0; i < CONFIG.sensors.length; i++) {
      let sensor = CONFIG.sensors[i];
      let data = await readFile(`/sys/bus/w1/devices/${sensor.id}/w1_slave`);
      if (!data) {
        log(`Cannot read sensor ${sensor.id} :: ${sensor.alias}`);
        continue;
      }
      let lines = data.split('\n');
      if (lines.length < 2) {
        log(`No output from ${sensor.id} :: ${sensor.alias}`);
        continue;
      }
      let m = lines[1].match(/\st=([0-9]+)$/);
      if (!m) {
        log(`Invalid output from sensor ${sensor.id} :: ${sensor.alias}`);
        continue;
      }
      let temp = parseInt(m[1], 10);
      if (isNaN(temp)) {
        log(`Invalid temperature from sensor ${sensor.id} :: ${sensor.alias}`);
        continue;
      }
      temp = temp / 1000.0;
      
      sendSensorValue(sensor.alias, temp);
    }
  }
  
  if (CONFIG.processes) {
    for (let i = 0; i < CONFIG.processes.length; i++) {
      let proc = CONFIG.processes[i];
      if (proc.type == "water_kw") {
        sendWaterKwProcess(proc);
      } else {
        log(`Unrecognised process type ${proc.type}`);
      }
    }
  }
  
  Object.keys(INPUTS).forEach(alias => sendSensorValue(alias, INPUTS[alias]));
  
  if (repeat)
    setTimeout(() => pollSensors(repeat), repeat);
}

function sendWaterKwProcess(config) {
  let flowTemp = SENSOR_VALUES[config.data.flow];
  let returnTemp = SENSOR_VALUES[config.data["return"]];
  let tempChange = returnTemp - flowTemp;
  let flowRate = config.data.flowRate;
  let flowRateLPM = (flowRate * 1000) / 60;
  let kw = (flowRateLPM * tempChange) / 14;
  
  debug(`Calculated water kW as ${returnTemp} - ${flowTemp} = ${tempChange}, kw=${kw}`);
  if (isNaN(kw)) {
    log(`Failed to calculate water kW for ${config.alias}`);
    return;
  }
  
  sendSensorValue(config.alias, kw);
}

function watchInputs() {
  CONFIG.inputs.forEach(async input => {
    let gpio = new onoff.Gpio(input.gpio, 'in', 'both', { debounceTimeout: 10 });
    
    const process = value => {
      if (INPUTS[input.alias] !== value) {
        debug(`Switched ${input.alias} to ${value}`);
        INPUTS[input.alias] = value;
        sendSensorValue(input.alias, value);
      }
    };
    process(await gpio.read());
    gpio.watch((err, value) => {
      if (err) {
        error(`Error while watching input ${input.alias}: ${err}`);
        return;
      }
      process(value);
    });
    onShutdownCallbacks.push(() => gpio.unexport());
  });
}

async function init() {
  CONFIG = await loadJson(`configs/${os.hostname()}.json`);

  mqttClient = mqtt.connect(`mqtt://${CONFIG.emon||"emon"}`, {
    username: CONFIG.mqtt.username,
    password: CONFIG.mqtt.password
  });
  mqttClient.on('connect', function () {
    pollSensors(CONFIG.sensorPollFrequency);
    if (CONFIG.inputs)
      watchInputs();
  });
}

init();
