/*global require,module,setTimeout,clearTimeout,setInterval*/

"use strict";

const myQ = require("@jhanssen/myqnode").myQ;
var Console = undefined;
var Config = undefined;

const garageDoors = Object.create(null);
const lights = Object.create(null);

var defaultPollInterval = undefined;
var garageDoorInterval = undefined;
var garageDoorTimer = undefined;
var garageDoorFastPoll = false;
var lightPendingPoll = undefined;

function pollGarageDoors(restart)
{
    for (let id in garageDoors) {
        // get the status of this door
        myQ.getDoorStatus(Config.userid, Config.password, id)
            .then((state) => {
                Console.log(`polled door state ${state} for ${id}`);
                garageDoors[id].stateval.update(state);
                // are we in fast poll mode?
                if (garageDoorFastPoll) {
                    // check if we've satisified all desired states
                    if ("desiredState" in garageDoors[id]) {
                        if (garageDoors[id].desiredState == state) {
                            delete garageDoors[id].desiredState;
                        }
                    }
                    for (var subid in garageDoors) {
                        if ("desiredState" in garageDoors[subid]) {
                            // nope
                            return;
                        }
                    }
                    // we have, return to default
                    garageDoorInterval = defaultPollInterval;
                    garageDoorFastPoll = false;
                }
            }, (resp) => {
                Console.error("poll door error", id, resp);
            });
    }
    if (restart !== false)
        garageDoorTimer = setTimeout(pollGarageDoors, garageDoorInterval);
}

function pollLights()
{
    if (lightPendingPoll !== undefined)
        lightPendingPoll = undefined;
    for (let id in lights) {
        myQ.getLightStatus(Config.userid, Config.password, id)
            .then((state) => {
                Console.log(`polled light state ${state} for ${id}`);
                if (state != lights[id].hwval.raw) {
                    // we're about to do a real update, schedule a new poll to see if our state has stabilized
                    if (lightPendingPoll !== undefined)
                        clearTimeout(lightPendingPoll);
                    lightPendingPoll = setTimeout(pollLights, 5000);
                }
                lights[id].hwval.update(state);
            }, (resp) => {
                Console.error("poll light error", id, resp);
            });
    }
}

function getName(dev)
{
    for (var i = 0; i < dev.Attributes.length; ++i) {
        if (dev.Attributes[i].Name == "desc") {
            if (typeof dev.Attributes[i].Value === "string")
                return dev.Attributes[i].Value;
        }
    }
    return dev.TypeName + ":" + dev.DeviceId;
}

