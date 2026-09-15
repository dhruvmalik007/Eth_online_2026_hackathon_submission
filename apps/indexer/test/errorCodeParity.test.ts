import { describe, expect, it } from "vitest";

import { ERROR_CODES as API_CODES } from "../api/_lib/errorCodes.js";
import { ERROR_CODES as CONSOLE_CODES } from "../console/src/classify.js";

/**
 * The console restates the error contract instead of importing it, because a browser program and a
 * server program cannot share a compiler configuration: the API types against Node's `Request` and
 * `Response`, the console against the DOM's, and one program holding both loses the members of
 * whichever declaration loses the resolution — which is a build that passes on one machine and fails
 * on another. See the note at the top of `console/src/classify.ts`.
 *
 * This test is what keeps the restatement from becoming the "second copy that will be wrong". It runs
 * here, under the API's configuration, which is the one place both lists are in scope.
 */
describe("the console's copy of the API's error contract", () => {
  it("matches it exactly, including order", () => {
    // Order matters because the list is read by eye against the API's; a reshuffle is a diff that
    // looks like a change and is not one.
    expect(CONSOLE_CODES).toEqual(API_CODES);
  });

  it("is long enough for the comparison above to mean something", () => {
    // Guards the vacuous pass: two empty arrays are also equal.
    expect(API_CODES.length).toBeGreaterThan(5);
  });
});
