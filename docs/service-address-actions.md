# Service address actions

Customer service-property cards (Overview and Properties & Equipment), the schedule list, and the calendar appointment dialog offer Copy Address, Apple Maps, and Google Maps. Controls wrap on narrow screens with 44px minimum touch height and keyboard focus styles.

Only service-location fields are included. Billing addresses, customer names, access notes, and gate codes are never included. Imported street/unit fields are formatted once, preserving text postal codes. Missing fields are omitted rather than inventing locality. Map links encode the destination and open directions only when clicked; there is no map API, API key, geocoding, automatic location lookup, or background transmission.

Legacy jobs store free-text locations rather than a property ID. A unique exact match against that customer's service properties adds its locality. Multiple matches, placeholder locations, and unmatched project/lot labels have no actions; users should verify the actual service property on the customer record. Other saved free-text addresses remain usable as entered. The implementation does not substitute the first property or a billing address, or modify stored records. A partial address may require confirmation in the map app.

Copy prefers the browser Clipboard API, then tries a temporary local selection inside the active dialog if applicable. A false/failed copy shows a selectable manual-copy field. Success and failure are announced through a live status region. Focus and prior selection are restored after fallback.

## Verification

Run `npm run release:check`. Synthetic regression tests cover address formatting, unit deduplication, postal codes, missing fields, map escaping, multiple-property identity, project placeholders, accessible action markup, and clipboard success/failure/selection cleanup. No live customer fixtures are used.

Before release, verify in an iPhone/Android browser: copy, denied clipboard/manual copy, Maps app/browser handoff, partial addresses, narrow-screen wrapping, and calendar dialog close/reopen. Native Maps app launch depends on the device/browser and installed apps.
