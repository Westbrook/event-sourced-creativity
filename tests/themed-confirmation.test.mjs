import test from "node:test";
import assert from "node:assert/strict";
import { confirmationFixture, turn } from "./helpers/themed-confirmation-native.mjs";

// Complete current helper/foundation/focus implementation; finite native DOM
// controls only. isTrusted below is a platform event port, not browser proof.
for (const locale of ["en", "fr", "ar", "ja"]) test(`${locale} themed confirmation uses native modality, literal copy, safe initial focus and explicit approval`, async (t) => {
  const f = await confirmationFixture(t, { locale }), operation = f.begin();
  const dialog = f.dialog(), form = dialog.querySelector("form"), heading = dialog.querySelector("h2"), detail = dialog.querySelector("p");
  assert.equal(f.trace.filter(([kind]) => kind === "showModal").length, 1);
  assert.equal(dialog.className, "modal shared-confirmation-dialog");
  assert.equal(form.className, "modal-card ui-dialog-card");
  assert.equal(form.method, "dialog");
  assert.equal(dialog.lang, locale); assert.equal(dialog.dir, locale === "ar" ? "rtl" : "ltr");
  assert.equal(dialog.getAttribute("aria-labelledby"), heading.id);
  assert.equal(dialog.getAttribute("aria-describedby"), detail.id);
  assert.equal(heading.textContent, operation.options.title);
  assert.equal(detail.textContent, operation.options.message); assert.equal(detail.children.length, 0);
  const [cancel, confirm] = f.buttons();
  assert.equal(cancel.textContent, f.i18n.t("action.cancel")); assert.equal(confirm.textContent, f.i18n.t("dialog.confirm"));
  assert.equal(f.doc.activeElement, cancel);
  f.confirm(); assert.equal(await operation.result, true);
  assert.equal(f.dialog(), null); assert.equal(dialog.isConnected, false); assert.equal(dialog.children.length, 0);
  assert.equal(f.doc.activeElement, f.invoker); assert.equal(f.mutations.size, 0);
  assert.equal(f.transport.requests.length, 0);
});

const cancellations = {
  Cancel: (f) => f.cancel(),
  Escape: (f) => f.dialog().emit("cancel"),
  backdrop: (f) => f.dialog().emit("click"),
  "programmatic close with positive returnValue": (f) => f.dialog().close("confirm"),
  abort: (_f, operation) => operation.controller.abort(),
  "locale change": (f) => f.emitWindow("forma-locale-change"),
  "removed dialog": (f) => f.dialog().remove(),
};
for (const [reason, cancel] of Object.entries(cancellations)) test(`themed confirmation ${reason} is non-approval and leaves no active listener`, async (t) => {
  const f = await confirmationFixture(t), operation = f.begin(), old = f.dialog();
  cancel(f, operation); assert.equal(await operation.result, false);
  assert.equal(old.isConnected, false); assert.equal(f.dialog(), null); assert.equal(f.mutations.size, 0);
  assert.equal([...f.listeners.values()].reduce((count, listeners) => count + listeners.length, 0), 0);
  assert.equal(f.transport.requests.length, 0);
});

test("themed confirmation requires a consumed positive-button latch, exact submitter and trusted replay confirmation", async (t) => {
  const f = await confirmationFixture(t), operation = f.begin({ requireTrustedConfirmation: true });
  const dialog = f.dialog(), form = dialog.querySelector("form"), [cancel, confirm] = f.buttons();
  let settled = false; operation.result.then(() => { settled = true; });
  form.emit("submit", { submitter: confirm, isTrusted: true }); await turn(); assert.equal(settled, false, "submit alone is not approval");
  confirm.emit("click", { isTrusted: true }); form.emit("submit", { submitter: cancel, isTrusted: true });
  form.emit("submit", { submitter: confirm, isTrusted: true }); await turn(); assert.equal(settled, false, "wrong submitter consumes the old latch");
  f.confirm(false); await turn(); assert.equal(settled, false, "untrusted final event cannot approve Replay");
  confirm.disabled = true; f.confirm(); await turn(); assert.equal(settled, false, "disabled control cannot approve"); confirm.disabled = false;
  f.confirm(); assert.equal(await operation.result, true);
  form.emit("submit", { submitter: confirm, isTrusted: true }); confirm.emit("click", { isTrusted: true });
  assert.equal(f.dialog(), null); assert.equal(f.transport.requests.length, 0);
});

