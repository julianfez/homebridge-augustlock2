var request = require("request");
var chalk = require("chalk");
var jar = request.jar();
var Accessory, Service, Characteristic, UUIDGen;

module.exports = function(homebridge) {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform("homebridge-AugustLock2", "AugustLock2", AugustPlatform, true);
}

var APP_ID = "0";

var CODE = undefined;


function AugustPlatform(log, config, api) {
  this.log = log;
  this.platformLog = function(msg) {log(chalk.cyan("[August]"), msg);};
  this.config = config || {"platform": "AugustLock2"};
  this.phone = this.config.phone;
  this.password = this.config.password;
  this.securityToken =  this.config.securityToken;
  this.longPoll = parseInt(this.config.longPoll, 10) || 300;
  this.shortPoll = parseInt(this.config.shortPoll, 10) || 5;
  this.shortPollDuration = parseInt(this.config.shortPollDuration, 10) || 120;
  this.tout = null;
  this.maxCount = this.shortPollDuration / this.shortPoll;
  this.count = this.maxCount;
  this.validData = false;
  this.ContentType = "application/json";
  this.xkeaseapikey = "14445b6a2dba";
  this.manufacturer = "AUGUST";
  
  



  this.accessories = {};

  if (api) {
    this.api = api;
    this.api.on('didFinishLaunching', this.didFinishLaunching.bind(this));

  }

  // Definition Mapping

      this.lockState = ["unlock", "lock"];
}

// Method to restore accessories from cache
AugustPlatform.prototype.configureAccessory = function(accessory) {
  var self = this;
  var accessoryID = accessory.context.deviceID;

  accessory.context.log = function(msg) {self.log(chalk.cyan("[" + accessory.displayName + "]"), msg);};
  this.setService(accessory);
  this.accessories[accessoryID] = accessory;

}

// Method to setup accesories from config.json
AugustPlatform.prototype.didFinishLaunching = function() {
  
  if (this.phone && this.password) {

    
    // Add or update accessory in HomeKit
    this.addAccessory();

    
    this.periodicUpdate();
  
  
       
  } else {
    this.platformLog("Please setup August login information!")
  }
  
}

// Method to add or update HomeKit accessories
AugustPlatform.prototype.addAccessory = function() {
  var self = this;
  
  if (!this.securityToken) {

  this.login(function(error){
    if (!error) {
      for (var deviceID in self.accessories) {
        var accessory = self.accessories[deviceID];
        if (!accessory.reachable) {
          // Remove extra accessories in cache
          self.removeAccessory(accessory);
        } else {
          // Update inital state
          self.updatelockStates(accessory);
        }
      }
    } else {
      self.platformLog(error);
    }
  });
  } else {
    this.getlocks(function(error){
      if (!error) {
        for (var deviceID in self.accessories) {
          var accessory = self.accessories[deviceID];
          if (!accessory.reachable) {
            // Remove extra accessories in cache
            self.removeAccessory(accessory);
          } else {
            // Update inital state
            self.updatelockStates(accessory);
          }
        }
      } else {
        self.platformLog(error);
      }
    });
  }
}

// Method to remove accessories from HomeKit
AugustPlatform.prototype.removeAccessory = function(accessory) {
  if (accessory) {
    var deviceID = accessory.context.deviceID;
    accessory.context.log("Removed from HomeBridge.");
    this.api.unregisterPlatformAccessories("homebridge-AugustLock2", "AugustLock2", [accessory]);
    delete this.accessories[deviceID];
  }
}

// Method to setup listeners for different events
AugustPlatform.prototype.setService = function(accessory) {
 accessory
    .getService(Service.LockMechanism)
    .getCharacteristic(Characteristic.LockCurrentState)
    .on('get', this.getState.bind(this, accessory));

  accessory
    .getService(Service.LockMechanism)
    .getCharacteristic(Characteristic.LockTargetState)
    .on('get', this.getState.bind(this, accessory))
    .on('set', this.setState.bind(this, accessory));


    accessory
    .getService(Service.BatteryService)
    .getCharacteristic(Characteristic.BatteryLevel);
        
    accessory
    .getService(Service.BatteryService)
    .getCharacteristic(Characteristic.StatusLowBattery);


  

  accessory.on('identify', this.identify.bind(this, accessory));
}

