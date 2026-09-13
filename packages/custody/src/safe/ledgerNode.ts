/**
 * Node.js wiring for the Ledger transport.
 *
 * Kept out of `LedgerSignerAdapter` deliberately: `node-hid` is a native module,
 * so importing the adapter (in a test, or a browser bundle) must not drag it in.
 * Platform wiring lives here; the adapter stays transport-agnostic.
 */
import {
  DeviceManagementKitBuilder,
  type DeviceManagementKit,
  type DeviceSessionId,
} from "@ledgerhq/device-management-kit";
import { nodeHidTransportFactory } from "@ledgerhq/device-transport-kit-node-hid";
import { filter, firstValueFrom, take, timeout } from "rxjs";

/** How long to look for a connected device before giving up. */
export const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000;

/**
 * Build a DMK instance for Node.
 *
 * Create exactly one per process: each Node-HID transport registers USB hotplug
 * listeners, and multiple instances stack them up.
 */
export function createNodeDmk(): DeviceManagementKit {
  return new DeviceManagementKitBuilder().addTransport(nodeHidTransportFactory).build();
}

/**
 * Connect the first Ledger that is already paired with the machine.
 *
 * Uses `listenToAvailableDevices` rather than `startDiscovering`: the latter
 * triggers a browser permission dialog, which does not exist in Node, so a CLI
 * would otherwise wait forever.
 *
 * @throws {Error} if no device appears within `timeoutMs`.
 */
export async function connectFirstDevice(
  dmk: DeviceManagementKit,
  timeoutMs: number = DEFAULT_DISCOVERY_TIMEOUT_MS,
): Promise<DeviceSessionId> {
  const devices = await firstValueFrom(
    dmk.listenToAvailableDevices({}).pipe(
      filter((available) => available.length > 0),
      take(1),
      timeout({ first: timeoutMs }),
    ),
  );
  const device = devices[0];
  if (device === undefined) {
    throw new Error("No Ledger device detected. Connect one and unlock it, then retry.");
  }
  return dmk.connect({ device });
}
