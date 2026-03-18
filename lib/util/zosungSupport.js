/**
 * Zosung IR Blaster (TS1201/ZS06) support for zigbee2mqtt 1.13.0
 *
 * This module registers custom Zigbee clusters, fromZigbee/toZigbee converters,
 * and the TS1201 device definition needed for the Zosung/Tuya universal smart
 * IR remote control (e.g. manufacturer _tz3290_nba3knpsarkawgnt).
 *
 * Backported from zigbee-herdsman-converters >=15.x to work with
 * zigbee-herdsman 0.12.83 and zigbee-herdsman-converters 12.0.81.
 */
'use strict';

const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');
const logger = require('./logger');

// ---------------------------------------------------------------------------
// 1. Register custom Zosung clusters with zigbee-herdsman
// ---------------------------------------------------------------------------

function registerZosungClusters() {
    // Access the Cluster definition object from zigbee-herdsman
    const ZclDef = require('zigbee-herdsman/dist/zcl/definition');
    const Cluster = ZclDef.default || ZclDef.Cluster || ZclDef;
    const DataType = require('zigbee-herdsman/dist/zcl/definition/dataType');
    const dt = DataType.default || DataType;
    const BuffaloType = require('zigbee-herdsman/dist/zcl/definition/buffaloZclDataType');
    const bt = BuffaloType.default || BuffaloType;

    // Zosung IR Transmit Cluster (0xED00)
    Cluster.zosungIRTransmit = {
        ID: 0xed00,
        attributes: {},
        commands: {
            zosungSendIRCode00: {
                ID: 0x00,
                parameters: [
                    {name: 'seq', type: dt.uint16},
                    {name: 'length', type: dt.uint32},
                    {name: 'unk1', type: dt.uint32},
                    {name: 'unk2', type: dt.uint16},
                    {name: 'unk3', type: dt.uint8},
                    {name: 'cmd', type: dt.uint8},
                    {name: 'unk4', type: dt.uint16},
                ],
            },
            zosungSendIRCode01: {
                ID: 0x01,
                parameters: [
                    {name: 'zero', type: dt.uint8},
                    {name: 'seq', type: dt.uint16},
                    {name: 'length', type: dt.uint32},
                    {name: 'unk1', type: dt.uint32},
                    {name: 'unk2', type: dt.uint16},
                    {name: 'unk3', type: dt.uint8},
                    {name: 'cmd', type: dt.uint8},
                    {name: 'unk4', type: dt.uint16},
                ],
            },
            zosungSendIRCode02: {
                ID: 0x02,
                parameters: [
                    {name: 'seq', type: dt.uint16},
                    {name: 'position', type: dt.uint32},
                    {name: 'maxlen', type: dt.uint8},
                ],
            },
            zosungSendIRCode03: {
                ID: 0x03,
                parameters: [
                    {name: 'zero', type: dt.uint8},
                    {name: 'seq', type: dt.uint16},
                    {name: 'position', type: dt.uint32},
                    {name: 'msgpart', type: dt.octetStr},
                    {name: 'msgpartcrc', type: dt.uint8},
                ],
            },
            zosungSendIRCode04: {
                ID: 0x04,
                parameters: [
                    {name: 'zero0', type: dt.uint8},
                    {name: 'seq', type: dt.uint16},
                    {name: 'zero1', type: dt.uint16},
                ],
            },
            zosungSendIRCode05: {
                ID: 0x05,
                parameters: [
                    {name: 'seq', type: dt.uint16},
                    {name: 'zero', type: dt.uint16},
                ],
            },
        },
        commandsResponse: {
            zosungSendIRCode03Resp: {
                ID: 0x03,
                parameters: [
                    {name: 'zero', type: dt.uint8},
                    {name: 'seq', type: dt.uint16},
                    {name: 'position', type: dt.uint32},
                    {name: 'msgpart', type: dt.octetStr},
                    {name: 'msgpartcrc', type: dt.uint8},
                ],
            },
            zosungSendIRCode05Resp: {
                ID: 0x05,
                parameters: [
                    {name: 'seq', type: dt.uint16},
                    {name: 'zero', type: dt.uint16},
                ],
            },
        },
    };

    // Zosung IR Control Cluster (0xE004)
    Cluster.zosungIRControl = {
        ID: 0xe004,
        attributes: {},
        commands: {
            zosungControlIRCommand00: {
                ID: 0x00,
                parameters: [
                    {name: 'data', type: bt.BUFFER},
                ],
            },
        },
        commandsResponse: {},
    };

    logger.info('Registered Zosung IR custom clusters (0xED00, 0xE004)');
}