const devices = {
    GarageDoorOpener: function(dev, hw) {
        // Console.log(dev.Attributes);
        var currentState;
        for (var i = 0; i < dev.Attributes.length; ++i) {
            if (dev.Attributes[i].Name == "doorstate") {
                currentState = parseInt(dev.Attributes[i].Value);
                break;
            }
        }
        // Console.log(currentState);
        let uuid = `myq:${dev.DeviceId}`;
        let hwdev = new hw.Device("GarageDoor", { uuid: uuid });
        if (!hwdev.name)
            hwdev.name = getName(dev);
        let hwmodeval = new hw.Device.Value("mode", { values: { close: 0, open: 1 }, handle: dev });
        hwmodeval._valueUpdated = function(v) {
            const fastPoll = function() {
                clearTimeout(garageDoorTimer);
                garageDoorInterval = 1000;
                garageDoorFastPoll = true;
                garageDoorTimer = setTimeout(pollGarageDoors, garageDoorInterval);
            };

            switch (v) {
            case 0:
                // close
                garageDoors[dev.DeviceId].desiredState = "Closed";
                myQ.closeDoor(Config.userid, Config.password, dev.DeviceId)
                    .then((state) => {
                        Console.log(`state is now ${state}`);
                    }, (resp) => {
                        Console.error("error closing door", resp);
                    });
                fastPoll();
                break;
            case 1:
                // open
                garageDoors[dev.DeviceId].desiredState = "Open";
                myQ.openDoor(Config.userid, Config.password, dev.DeviceId)
                    .then((state) => {
                        Console.log(`state is now ${state}`);
                    }, (resp) => {
                        Console.error("error opening door", resp);
                    });
                fastPoll();
                break;
            }
        };
        hwmodeval._valueType = "boolean";
        hwdev.addValue(hwmodeval);

        let hwstateval = new hw.Device.Value("state", { readOnly: true });
        hwstateval.update("Unknown");
        hwstateval._valueType = "string";
        hwdev.addValue(hwstateval);

        Console.log("created myq", dev.TypeName, hwdev.name);

        hw.addDevice(hwdev);

        garageDoors[dev.DeviceId] = { dev: dev, stateval: hwstateval };
    },
    LampModule: function(dev, hw) {
        var currentState;
        for (var i = 0; i < dev.Attributes.length; ++i) {
            if (dev.Attributes[i].Name == "doorstate") {
                currentState = parseInt(dev.Attributes[i].Value);
                break;
            }
        }
        // Console.log(currentState);
        let uuid = `myq:${dev.DeviceId}`;
        let hwdev = new hw.Device("Light", { uuid: uuid });
        if (!hwdev.name)
            hwdev.name = getName(dev);
        let hwval = new hw.Device.Value("value", { values: { off: false, on: true }, handle: dev });
        hwval._valueUpdated = function(v) {
            var val;
            switch (typeof v) {
            case "number":
            case "boolean":
                if (v) {
                    myQ.enableLight(Config.userid, Config.password, dev.DeviceId)
                        .then((returnCode) => {
                            if (returnCode == "0") {
                                lights[dev.DeviceId].hwval.update(true);
                            } else {
                                Console.log(`invalid return code ${returnCode} for enable ${dev.DeviceId}`);
                            }
                        });
                } else {
                    myQ.disableLight(Config.userid, Config.password, dev.DeviceId)
                        .then((returnCode) => {
                            if (returnCode == "0") {
                                lights[dev.DeviceId].hwval.update(false);
                            } else {
                                Console.log(`invalid return code ${returnCode} for enable ${dev.DeviceId}`);
                            }
                        });
                }
                break;
            default:
                Console.error("myQ lamp type error", typeof v);
                break;
            }
        };
        hwdev.addValue(hwval);

        Console.log("created myq", dev.TypeName, hwdev.name);

        hw.addDevice(hwdev);

        lights[dev.DeviceId] = { dev: dev, hwval: hwval };
    }
};

function registerDevices(homework)
{
    var garageDoorSchema = new homework.Device.Schema({
        mode: {
            values: {
                close: 0,
                open: 1
            },
            readOnly: false
        },
        state: {
            readOnly: true
        }
    });
    homework.registerDevice("GarageDoor", garageDoorSchema);

    var lightSchema = new homework.Device.Schema({
        value: {
            values: {
                off: false,
                on: true
            },
            readOnly: false
        }
    });
    homework.registerDevice("Light", lightSchema);
}

const hwmyq = {
    get name() { return "myq"; },
    get homework() { return this._homework; },
    get ready() { return this._ready; },

    init: function(cfg, data, homework) {
        if (!cfg || !cfg.userid || !cfg.password)
            return false;
        homework.utils.onify(this);
        this._initOns();
        this._ready = false;
        this._data = data;
        this._homework = homework;
        Config = cfg;
        Console = homework.Console;

        registerDevices(homework);

        myQ.getDevices(cfg.userid, cfg.password)
            .then((resp) => {
                if (typeof resp === "object" && resp.Devices instanceof Array) {
                    for (var i = 0; i < resp.Devices.length; ++i) {
                        let dev = resp.Devices[i];
                        if (typeof dev === "object") {
                            if (typeof dev.MyQDeviceTypeName === "string") {
                                if (dev.MyQDeviceTypeName in devices) {
                                    devices[dev.MyQDeviceTypeName](dev, this._homework);
                                } else if (dev.MyQDeviceTypeName != "Gateway") {
                                    Console.error("unknown myq device", JSON.stringify(dev, 0, 4));
                                }
                            }
                        }
                    }
                }

                defaultPollInterval = Config.pollInterval || (1000 * 60 * 10);
                Console.log("default poll interval", defaultPollInterval);

                if (Object.keys(garageDoors).length > 0) {
                    garageDoorInterval = defaultPollInterval;
                    garageDoorTimer = setTimeout(pollGarageDoors, garageDoorInterval);

                    // and poll once right now to update our values
                    pollGarageDoors(false);
                }

                if (Object.keys(lights).length > 0) {
                    // poll lights as well
                    setInterval(pollLights, defaultPollInterval);
                    // and poll now
                    pollLights();
                }

                this._ready = true;
                this._emit("ready");
            }, (resp) => {
                Console.error("error getting myQ devices", resp);
            });

        return true;
    },
    shutdown: function(cb) {
        var data = this._data || Object.create(null);
        cb(data);
    }
};

module.exports = hwmyq;
