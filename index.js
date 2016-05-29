"use strict";

var sonos_discovery = require('sonos-discovery');
var Promise = require('bluebird');
var denon = require('denon-avr');

Promise.promisifyAll(denon);
Promise.promisifyAll(denon.prototype);

function connect_to_avr() {
    return new Promise((resolve, reject) => {
        var avr = new denon(new denon.transports.telnet({
            host: '192.168.1.30',
            debug: true
        }));
        
        avr.on('connect', resolve.bind(this, avr));
        avr.connect();
    }).disposer((avr) => avr.getConnection().destroy());
}

function turn_on_avr() {
    if (turn_off_timer) {
        clearInterval(turn_off_timer);
        turn_off_timer = null;
    }
    
    Promise.using(connect_to_avr(), (avr) => {
        return Promise.mapSeries(
                [avr.getPowerStateAsync, avr.getSourceAsync],
                (f) => f.call(avr)
            )
            .spread(function(power_state, source) {
                console.log("AVR STATE: " + power_state + " " + source);
                if (power_state !== 'ON' || source !== 'BD') { 
                    return avr.sendAsync('SIBD', 'SI');
                }
            });
    });
}

function turn_off_avr() {
    if (turn_off_timer) {
        clearInterval(turn_off_timer);
    }
    
    var checks_remaining = 10;
    
    turn_off_timer = setInterval(function() {
        Promise.using(connect_to_avr(), (avr) => {
            return Promise.mapSeries(
                [avr.getPowerStateAsync, avr.getSourceAsync],
                (f) => f.call(avr)
            )
            .spread(function(power_state, source) {
                console.log("AVR STATE: " + power_state + " " + source);
                if (power_state !== 'ON' || source !== 'BD') { 
                    console.log("NOT POWERING AVR OFF ANYMORE!");                   
                    clearInterval(turn_off_timer);
                    turn_off_timer = null;
                    return;
                }
                
                if (--checks_remaining === 0) {                 
                    clearInterval(turn_off_timer);
                    turn_off_timer = null;
                    console.log("POWERING AVR OFF!");
                    return avr.setPowerStateAsync(false);       
                }
            });
        });
    }, 60000);
}

var sonos = new sonos_discovery();

var turn_off_timer = null;
var current_coordinator = null;
var previous_state = null;

function on_state_change(state) {
    if (previous_state && state.playbackState !== 'PLAYING') {
        previous_state = false;
        console.log("STOPPING");
        turn_off_avr();
    } else if (!previous_state && state.playbackState === 'PLAYING') {
        previous_state = true;
        console.log("PLAYING");
        turn_on_avr();
    }
}

function on_topology_change() {
    if (current_coordinator) {
        current_coordinator.removeListener('transport-state', on_state_change);
    }
    
    var p = sonos.getPlayer('Living Room');
    if (p) {
        current_coordinator = p.coordinator;   
        if (previous_state == null) {
            previous_state = (current_coordinator.state.playbackState === 'PLAYING');
        } 
        
        current_coordinator.on('transport-state', on_state_change);
        on_state_change(current_coordinator.state);
    }
}

sonos.on('topology-change', on_topology_change);