test("themed confirmation also rejects an unlatched non-Replay submission", async (t) => {
  const f = await confirmationFixture(t), operation = f.begin(), form = f.dialog().querySelector("form");
  let settled = false; operation.result.then(() => { settled = true; });
  form.emit("submit", { submitter: f.buttons()[1] }); await turn(); assert.equal(settled, false);
  f.cancel(); assert.equal(await operation.result, false);
});

for (const reason of ["inactive owner", "native modal failure", "existing other dialog"]) test(`themed confirmation fails closed for ${reason}`, async (t) => {
  const f = await confirmationFixture(t); let other;
  if (reason === "native modal failure") f.modalFailure = true;
  if (reason === "existing other dialog") { other = f.native("dialog"); f.doc.body.append(other); other.showModal(); }
  const operation = f.begin({ current: () => reason !== "inactive owner" });
  assert.equal(await operation.result, false);
  assert.equal(f.doc.querySelectorAll("dialog[open]").length, other ? 1 : 0);
  assert.equal(f.transport.requests.length, 0); other?.remove();
});

test("themed confirmation owner removal and reinsertion cannot revive old approval", async (t) => {
  const f = await confirmationFixture(t), operation = f.begin(), old = f.dialog(), form = old.querySelector("form"), confirm = f.buttons()[1];
  f.owner.remove(); f.doc.body.append(f.owner); await turn();
  assert.equal(await operation.result, false); assert.equal(old.isConnected, false);
  confirm.emit("click", { isTrusted: true }); form.emit("submit", { submitter: confirm, isTrusted: true });
  assert.equal(f.dialog(), null); assert.equal(f.transport.requests.length, 0);
});

test("themed confirmation reevaluates exact current authority at positive submission", async (t) => {
  const f = await confirmationFixture(t); let current = true;
  const operation = f.begin({ current: () => current }); current = false;
  f.confirm(); assert.equal(await operation.result, false); assert.equal(f.dialog(), null);
});

for (const gesture of ["pointerdown", "keydown", "focusin"]) test(`themed confirmation does not steal focus after a newer ${gesture} during close`, async (t) => {
  const f = await confirmationFixture(t), operation = f.begin(), dialog = f.dialog(), other = f.native("button");
  f.doc.body.append(other);
  const close = dialog.close;
  dialog.close = (value) => { close(value); other.focus(); f.emitWindow(gesture, { target: other }); };
  f.cancel(); assert.equal(await operation.result, false); assert.equal(f.doc.activeElement, other);
  assert.equal(f.trace.filter(([kind, node]) => kind === "focus" && node === f.invoker).length, 1, "only the original opening focus");
});

test("themed confirmation cannot approve or restore over another active dialog", async (t) => {
  const f = await confirmationFixture(t), operation = f.begin(), own = f.dialog(), form = own.querySelector("form"), confirm = f.buttons()[1];
  const other = f.native("dialog"), control = f.native("button"); other.append(control); f.doc.body.append(other); other.showModal(); control.focus();
  confirm.emit("click", { isTrusted: true }); form.emit("submit", { submitter: confirm, isTrusted: true });
  assert.equal(await operation.result, false); assert.equal(f.doc.activeElement, control); assert.equal(other.open, true); other.remove();
});

test("a retired confirmation's queued close cannot cancel or focus over a fresh explicit dialog", async (t) => {
  const f = await confirmationFixture(t), first = f.begin(), old = f.dialog();
  first.controller.abort(); assert.equal(await first.result, false);
  const next = f.begin(), active = f.dialog(), cancel = f.buttons()[0];
  old.emit("close"); await turn(); assert.equal(f.dialog(), active); assert.equal(f.doc.activeElement, cancel);
  f.confirm(); assert.equal(await next.result, true);
});