// ---------------------------------------------------------------------------
// 2. Zosung message state management (per-endpoint sequence/data tracking)
// ---------------------------------------------------------------------------

const endpointStore = new WeakMap();

function getStore(entity) {
    if (!endpointStore.has(entity)) {
        endpointStore.set(entity, {});
    }
    return endpointStore.get(entity);
}

function nextSeq(entity) {
    const store = getStore(entity);
    store.seq = ((store.seq || -1) + 1) % 0x10000;
    return store.seq;
}

function messagesGet(entity, seq) {
    const store = getStore(entity);
    const info = store.irMessageInfo;
    if (!info || info.seq !== seq) {
        throw new Error(`Unexpected sequence value (expected: ${info ? info.seq : 'none'} current: ${seq}).`);
    }
    return info.data;
}

function messagesSet(entity, seq, data) {
    const store = getStore(entity);
    store.irMessageInfo = {seq, data};
}

function messagesClear(entity, seq) {
    const store = getStore(entity);
    const info = store.irMessageInfo;
    if (!info || info.seq !== seq) {
        throw new Error(`Unexpected sequence value (expected: ${info ? info.seq : 'none'} current: ${seq}).`);
    }
    delete store.irMessageInfo;
}

function calcArrayCrc(values) {
    return Array.from(values.values()).reduce((a, b) => a + b, 0) % 0x100;
}

function calcStringCrc(str) {
    return str.split('').map((x) => x.charCodeAt(0)).reduce((a, b) => a + b, 0) % 0x100;
}

// ---------------------------------------------------------------------------
// 3. fromZigbee converters (device -> MQTT)
// ---------------------------------------------------------------------------