// Method to setup HomeKit accessory information
AugustPlatform.prototype.setAccessoryInfo = function(accessory) {
  if (this.manufacturer) {
  accessory
    .getService(Service.AccessoryInformation)
    .setCharacteristic(Characteristic.Manufacturer, this.manufacturer);
  }

  if (accessory.context.serialNumber) {
    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.SerialNumber, accessory.context.serialNumber);
  }

  if (accessory.context.model) {
    accessory
      .getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Model, accessory.context.model);
  }
  

}


// Method to set target lock state
AugustPlatform.prototype.setState = function(accessory, state, callback) {
  var self = this;

  // Always re-login for setting the state
  this.getDevice(function(getlocksError) {
    if (!getlocksError) {
      self.setState(accessory, state, function(setStateError) {
        callback(setStateError);
      });
    } else {
      callback(getlocksError);
    }
  });
}

// Method to get target lock state
AugustPlatform.prototype.getState = function(accessory, callback) {
  // Get target state directly from cache
  callback(null, accessory.context.currentState);
}

// Method to get current lock state
AugustPlatform.prototype.getCurrentState = function(accessory, callback) {
  var self = this;
  var thisOpener = accessory.context;
  var name = accessory.displayName;

  // Retrieve latest state from server
  this.updateState(function(error) {
    if (!error) {
      thisOpener.log("Getting current state: " + self.lockState[thisOpener.currentState]);
      callback(null, thisOpener.currentState);
    } else {
      callback(error);
    }
  });
}



// Method for state periodic update
AugustPlatform.prototype.periodicUpdate = function() {
  var self = this;

  // Determine polling interval
  if (this.count  < this.maxCount) {
    this.count++;
    var refresh = this.shortPoll;
  } else {
    var refresh = this.longPoll;
  }

  // Setup periodic update with polling interval
  this.tout = setTimeout(function() {
    self.tout = null
    self.updateState(function(error) {
      if (!error) {
        // Update states for all HomeKit accessories
        for (var deviceID in self.accessories) {
          var accessory = self.accessories[deviceID];
          self.updatelockStates(accessory);
        }
      } else {
        // Re-login after short polling interval if error occurs
        self.count = self.maxCount - 1;
      }

      // Setup next polling
      self.periodicUpdate();
    });
  }, refresh * 1000);
}

// Method to update lock state in HomeKit
AugustPlatform.prototype.updatelockStates = function(accessory) {
 accessory
    .getService(Service.LockMechanism)
    .setCharacteristic(Characteristic.LockCurrentState, accessory.context.currentState);
  
  accessory
    .getService(Service.LockMechanism)
    .getCharacteristic(Characteristic.LockTargetState)
    .getValue();


     accessory
    .getService(Service.BatteryService)
    .setCharacteristic(Characteristic.BatteryLevel, accessory.context.batt);

     accessory
    .getService(Service.BatteryService)
    .getCharacteristic(Characteristic.StatusLowBattery, accessory.context.low);


}





// Method to retrieve lock state from the server
AugustPlatform.prototype.updateState = function(callback) {
  if (this.validData) {
    // Refresh data directly from sever if current data is valid
    this.getDevice(function(error) {
      callback(error);
    });
  } else {
    // Re-login if current data is not valid
    this.getlocks(function(error) {
      callback(error);
    });
  }
}

// Method to handle identify request
AugustPlatform.prototype.identify = function(accessory, paired, callback) {
  accessory.context.log("Identify requested!");
  callback();
}

