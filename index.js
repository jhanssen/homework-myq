/*global require,module*/

"use strict";

const myQ = require("myqnode").myQ;
var Console = undefined;

const devices = {
    GarageDoorOpener: function(dev, hw, cfg) {
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
        let hwval = new hw.Device.Value("mode", { values: { close: 0, open: 1 } });
        hwval._valueUpdated = function(v) {
            switch (v) {
            case 0:
                // close
                myQ.closeDoor(cfg.userid, cfg.password, dev.DeviceId)
                    .then((state) => {
                        Console.log(`state is now ${state}`);
                    }, (resp) => {
                        Console.error("error closing door", resp);
                    });
                break;
            case 1:
                // open
                myQ.openDoor(cfg.userid, cfg.password, dev.DeviceId)
                    .then((state) => {
                        Console.log(`state is now ${state}`);
                    }, (resp) => {
                        Console.error("error opening door", resp);
                    });
                break;
            }
        };
        hwval._valueType = "number";
        if (currentState !== undefined) {
            hwval.update(currentState == 2 ? 0 : 1);
        }
        hwdev.addValue(hwval);

        Console.log("created myq", dev.TypeName, hwdev.name);

        hw.addDevice(hwdev);
    }
};

const caseta = {
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
        this._cfg = cfg;
        Console = homework.Console;

        myQ.getDevices(cfg.userid, cfg.password)
            .then((resp) => {
                if (typeof resp === "object" && resp.Devices instanceof Array) {
                    for (var i = 0; i < resp.Devices.length; ++i) {
                        let dev = resp.Devices[i];
                        if (typeof dev === "object") {
                            if (typeof dev.MyQDeviceTypeName === "string" && dev.MyQDeviceTypeName in devices) {
                                devices[dev.MyQDeviceTypeName](dev, this._homework, this._cfg);
                            }
                        }
                    }
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

module.exports = caseta;