const fzZosung = {
    zosung_send_ir_code_00: {
        cluster: 'zosungIRTransmit',
        type: ['commandZosungSendIRCode00'],
        convert: async (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code00" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            const length = msg.data.length;
            messagesSet(msg.endpoint, seq, {position: 0, buf: Buffer.alloc(length)});
            await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode01',
                {
                    zero: 0,
                    seq: seq,
                    length: length,
                    unk1: msg.data.unk1,
                    unk2: msg.data.unk2,
                    unk3: msg.data.unk3,
                    cmd: msg.data.cmd,
                    unk4: msg.data.unk4,
                },
                {disableDefaultResponse: true});
            logger.debug(`"IR-Message-Code00" response sent.`);
            await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode02',
                {
                    seq: msg.data.seq,
                    position: 0,
                    maxlen: 0x38,
                },
                {disableDefaultResponse: true});
            logger.debug(`"IR-Message-Code00" transfer started.`);
        },
    },
    zosung_send_ir_code_01: {
        cluster: 'zosungIRTransmit',
        type: ['commandZosungSendIRCode01'],
        convert: (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code01" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            const irMsg = messagesGet(msg.endpoint, seq);
            logger.debug(`IRCode to send: ${JSON.stringify(irMsg)} (seq:${seq})`);
        },
    },
    zosung_send_ir_code_02: {
        cluster: 'zosungIRTransmit',
        type: ['commandZosungSendIRCode02'],
        convert: async (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code02" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            const position = msg.data.position;
            const irMsg = messagesGet(msg.endpoint, seq);
            const part = irMsg.substring(position, position + 0x32);
            const sum = calcStringCrc(part);
            await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode03',
                {
                    zero: 0,
                    seq: seq,
                    position: position,
                    msgpart: Buffer.from(part),
                    msgpartcrc: sum,
                },
                {disableDefaultResponse: true});
            logger.debug(`Sent IRCode part: ${part} (sum: ${sum}, seq:${seq})`);
        },
    },
    zosung_send_ir_code_03: {
        cluster: 'zosungIRTransmit',
        type: ['zosungSendIRCode03Resp'],
        convert: async (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code03" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            const rcv = messagesGet(msg.endpoint, seq);
            if (rcv.position === msg.data.position) {
                const rcvMsgPart = msg.data.msgpart;
                const sum = calcArrayCrc(rcvMsgPart);
                const expectedPartCrc = msg.data.msgpartcrc;
                if (sum === expectedPartCrc) {
                    const position = rcvMsgPart.copy(rcv.buf, rcv.position);
                    rcv.position += position;
                    if (rcv.position < rcv.buf.length) {
                        await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode02',
                            {
                                seq: seq,
                                position: rcv.position,
                                maxlen: 0x38,
                            },
                            {disableDefaultResponse: true});
                    } else {
                        await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode04',
                            {
                                zero0: 0,
                                seq: seq,
                                zero1: 0,
                            },
                            {disableDefaultResponse: true});
                    }
                    logger.debug(`${rcvMsgPart.length} bytes received.`);
                } else {
                    logger.error(`Invalid msg part CRC: ${sum} expecting: ${expectedPartCrc}.`);
                }
            } else {
                logger.error(`Unexpected IR code position: ${JSON.stringify(msg.data)}, expecting: ${rcv.position}.`);
            }
        },
    },
    zosung_send_ir_code_04: {
        cluster: 'zosungIRTransmit',
        type: ['commandZosungSendIRCode04'],
        convert: async (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code04" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            await msg.endpoint.command('zosungIRTransmit', 'zosungSendIRCode05',
                {
                    seq: seq,
                    zero: 0,
                },
                {disableDefaultResponse: true});
            messagesClear(msg.endpoint, seq);
            logger.debug(`IRCode has been successfully sent. (seq:${seq})`);
        },
    },
    zosung_send_ir_code_05: {
        cluster: 'zosungIRTransmit',
        type: ['zosungSendIRCode05Resp'],
        convert: async (model, msg, publish, options, meta) => {
            logger.debug(`"IR-Message-Code05" received (msg:${JSON.stringify(msg.data)})`);
            const seq = msg.data.seq;
            const rcv = messagesGet(msg.endpoint, seq);
            const learnedIRCode = rcv.buf.toString('base64');
            logger.debug(`Received: ${learnedIRCode}`);
            messagesClear(msg.endpoint, seq);
            await msg.endpoint.command('zosungIRControl', 'zosungControlIRCommand00',
                {
                    data: Buffer.from(JSON.stringify({'study': 1})),
                },
                {disableDefaultResponse: true});
            return {
                learned_ir_code: learnedIRCode,
            };
        },
    },
};

// ---------------------------------------------------------------------------
// 4. toZigbee converters (MQTT -> device)
// ---------------------------------------------------------------------------