// loging auth and get token
AugustPlatform.prototype.login = function(callback) {
  var self = this;

  


  var body = {
  'identifier': 'phone:+' + this.phone,
  'installId': '0',
  'password': this.password
};
request.post({
  url: "https://api-production.august.com/session",
  headers:{'content-type': 'application/json', 'x-kease-api-key': '14445b6a2dba', 'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)', 'accept-version': '0.0.1', 'Proxy-Connection': 'keep-alive', 'accept-Language': 'en-US;q=1'},
 
  body: JSON.stringify(body)

  },function(error,request,body){

  if (!error && request.statusCode == 200) {

      var json = JSON.parse(body);
      self.userId = json["userId"];
  
      self.securityToken = request.headers['x-august-access-token'];
      self.platformLog("Logged in with ID" + self.userId);
      self.postLogin(callback);
  }
  }).on('error', function(error) {
    self.platformLog(error);
    callback(error, null);
    });
}




AugustPlatform.prototype.postLogin = function(accessory, paired, callback) {
    var self = this;
    
    var body = {
      'value': '+' + this.phone
       };
     

       require('request').post({
        
      url:"https://api-production.august.com/validation/phone",
         headers:{'content-type': 'application/json', 'x-kease-api-key': '14445b6a2dba', 'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)', 'accept-version': '0.0.1', 'x-august-access-token': this.securityToken},
       
        body: JSON.stringify(body)
        },function(error,request,body){
          

          if (!error && request.statusCode == 200) {
            self.platformLog("Sent Verification Code " + self.phone);
          }
          }).on('error', function(error) {
            self.platformLog(error);
            callback(error, null);
             });
  }
             
AugustPlatform.prototype.sendcode = function(callback) {
    var self = this;
    
    var body = {
      'code': this.code,
      'value': '+' + this.phone
    };
    require('request').post({
        
      url:"https://api-production.august.com/validate/phone",
         headers:{'content-type': 'application/json', 'x-kease-api-key': '14445b6a2dba', 'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)', 'accept-version': '0.0.1', 'x-august-access-token': this.securityToken},
       
        body: JSON.stringify(body)
        },function(error,request,body){
  
          if (!error && request.statusCode == 200) {
            self.platformLog("send code " + self.code);
            self.getlocks(callback);
            }
        }).on('error', function(error) {
            self.platformLog(error);
            callback(error, null);
     });
}

AugustPlatform.prototype.getlocks = function(callback) {
  var self = this;

  require('request').get({
        
      url:"https://api-production.august.com/users/locks/mine",
         headers:{'content-type': 'application/json', 'x-kease-api-key': '14445b6a2dba', 'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)', 'accept-version': '0.0.1', 'x-august-access-token': this.securityToken},
       
        },function(error,request,body){
          if (!error && request.statusCode == 200) {
            var json = JSON.parse(body);
            self.lockids = Object.keys(json);
            for (var i = 0; i < self.lockids.length; i++) {
              self.lock = json[self.lockids[i]];
              self.lockname = self.lock["HouseName"];
              self.platformLog("House Name " + " " + self.lockname);
              self.getDevice(callback);
            }
          }
        }).on('error', function(error) {
          self.platformLog(error);
          callback(error, null);
    });
 }

 

