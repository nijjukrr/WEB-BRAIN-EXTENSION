import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { inspectDocument } from "../dist/dom-perception.js";

function createFixture(html) {
  const dom = new JSDOM(html, {
    url: "https://example.test/checkout",
    pretendToBeVisual: true
  });

  const { document } = dom.window;
  const boxes = new Map();

  document.setBox = (selector, box) => {
    boxes.set(document.querySelector(selector), box);
  };

  for (const element of document.querySelectorAll("*")) {
    element.getBoundingClientRect = () => {
      const box = boxes.get(element) ?? { x: 0, y: 0, width: 10, height: 10 };
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        top: box.y,
        left: box.x,
        right: box.x + box.width,
        bottom: box.y + box.height,
        toJSON() {
          return this;
        }
      };
    };
  }

  return document;
}

test("extracts normalized metadata for a labelled email input", () => {
  const document = createFixture(`
    <form id="checkout" class="flow primary">
      <label for="email">Email address</label>
      <input
        id="email"
        class="field private"
        type="email"
        name="customer_email"
        placeholder="you@example.com"
        autocomplete="email"
        aria-label="Customer email"
        value="secret@example.test"
      />
      <button id="submit-order" class="primary-button">Submit order</button>
    </form>
  `);

  document.setBox("#email", { x: 20, y: 40, width: 240, height: 32 });

  const elements = inspectDocument(document);
  const email = elements.find((element) => element.domId === "email");

  assert.ok(email);
  assert.equal(email.id.startsWith("element_"), true);
  assert.equal(email.tag, "input");
  assert.deepEqual(email.classes, ["field", "private"]);
  assert.equal(email.type, "email");
  assert.equal(email.name, "customer_email");
  assert.equal(email.placeholder, "you@example.com");
  assert.equal(email.autocomplete, "email");
  assert.equal(email.ariaLabel, "Customer email");
  assert.equal(email.label, "Email address");
  assert.equal(email.role, "textbox");
  assert.equal(email.text, null);
  assert.deepEqual(email.bbox, {
    x: 20,
    y: 40,
    width: 240,
    height: 32,
    top: 40,
    right: 260,
    bottom: 72,
    left: 20
  });
  assert.equal(email.visible, true);
  assert.equal(email.enabled, true);
});

test("extracts safe visible text for buttons and infers roles", () => {
  const document = createFixture(`
    <h1>Checkout</h1>
    <a href="/cart" aria-label="Open cart">Cart</a>
    <button disabled>Pay now</button>
  `);

  const elements = inspectDocument(document);
  const heading = elements.find((element) => element.tag === "h1");
  const link = elements.find((element) => element.tag === "a");
  const button = elements.find((element) => element.tag === "button");

  assert.equal(heading?.role, "heading");
  assert.equal(heading?.text, "Checkout");
  assert.equal(link?.role, "link");
  assert.equal(link?.text, "Cart");
  assert.equal(link?.ariaLabel, "Open cart");
  assert.equal(button?.role, "button");
  assert.equal(button?.text, "Pay now");
  assert.equal(button?.enabled, false);
});

test("marks hidden and disabled controls accurately", () => {
  const document = createFixture(`
    <input id="hidden-token" type="hidden" name="token" value="abc" />
    <input id="css-hidden" style="display: none" />
    <input id="disabled-field" disabled />
    <div role="button" aria-disabled="true">Fake button</div>
  `);

  const elements = inspectDocument(document);
  const hiddenToken = elements.find((element) => element.domId === "hidden-token");
  const cssHidden = elements.find((element) => element.domId === "css-hidden");
  const disabledField = elements.find((element) => element.domId === "disabled-field");
  const ariaDisabled = elements.find((element) => element.role === "button" && element.tag === "div");

  assert.equal(hiddenToken?.visible, false);
  assert.equal(cssHidden?.visible, false);
  assert.equal(disabledField?.enabled, false);
  assert.equal(ariaDisabled?.enabled, false);
});

test("supports aria-labelledby and wrapped labels", () => {
  const document = createFixture(`
    <span id="phone-label">Mobile number</span>
    <input id="phone" type="tel" aria-labelledby="phone-label" />
    <label>Full name <input id="name" name="full_name" /></label>
  `);

  const elements = inspectDocument(document);
  const phone = elements.find((element) => element.domId === "phone");
  const name = elements.find((element) => element.domId === "name");

  assert.equal(phone?.label, "Mobile number");
  assert.equal(phone?.role, "textbox");
  assert.equal(name?.label, "Full name");
  assert.equal(name?.name, "full_name");
});
