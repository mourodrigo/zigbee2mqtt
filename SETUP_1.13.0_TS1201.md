# Zigbee2MQTT 1.13.0 + TS1201 IR Blaster Setup for macOS Catalina

This guide explains how to set up Zigbee2MQTT 1.13.0 with support for the
**Tuya TS1201 (ZS06) Universal Smart IR Remote Control** using a **TI CC2531USB**
coordinator adapter at the default baud rate of 38400.

## Overview

Zigbee2MQTT 1.13.0 is the latest version compatible with macOS Catalina (10.15).
However, the TS1201 IR blaster device (manufacturer: `_tz3290_nba3knpsarkawgnt`)
was not yet supported in zigbee-herdsman-converters 12.0.81 (the version bundled
with 1.13.0). This setup backports the necessary Zosung IR protocol support from
the current master branch.

## Changes Made

### New File: `lib/util/zosungSupport.js`

This is the core module that adds TS1201 support. It:

1. **Registers custom Zigbee clusters** with zigbee-herdsman:
   - `zosungIRTransmit` (cluster ID: `0xED00`) — handles the multi-step IR code
     transfer protocol between the coordinator and the IR blaster
   - `zosungIRControl` (cluster ID: `0xE004`) — handles IR learning mode control

2. **Adds fromZigbee converters** (device → MQTT):
   - 6 converters handling the bidirectional IR code transfer protocol stages
   - Supports both sending IR codes and learning new codes from physical remotes

3. **Adds toZigbee converters** (MQTT → device):
   - `ir_code_to_send` — sends a base64-encoded IR code to the device for transmission
   - `learn_ir_code` — puts the device into IR learning mode

4. **Registers the TS1201 device definition** with all known manufacturer variants:
   - `_TZ3290_7v1k4vufotpowp9z`
   - `_TZ3290_rlkmy85q4pzoxobl`
   - `_TZ3290_jxvzqatwgsaqzx1u`
   - `_TZ3290_lypnqvlem5eq1ree`
   - `_TZ3290_uc8lwbi2`
   - `_TZ3290_nba3knpsarkawgnt`
   - `_TZ3290_8xzb2ghn`
   - `_TZ3290_s6ezpa3j`

### Modified: `lib/controller.js` (2 changes)

1. **Import zosungSupport** — adds `require('./util/zosungSupport')` at the top
2. **Initialize before Zigbee start** — calls `zosungSupport.initialize()` before
   `this.zigbee.start()` so clusters and device definitions are registered first
3. **Await onZigbeeEvent extensions** — changes `this.callExtensionMethod('onZigbeeEvent', ...)`
   to `await this.callExtensionMethod(...)` so async converters complete properly

### Modified: `lib/extension/receive.js` (3 changes)

1. **Make `onZigbeeEvent` async** — changes from `onZigbeeEvent(...)` to `async onZigbeeEvent(...)`
2. **Use `for...of` instead of `forEach`** — enables proper `await` within the loop
3. **Await converter results** — changes `converter.convert(...)` to `await converter.convert(...)`
   so the Zosung protocol's multi-step async operations complete correctly

## Quick Setup

```bash
# 1. Clone or checkout zigbee2mqtt at tag 1.13.0
git clone https://github.com/Koenkk/zigbee2mqtt.git
cd zigbee2mqtt
git checkout 1.13.0

# 2. Install dependencies
npm install

# 3. Copy zosungSupport.js to lib/util/
cp /path/to/zosungSupport.js lib/util/

# 4. Apply the controller.js and receive.js patches
# (See "Applying Changes" section below)

# 5. Configure your coordinator in data/configuration.yaml
# (See "Configuration" section below)

# 6. Start
npm start
```

## Applying Changes

### Option A: Apply the unified diff patch

Save the patch content from `patches/1.13.0-ts1201.diff` and apply:

```bash
git apply patches/1.13.0-ts1201.diff
```

### Option B: Manual edits

#### `lib/controller.js`

1. Add this import after the `ExtensionOTAUpdate` require line (around line 27):
   ```javascript
   const zosungSupport = require('./util/zosungSupport');
   ```

2. Add these lines in the `start()` method, just before `// Start zigbee` (around line 103):
   ```javascript
   // Initialize Zosung IR Blaster (TS1201) support
   // Registers custom clusters and device definition before Zigbee starts
   zosungSupport.initialize();
   ```

3. In the `onZigbeeEvent` method, change:
   ```javascript
   this.callExtensionMethod('onZigbeeEvent', [type, data, resolvedEntity]);
   ```
   to:
   ```javascript
   await this.callExtensionMethod('onZigbeeEvent', [type, data, resolvedEntity]);
   ```

#### `lib/extension/receive.js`

1. Change the method signature from:
   ```javascript
   onZigbeeEvent(type, data, resolvedEntity) {
   ```
   to:
   ```javascript
   async onZigbeeEvent(type, data, resolvedEntity) {
   ```

2. Change the converter loop from:
   ```javascript
   converters.forEach((converter) => {
       const options = {...settings.get().device_options, ...settings.getDevice(data.device.ieeeAddr)};
       const converted = converter.convert(resolvedEntity.definition, data, publish, options, meta);
       if (converted) {
           payload = {...payload, ...converted};
       }
   });
   ```
   to:
   ```javascript
   for (const converter of converters) {
       const options = {...settings.get().device_options, ...settings.getDevice(data.device.ieeeAddr)};
       const converted = await converter.convert(resolvedEntity.definition, data, publish, options, meta);
       if (converted) {
           payload = {...payload, ...converted};
       }
   }
   ```

## Configuration

Add the following to your `data/configuration.yaml`:

```yaml
# MQTT connection
mqtt:
  base_topic: zigbee2mqtt
  server: 'mqtt://localhost'

# Serial port for CC2531USB
serial:
  port: /dev/tty.usbmodem14101  # macOS path - adjust for your system
  adapter: zstack

# Advanced settings
advanced:
  baudrate: 38400               # CC2531 default baud rate
  rtscts: false
  adapter_concurrent: 2         # Recommended for CC2531
```

## Usage

### Sending IR Codes

Publish to MQTT topic `zigbee2mqtt/<device_name>/set`:

```json
{"ir_code_to_send": "<base64_encoded_ir_code>"}
```

### Learning IR Codes

1. Start learning mode by publishing to `zigbee2mqtt/<device_name>/set`:
   ```json
   {"learn_ir_code": "ON"}
   ```

2. Point your physical remote at the IR blaster and press a button.

3. The learned IR code will be published to `zigbee2mqtt/<device_name>`:
   ```json
   {"learned_ir_code": "<base64_encoded_ir_code>"}
   ```

4. Save this code and use it with `ir_code_to_send` to replay the command.

## Compatibility

- **macOS**: macOS Catalina 10.15 (tested)
- **Node.js**: 10.x, 12.x, or 13.x (as required by zigbee2mqtt 1.13.0)
- **Coordinator**: TI CC2531USB (Z-Stack adapter)
- **Device**: Tuya TS1201 / ZS06 IR blaster (all manufacturer variants)
- **zigbee-herdsman**: 0.12.83 (bundled with 1.13.0)
- **zigbee-herdsman-converters**: 12.0.81 (bundled with 1.13.0, extended at runtime)