AugustPlatform.prototype.getDevice = function(callback, state) {
  var self = this;
  this.validData = false;

  // Reset validData hint until we retrived data from the server
  

  // Querystring params
  require('request').get({
  uri:"https://api-production.august.com/locks/" + self.lockids,
  headers:{'content-type': 'application/json', 'x-kease-api-key': '14445b6a2dba', 'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)', 'accept-version': '0.0.1', 'x-august-access-token': this.securityToken},
  },function(error,request,body){

    if (!error && request.statusCode == 200) {
        var locks = JSON.parse(body);
        
           var thisDeviceID = locks.LockID.toString();
            var thisSerialNumber = locks.SerialNumber.toString();
            var thisModel = locks.Bridge.deviceModel.toString();
            var thislockName = locks.LockName;
            var state = locks.LockStatus.status;
            var nameFound = true;
            var stateFound = true;
            var thishome = locks.HouseName;
            self.batt = locks.battery * 100;
            
   
            
            var locked = state == "locked";
            var unlocked = state == "unlocked";

            var thislockState = (state == "locked" ) ? "1" : "0";
        

            // Initialization for opener
            if (!self.accessories[thisDeviceID]) {
              var uuid = UUIDGen.generate(thisDeviceID);

              // Setup accessory as GARAGE_lock_OPENER (4) category.
              var newAccessory = new Accessory("August " + thishome, uuid, 6);

              // New accessory found in the server is always reachable
              newAccessory.reachable = true;

              // Store and initialize variables into context
              newAccessory.context.deviceID = thisDeviceID;
              newAccessory.context.initialState = Characteristic.LockCurrentState.SECURED;
              newAccessory.context.currentState = Characteristic.LockCurrentState.SECURED;
              newAccessory.context.serialNumber = thisSerialNumber;
              newAccessory.context.home = thishome;
              newAccessory.context.model = thisModel;
              newAccessory.context.batt = self.batt;
              newAccessory.context.low = self.low;

              newAccessory.context.log = function(msg) {self.log(chalk.cyan("[" + newAccessory.displayName + "]"), msg);};

              // Setup HomeKit security systemLoc service
              newAccessory.addService(Service.LockMechanism, thislockName);
              newAccessory.addService(Service.BatteryService);
             
             
              // Setup HomeKit accessory information
              self.setAccessoryInfo(newAccessory);

              

              // Setup listeners for different security system events
              self.setService(newAccessory);


              

              // Register accessory in HomeKit
              self.api.registerPlatformAccessories("homebridge-AugustLock2", "AugustLock2", [newAccessory]);
            } else {
              // Retrieve accessory from cache
              var newAccessory = self.accessories[thisDeviceID];

              // Update context
              newAccessory.context.deviceID = thisDeviceID;
              newAccessory.context.serialNumber = thisSerialNumber;
              newAccessory.context.model = thisModel;
              newAccessory.context.home = thishome;
              

              // Accessory is reachable after it's found in the server
              newAccessory.updateReachability(true);
            }

            if (self.batt) {
            newAccessory.context.low = (self.batt > 20) ? Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL : Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;

            }



            if (state === "locked" ) {
              newAccessory.context.initialState = Characteristic.LockCurrentState.UNSECURED;
              var newState = Characteristic.LockCurrentState.SECURED;
            } else if (thislockState === "unlocked" ) {
              newAccessory.context.initialState = Characteristic.LockCurrentState.UNSECURED;
              var newState = Characteristic.LockCurrentState.UNSECURED;

            }



            // Detect for state changes
            if (newState !== newAccessory.context.currentState) {
              self.count = 0;
              newAccessory.context.currentState = newState;
            }

            // Store accessory in cache
            self.accessories[thisDeviceID] = newAccessory;

            // Set validData hint after we found an opener
            self.validData = true;
          }
        


      // Did we have valid data?
      if (self.validData) {
        // Set short polling interval when state changes
        if (self.tout && self.count == 0) {
          clearTimeout(self.tout);
          self.periodicUpdate();
        }
    
       callback();
      } else {
        self.platformLog("Error: Couldn't find a August lock device.");
        callback("Missing August Device ID");
      }
    
  }).on('error', function(error) {
    self.platformLog("Error '" + error + "'" + "lock null");
  
  });

}


