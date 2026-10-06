import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatServiceAddress, jobServiceAddress, serviceAddressLinks } from "../shared/service-address";
import { ServiceAddressActions } from "../client/src/components/service-address-actions";

const first = { address: "100 Example St, Unit #2", street: "100 Example St", unit: "Unit #2", city: "Test City", state: "MO", zip: "00123" };
test("formats service fields, units, whitespace, text postal codes and partial addresses", () => {
  assert.equal(formatServiceAddress(first), "100 Example St, Unit #2, Test City, MO 00123");
  assert.equal(formatServiceAddress({ address: "100 Example St, Unit #2", unit: "Unit #2" }), "100 Example St, Unit #2");
  assert.equal(formatServiceAddress({ street: "Road 2", unit: "2" }), "Road 2, 2");
  assert.equal(formatServiceAddress({ address: "  2  Test Lane \n", city: "", state: "MO", zip: "" }), "2 Test Lane, MO");
  assert.equal(formatServiceAddress({ city: "Test City", zip: "00123" }), "Test City, 00123");
  assert.equal(formatServiceAddress({}), "");
  assert.equal(formatServiceAddress(), "");
  assert.equal(formatServiceAddress({ ...first, gateCode: "SECRET", accessNotes: "Private" } as any).includes("SECRET"), false);
});
test("map links encode the exact full destination without an API key or automatic requests", () => {
  const address = "100 A&B St, Unit #2/3, St. John's, MO 00123";
  const links = serviceAddressLinks(address);
  assert.equal(new URL(links.apple).searchParams.get("daddr"), address);
  assert.equal(new URL(links.google).searchParams.get("destination"), address);
  assert.equal(new URL(links.google).searchParams.get("api"), "1");
  assert.equal(new URL(links.apple).hash, "");
});
test("jobs enrich only the uniquely matching service property and never choose the first or billing location", () => {
  const second = { address: "200 Other Rd", city: "Other City", state: "KS", zip: "66000" };
  assert.equal(jobServiceAddress({ property: second.address }, [first, second]), formatServiceAddress(second));
  assert.equal(jobServiceAddress({ property: first.address }, [first, second]), formatServiceAddress(first));
  assert.equal(jobServiceAddress({ property: "100 Example St" }, [first, { ...first, unit: "Unit #3", address: "100 Example St, Unit #3" }]), "");
  assert.equal(jobServiceAddress({ property: "10 Shared Rd" }, [{ address: "10 Shared Rd", city: "A" }, { address: "10 Shared Rd", city: "B" }]), "");
  assert.equal(jobServiceAddress({ property: "  TBD " }, [first]), "");
  assert.equal(jobServiceAddress({}, [first]), "");
  assert.equal(jobServiceAddress({ property: "Lot 10", projectName: "Lot 10" }, [first]), "");
  assert.equal(jobServiceAddress({ property: "300 Saved St, Test City, MO" }, [first]), "300 Saved St, Test City, MO");
});
test("actions render explicit touch-friendly buttons, accessible grouped links, and nothing for missing addresses", () => {
  const html = renderToStaticMarkup(React.createElement(ServiceAddressActions, { address: formatServiceAddress(first) }));
  assert.match(html, /Copy Address/);
  assert.match(html, /Apple Maps/);
  assert.match(html, /Google Maps/);
  assert.match(html, /min-h-11/);
  assert.match(html, /role="group"/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.equal((html.match(/<a /g) || []).length, 2);
  assert.equal(renderToStaticMarkup(React.createElement(ServiceAddressActions, { address: " " })), "");
});
