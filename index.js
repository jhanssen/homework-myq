/*global require,module,setTimeout,clearTimeout*/

"use strict";

const myQ = require("myqnode").myQ;
var Console = undefined;
var Config = undefined;

const garageDoors = Object.create(null);

var defaultGarageDoorInterval = undefined;
var garageDoorInterval = undefined;
var garageDoorTimer = undefined;
var garageDoorFastPoll = false;

function pollGarageDoors(restart)
{
    for (let id in garageDoors) {
        // get the status of this door
        myQ.getDoorStatus(Config.userid, Config.password, id)
            .then((state) => {
                Console.log(`polled state ${state} for ${id}`);
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
                    garageDoorInterval = defaultGarageDoorInterval;
                    garageDoorFastPoll = false;
                }
            }, (resp) => {
                Console.error("poll error", id, resp);
            });
    }
    if (restart !== false)
        garageDoorTimer = setTimeout(pollGarageDoors, garageDoorInterval);
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
        let hwdev = new hw.Device(hw.Type.GarageDoor, uuid);
        if (!hwdev.name)
            hwdev.name = `Garage Door (${dev.DeviceId})`;
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
    }
};

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

                defaultGarageDoorInterval = Config.pollInterval || (1000 * 60 * 10);
                garageDoorInterval = defaultGarageDoorInterval;
                garageDoorTimer = setTimeout(pollGarageDoors, garageDoorInterval);

                Console.log("default poll interval", defaultGarageDoorInterval);

                // and poll once right now to update our values
                pollGarageDoors(false);

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