const tzZosung = {
    zosung_ir_code_to_send: {
        key: ['ir_code_to_send'],
        convertSet: async (entity, key, value, meta) => {
            if (!value) {
                logger.error(`There is no IR code to send`);
                return;
            }
            const irMsg = JSON.stringify({
                'key_num': 1,
                'delay': 300,
                'key1': {
                    'num': 1,
                    'freq': 38000,
                    'type': 1,
                    'key_code': value,
                },
            });
            logger.debug(`Sending IR code: ${JSON.stringify(value)}`);
            const seq = nextSeq(entity);
            messagesSet(entity, seq, irMsg);
            await entity.command('zosungIRTransmit', 'zosungSendIRCode00',
                {
                    seq: seq,
                    length: irMsg.length,
                    unk1: 0x00000000,
                    unk2: 0xe004,
                    unk3: 0x01,
                    cmd: 0x02,
                    unk4: 0x0000,
                },
                {disableDefaultResponse: true});
            logger.debug(`Sending IR code initiated.`);
        },
    },
    zosung_learn_ir_code: {
        key: ['learn_ir_code'],
        convertSet: async (entity, key, value, meta) => {
            logger.debug(`Starting IR Code Learning...`);
            await entity.command('zosungIRControl', 'zosungControlIRCommand00',
                {
                    data: Buffer.from(JSON.stringify({'study': 0})),
                },
                {disableDefaultResponse: true});
            logger.debug(`IR Code Learning started.`);
        },
    },
};

// ---------------------------------------------------------------------------
// 5. TS1201 device definition
// ---------------------------------------------------------------------------

const ts1201Definition = {
    zigbeeModel: ['TS1201'],
    fingerprint: [
        {modelID: 'TS1201', manufacturerName: '_TZ3290_7v1k4vufotpowp9z'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_rlkmy85q4pzoxobl'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_jxvzqatwgsaqzx1u'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_lypnqvlem5eq1ree'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_uc8lwbi2'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_nba3knpsarkawgnt'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_8xzb2ghn'},
        {modelID: 'TS1201', manufacturerName: '_TZ3290_s6ezpa3j'},
    ],
    model: 'ZS06',
    vendor: 'TuYa',
    description: 'Universal smart IR remote control',
    fromZigbee: [
        fzZosung.zosung_send_ir_code_00,
        fzZosung.zosung_send_ir_code_01,
        fzZosung.zosung_send_ir_code_02,
        fzZosung.zosung_send_ir_code_03,
        fzZosung.zosung_send_ir_code_04,
        fzZosung.zosung_send_ir_code_05,
    ],
    toZigbee: [tzZosung.zosung_ir_code_to_send, tzZosung.zosung_learn_ir_code],
};

// ---------------------------------------------------------------------------
// 6. Register the device definition with zigbee-herdsman-converters
// ---------------------------------------------------------------------------

function registerTS1201Device() {
    const devices = zigbeeHerdsmanConverters.devices;

    // Add the TS1201 device to the devices array
    devices.push(ts1201Definition);

    // The converters 12.0.81 builds internal lookup maps (byZigbeeModel, withFingerprint)
    // at module load time. Since we're adding the device after loading, we need to
    // patch the lookup functions to also check our device.
    const originalFindByDevice = zigbeeHerdsmanConverters.findByDevice;
    zigbeeHerdsmanConverters.findByDevice = function(device) {
        const result = originalFindByDevice(device);
        if (result) return result;
        // Check if it's a TS1201 device
        if (device && device.modelID === 'TS1201') return ts1201Definition;
        return null;
    };

    const originalFindByZigbeeModel = zigbeeHerdsmanConverters.findByZigbeeModel;
    zigbeeHerdsmanConverters.findByZigbeeModel = function(model) {
        const result = originalFindByZigbeeModel(model);
        if (result) return result;
        if (model && model.toLowerCase() === 'ts1201') return ts1201Definition;
        return null;
    };

    logger.info(`Registered TS1201 (ZS06) IR Blaster device definition ` +
        `(${ts1201Definition.fingerprint.length} manufacturer variants)`);
}

// ---------------------------------------------------------------------------
// 7. Main initialization function
// ---------------------------------------------------------------------------

function initialize() {
    registerZosungClusters();
    registerTS1201Device();
    logger.info('Zosung IR Blaster (TS1201/ZS06) support initialized');
}

module.exports = {
    initialize,
    fzZosung,
    tzZosung,
    ts1201Definition,
};
