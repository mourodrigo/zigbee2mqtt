import zhc from 'zigbee-herdsman-converters';
import * as settings from '../util/settings';
import utils from '../util/utils';
import Extension from './extension';

// Additional TS1201 manufacturer fingerprints not yet included in zigbee-herdsman-converters@15.67.1.
// These are backported from the latest upstream converters to support additional Tuya ZS06 IR blaster variants.
const additionalTS1201Manufacturers: string[] = [
    '_TZ3290_nba3knpsarkawgnt',
    '_TZ3290_rlkmy85q4pzoxobl',
    '_TZ3290_jxvzqatwgsaqzx1u',
    '_TZ3290_lypnqvlem5eq1ree',
    '_TZ3290_uc8lwbi2',
    '_TZ3290_8xzb2ghn',
    '_TZ3290_s6ezpa3j',
];

function registerAdditionalTS1201Definitions(): void {
    // Find the existing ZS06 definition to reuse its converters and exposes
    const existingZS06 = zhc.definitions.find((d) => d.model === 'ZS06');
    if (!existingZS06) return;

    // Build fingerprint entries only for manufacturers not already registered
    const existingFingerprints = (existingZS06 as KeyValue).fingerprint || [];
    const existingManufacturers = new Set(
        existingFingerprints.map((fp: KeyValue) => fp.manufacturerName),
    );

    const newFingerprints = additionalTS1201Manufacturers
        .filter((m) => !existingManufacturers.has(m))
        .map((manufacturerName) => ({modelID: 'TS1201', manufacturerName}));

    if (newFingerprints.length === 0) return;

    // Register a new definition with the additional fingerprints, reusing all
    // converters and exposes from the existing ZS06 definition.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (zhc.addDeviceDefinition as any)({
        fingerprint: newFingerprints,
        model: 'ZS06',
        vendor: existingZS06.vendor,
        description: existingZS06.description,
        fromZigbee: [...existingZS06.fromZigbee],
        toZigbee: [...existingZS06.toZigbee],
        exposes: Array.isArray(existingZS06.exposes) ? [...existingZS06.exposes] : existingZS06.exposes,
    });
}

export default class ExternalConverters extends Extension {
    constructor(zigbee: Zigbee, mqtt: MQTT, state: State, publishEntityState: PublishEntityState,
        eventBus: EventBus, enableDisableExtension: (enable: boolean, name: string) => Promise<void>,
        restartCallback: () => void, addExtension: (extension: Extension) => Promise<void>) {
        super(zigbee, mqtt, state, publishEntityState, eventBus, enableDisableExtension, restartCallback, addExtension);

        // Register additional TS1201 IR blaster manufacturer fingerprints
        registerAdditionalTS1201Definitions();

        for (const definition of utils.getExternalConvertersDefinitions(settings.get())) {
            const toAdd = {...definition};
            delete toAdd['homeassistant'];
            zhc.addDeviceDefinition(toAdd);
        }
    }
}
