/**
 * What the delivery GROUP knows about itself that the one app's `src/config.ts` must not carry.
 *
 * `GROUPS.delivery` (docs/31 §1.4) holds what every group has — the role it elects, its title, its
 * service port, its touch floor and density, its offline store prefix. This file is the remainder:
 * the one constant that belonged to `delivery-app/src/config.ts` and is meaningful to nothing else
 * in the app. Folding it into the root table would put a DPDP notice version in front of five groups
 * that never show a notice.
 */

/**
 * The version of the location notice this build shows (`location_consents.policy_version`).
 *
 * DPDP: consent is recorded against the TEXT the person saw, so changing `d2.consentBody` in
 * `./strings.ts` means changing this string in the same commit — otherwise the office holds an
 * agreement to a notice nobody read. The demo data acknowledges this same version.
 */
export const GPS_NOTICE_VERSION = 'gps-notice-2026-09'