// Send opener target state to the server
AugustPlatform.prototype.setState = function(accessory, state, callback) {
 var self = this;
  var thisOpener = accessory.context;
  var name = accessory.displayName;
var augustState = state === "locked" ? "lock" : "unlock";

var status = self.lockState[state];
  request.put({
        url: "https://api-production.august.com/remoteoperate/" + self.lockids + "/" + self.lockState[state],
        "headers": {
            "Content-Type": 'application/json',
            'x-kease-api-key': '14445b6a2dba',
            'x-august-access-token': this.securityToken,
            'Proxy-Connection': 'keep-alive',
            'userAgent': 'August/4.4.42 (iPhone; iOS 9.0.2; Scale/2.00)',
            'accept-version': '0.0.1',
            'accept-Language': 'en-US;q=1'
        }

  

  // Send the state request to August
  
  }, function(error, response, json) {
    if (!error && response.statusCode == 200) {
      
     
      thisOpener.log("State was successfully set to " + status);

        // Set short polling interval
        self.count = 0;
        if (self.tout) {
          clearTimeout(self.tout);
          self.periodicUpdate();
        }

        callback(error, state);
          } else {
      thisOpener.log("Error '"+error+"' setting lock state: " + json);
      callback(error);
    }
  }).on('error', function(error) {
    thisOpener.log(error);
    callback(error);
  });
}

// Method to handle plugin configuration in HomeKit app
AugustPlatform.prototype.configurationRequestHandler = function(context, request, callback) {
  var self = this;
	

  
 if (request && request.type === "Terminate") {
    return;
  }

  // Instruction
  if (!context.step) {
    var instructionResp = {
      "type": "Interface",
      "interface": "instruction",
      "title": "Before You Start...",
      "detail": "Please make sure homebridge is running with elevated privileges.",
      "showNextButton": true
    }

    context.step = 1;
    callback(instructionResp);
  } else {
    switch (context.step) {
    
      case 1:
        var respDict = {
          "type": "Interface",
          "interface": "input",
          "title": "Configuration",
          "items": [{
            "id": "phone",
            "title": "Phone(Required)",
            "placeholder": this.phone ? "phone" : "phone Example (14159990000)"
          }, {
            "id": "password",
            "title": "Password (Required)",
            "placeholder": this.password ? "Leave blank if unchanged" : "password",
            "secure": true
          }]
        }
				
				
				
				context.step = 2;
				callback(respDict);
        break;
      case 2:
        var userInputs = request.response.inputs;

        // Setup info for adding or updating accessory
        this.phone = userInputs.phone || this.phone;
        this.password = userInputs.password || this.password;
        this.apitoken = this.securityToken;
        this.lockids = this.lockids;
        
        // Check for required info
        if (this.phone && this.password) {
          // Add or update accessory in HomeKit
          this.addAccessory();

          // Reset polling
          this.maxCount = this.shortPollDuration / this.shortPoll;
          this.count = this.maxCount;

          if (this.tout) {
            clearTimeout(this.tout);
            this.periodicUpdate();
						
          }
				


var respDict = {
            "type": "Interface",
            "interface": "input",
            "title": "code",
            "items": [{
              "id": "code",
              "title": "August Verification Code",
              "placeholder": this.code ? "Text Phone Veryfication Code" : "code",
							"showNextButton": true
              }]
            };
           context.step = 3;
          
 				  } else {
  
          // Error if required info is missing
          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Error",
            "detail": "Some required information is missing.",
            "showNextButton": true
          };

          context.step = 1;
        }
				callback(respDict);			
        break;
      case 3:
      var userInputs = request.response.inputs;

      // Setup info for adding or updating accessory
      this.code = userInputs.code || this.code;
			        
				this.sendcode(callback);
				
				          var respDict = {
            "type": "Interface",
            "interface": "instruction",
            "title": "Success",
            "detail": "The configuration is now updated.",
            "showNextButton": true
          };
				
				context.step = 4;
 
        	callback(respDict);
        break;
      case 4:
        // Update config.json accordingly
       delete context.step;
        var newConfig = this.config;
        newConfig.phone = this.phone;
        newConfig.password = this.password;
        newConfig.securityToken = this.securityToken;
        newConfig.lockids = this.lockids;
        callback(null, "platform", true, newConfig);
        break;
    }
  }
}
