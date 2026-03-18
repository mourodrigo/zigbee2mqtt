const zosungSupport = require('../lib/util/zosungSupport');
const zigbeeHerdsmanConverters = require('zigbee-herdsman-converters');

describe('Zosung IR Blaster (TS1201) support', () => {
    beforeEach(() => {
        // Reset cluster definitions to their original state before each test
        const ZclDef = require('zigbee-herdsman/dist/zcl/definition');
        const Cluster = ZclDef.default || ZclDef.Cluster || ZclDef;
        delete Cluster.zosungIRTransmit;
        delete Cluster.zosungIRControl;
    });

    it('Should register Zosung IR custom clusters with zigbee-herdsman', () => {
        const ZclDef = require('zigbee-herdsman/dist/zcl/definition');
        const Cluster = ZclDef.default || ZclDef.Cluster || ZclDef;

        // Before initialization, clusters should not exist
        expect(Cluster.zosungIRTransmit).toBeUndefined();
        expect(Cluster.zosungIRControl).toBeUndefined();

        // Initialize
        zosungSupport.initialize();

        // After initialization, clusters should be registered
        expect(Cluster.zosungIRTransmit).toBeDefined();
        expect(Cluster.zosungIRTransmit.ID).toBe(0xed00);
        expect(Cluster.zosungIRTransmit.commands).toBeDefined();
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode00).toBeDefined();
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode00.ID).toBe(0x00);
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode01.ID).toBe(0x01);
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode02.ID).toBe(0x02);
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode03.ID).toBe(0x03);
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode04.ID).toBe(0x04);
        expect(Cluster.zosungIRTransmit.commands.zosungSendIRCode05.ID).toBe(0x05);
        expect(Cluster.zosungIRTransmit.commandsResponse.zosungSendIRCode03Resp).toBeDefined();
        expect(Cluster.zosungIRTransmit.commandsResponse.zosungSendIRCode05Resp).toBeDefined();

        expect(Cluster.zosungIRControl).toBeDefined();
        expect(Cluster.zosungIRControl.ID).toBe(0xe004);
        expect(Cluster.zosungIRControl.commands.zosungControlIRCommand00).toBeDefined();
    });

    it('Should register TS1201 device definition with zigbee-herdsman-converters', () => {
        const devicesBefore = zigbeeHerdsmanConverters.devices.length;

        zosungSupport.initialize();

        // Device should be added to the converters
        const devicesAfter = zigbeeHerdsmanConverters.devices.length;
        expect(devicesAfter).toBeGreaterThan(devicesBefore);

        // Find the TS1201 device
        const ts1201 = zigbeeHerdsmanConverters.devices.find((d) =>
            d.zigbeeModel && d.zigbeeModel.includes('TS1201'),
        );
        expect(ts1201).toBeDefined();
        expect(ts1201.model).toBe('ZS06');
        expect(ts1201.vendor).toBe('TuYa');
        expect(ts1201.description).toContain('IR remote control');
    });

    it('Should be findable by zigbeeModel TS1201', () => {
        zosungSupport.initialize();

        const definition = zigbeeHerdsmanConverters.findByZigbeeModel('TS1201');
        expect(definition).toBeDefined();
        expect(definition.model).toBe('ZS06');
    });

    it('Should include manufacturer _tz3290_nba3knpsarkawgnt in fingerprints', () => {
        const ts1201 = zosungSupport.ts1201Definition;
        expect(ts1201.fingerprint).toBeDefined();
        const hasNba3 = ts1201.fingerprint.some(
            (fp) => fp.manufacturerName === '_TZ3290_nba3knpsarkawgnt',
        );
        expect(hasNba3).toBe(true);
    });

    it('Should have correct fromZigbee converters for IR protocol', () => {
        const ts1201 = zosungSupport.ts1201Definition;
        expect(ts1201.fromZigbee).toBeDefined();
        expect(ts1201.fromZigbee.length).toBe(6);

        // Verify all IR code converters are present
        const clusters = ts1201.fromZigbee.map((c) => c.cluster);
        expect(clusters.every((c) => c === 'zosungIRTransmit')).toBe(true);
    });

    it('Should have correct toZigbee converters for IR control', () => {
        const ts1201 = zosungSupport.ts1201Definition;
        expect(ts1201.toZigbee).toBeDefined();
        expect(ts1201.toZigbee.length).toBe(2);

        const keys = ts1201.toZigbee.flatMap((c) => c.key);
        expect(keys).toContain('ir_code_to_send');
        expect(keys).toContain('learn_ir_code');
    });

    it('Should have toZigbee converter for ir_code_to_send with convertSet', () => {
        const converter = zosungSupport.tzZosung.zosung_ir_code_to_send;
        expect(converter.key).toContain('ir_code_to_send');
        expect(converter.convertSet).toBeDefined();
        expect(typeof converter.convertSet).toBe('function');
    });

    it('Should have toZigbee converter for learn_ir_code with convertSet', () => {
        const converter = zosungSupport.tzZosung.zosung_learn_ir_code;
        expect(converter.key).toContain('learn_ir_code');
        expect(converter.convertSet).toBeDefined();
        expect(typeof converter.convertSet).toBe('function');
    });

    it('Should have fromZigbee converters for all IR code stages', () => {
        const fz = zosungSupport.fzZosung;
        expect(fz.zosung_send_ir_code_00.type).toContain('commandZosungSendIRCode00');
        expect(fz.zosung_send_ir_code_01.type).toContain('commandZosungSendIRCode01');
        expect(fz.zosung_send_ir_code_02.type).toContain('commandZosungSendIRCode02');
        expect(fz.zosung_send_ir_code_03.type).toContain('zosungSendIRCode03Resp');
        expect(fz.zosung_send_ir_code_04.type).toContain('commandZosungSendIRCode04');
        expect(fz.zosung_send_ir_code_05.type).toContain('zosungSendIRCode05Resp');
    });
});
