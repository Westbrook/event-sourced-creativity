import { test, expect, attachJSON, captureViewport, openForma } from "./fixtures.mjs";
import { verifyFocus, tabTo } from "./helpers/keyboard-journey.mjs";
import { observeInitialSession } from "./helpers/initial-session.mjs";

// Conditional E1 observation, not an organization/authentication fixture.
const path = "/settings/workspaces";
const tasks = [["members", "workspace.member.read"], ["projects", "workspace.project.read"],
  ["usage", "workspace.usage.read"], ["activity", "workspace.audit.read"]];
const copy = {
  en: { direction: "ltr", heading: "Workspaces & collaboration", organizations: "Your organizations",
    empty: "You do not belong to any organizations yet.", navigation: "Organization settings", refresh: "Refresh",
    sections: { overview: "Overview", members: "Members", projects: "Projects", usage: "Usage", activity: "Activity" } },
  fr: { direction: "ltr", heading: "Espaces de travail et collaboration", organizations: "Vos organisations",
    empty: "Vous n’appartenez encore à aucune organisation.", navigation: "Paramètres de l’organisation", refresh: "Actualiser",
    sections: { overview: "Aperçu", members: "Membres", projects: "Projets", usage: "Utilisation", activity: "Activité" } },
  ar: { direction: "rtl", heading: "مساحات العمل والتعاون", organizations: "مؤسساتك",
    empty: "لا تنتمي إلى أي مؤسسة حتى الآن.", navigation: "إعدادات المؤسسة", refresh: "تحديث",
    sections: { overview: "نظرة عامة", members: "الأعضاء", projects: "المشروعات", usage: "الاستخدام", activity: "النشاط" } },
};

// Values and native identities stay in this browser-owned handle. Only equality,
// field/owner descriptors and counts may leave it; never raw settings or tokens.
const retainFields = owner => owner.evaluateHandle(element => {
  const read = field => JSON.stringify([field.value, Boolean(field.checked),
    field.tagName === "SELECT" ? [...field.options].map(option => option.selected) : null]);
  const changed = field => {
    if (field.tagName === "SELECT") {
      const options = [...field.options], explicit = options.filter(option => option.defaultSelected);
      const defaults = field.multiple ? explicit : [explicit.at(-1)
        ?? options.find(option => !option.disabled && !option.closest("optgroup[disabled]"))].filter(Boolean);
      return options.some(option => option.selected !== defaults.includes(option));
    }
    if (field.readOnly || !field.name || ["button", "submit", "reset", "hidden"].includes(field.type)) return false;
    return ["checkbox", "radio"].includes(field.type) ? field.checked !== field.defaultChecked : field.value !== field.defaultValue;
  };
  const forms = [...element.querySelectorAll("form.workspace-settings-form,form[data-workspace-review],form[data-workspace-policy]")]
    .map((node, index) => ({ node, index, policy: node.getAttribute("data-workspace-policy"),
      owner: node.getAttribute("data-workspace-policy-owner"), snapshot: node.getAttribute("data-workspace-policy-snapshot"),
      dirty: node.getAttribute("data-workspace-policy-dirty"),
      hadDraft: node.hasAttribute("data-workspace-policy") ? node.getAttribute("data-workspace-policy-dirty") === "true"
        : [...node.elements].filter(field => ["INPUT", "TEXTAREA", "SELECT"].includes(field.tagName)).some(changed) }));
  const fields = [...element.querySelectorAll("input,textarea,select")].map((node, index) => ({
    node, index, tag: node.tagName, type: node.type, name: node.name, raw: read(node),
    draft: forms.some(form => form.hadDraft && form.node.contains(node)),
  }));
  const href = location.href;
  return { inspect: () => {
    const sameOwner = element.isConnected && document.querySelectorAll("forma-workspace-settings").length === 1
      && document.querySelector("forma-workspace-settings") === element;
    const rows = fields.map(field => ({ index: field.index, tag: field.tag, type: field.type, name: field.name,
      connectedToSameOwner: field.node.isConnected && element.contains(field.node), valueEqual: read(field.node) === field.raw, draft: field.draft }));
    const owners = forms.map(form => ({ index: form.index, policy: form.policy, hadDraft: form.hadDraft,
      connectedToSameOwner: form.node.isConnected && element.contains(form.node),
      ownerEqual: form.node.getAttribute("data-workspace-policy-owner") === form.owner,
      snapshotEqual: form.node.getAttribute("data-workspace-policy-snapshot") === form.snapshot,
      dirtyEqual: form.node.getAttribute("data-workspace-policy-dirty") === form.dirty }));
    return { sameOwner, sameRoute: location.href === href, fields: rows, forms: owners,
      draftCount: forms.filter(form => form.hadDraft).length,
      allValuesEqual: rows.every(row => row.connectedToSameOwner && row.valueEqual),
      draftCustodyEqual: rows.filter(row => row.draft).every(row => row.connectedToSameOwner && row.valueEqual)
        && owners.filter(row => row.hadDraft).every(row => row.connectedToSameOwner && row.ownerEqual && row.snapshotEqual && row.dirtyEqual) };
  } };
});

const readGet = (page, pathname) => page.waitForResponse(response => response.request().method() === "GET"
  && new URL(response.url()).origin === new URL(page.url()).origin && new URL(response.url()).pathname === pathname)
  .then(async response => {
    expect(response.ok(), `The actual ${pathname} read must succeed; absence is not an empty-data pass`).toBe(true);
    return { status: response.status(), body: await response.json() };
  });

test("Settings: observe the landing and only existing readable organization tasks with native keys", async ({ page, context, geometry }, testInfo) => {
  const locale = geometry.locale ?? "en-US", expected = copy[locale.split("-")[0]];
  const coverage = { landing: "UNOBSERVED", organization: "UNOBSERVED: no actual readable organization established",
    tasks: Object.fromEntries(["overview", ...tasks.map(([key]) => key)].map(key => [key, "UNOBSERVED"])),
    memberRoleSelect: "UNOBSERVED", dirtyDraft: "UNOBSERVED: no draft is created by this test",
    refreshFocus: [], findings: [], limits: "One existing organization only. No settings write, new data, synthetic authority, popup, AT or production acceptance." };
  let complete = false;
  const sessionObservation = observeInitialSession(page, path);
  const owner = page.locator("forma-workspace-settings");
  const observeFocus = async (target, stage) => {
    await expect(target, `${stage}: native accessible name`).not.toHaveAccessibleName("");
    const result = await verifyFocus(page, target, testInfo, stage, { checkVisibleControls: true });
    expect(result.focus.raw.width, `${stage}: native control width`).toBeGreaterThanOrEqual(44);
    expect(result.focus.raw.height, `${stage}: native control height`).toBeGreaterThanOrEqual(44);
    const label = await target.evaluate((element, clip) => {
      if (!["A", "BUTTON"].includes(element.tagName)) return { coverage: "Native select/input text is not DOM Range paint", rectangles: [] };
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), rectangles = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0 && rect.height > 0) rectangles.push({
          left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
          insideClip: rect.left >= clip.left && rect.right <= clip.right && rect.top >= clip.top && rect.bottom <= clip.bottom });
      }
      return { coverage: "Actual label text ranges, not glyph/contrast conformance", required: true, rectangles };
    }, result.focus.intersection);
    await attachJSON(testInfo, `${stage}-label-ranges`, label);
    if (label.required) expect(label.rectangles.length, `${stage}: actual painted DOM label`).toBeGreaterThan(0);
    expect(label.rectangles.every(rect => rect.insideClip), `${stage}: complete DOM label inside actual scroll clip`).toBe(true);
    return result;
  };
  const departure = async stage => {
    const saved = await retainFields(owner);
    try {
      const result = await saved.evaluate(state => state.inspect());
      await attachJSON(testInfo, stage, result);
      expect(result.sameOwner && result.sameRoute).toBe(true);
      if (result.draftCount) {
        coverage.dirtyDraft = "OBSERVED: existing unsent native work left in place; task departure not attempted";
        coverage.findings.push({ stage, kind: "task-traversal-withheld-to-preserve-existing-draft" });
        return false;
      }
      return true;
    } finally { await saved.dispose(); }
  };
  try {
    expect(Boolean(expected), "Only the existing EN/FR/AR profiles are declared").toBe(true);
    const initial = readGet(page, "/api/workspaces");
    await openForma(page, context, geometry, path, testInfo);
    const overviewRead = await initial;
    const { session, evidence } = await sessionObservation.read();
    await attachJSON(testInfo, "authenticated-initial-session", evidence);
    const overview = overviewRead.body;
    expect(Boolean(session?.user?.userId), "Use the existing real account; never seed authentication").toBe(true);
    expect(["organizations", "projects", "invitations"].every(key => Array.isArray(overview?.[key]))).toBe(true);
    expect(overview.organizations.every(org => typeof org.organizationId === "string" && org.organizationId.length > 0
      && typeof org.name === "string" && typeof org.role === "string"
      && (org.permissions === undefined || Array.isArray(org.permissions) && org.permissions.every(value => typeof value === "string")))).toBe(true);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.locator("html")).toHaveAttribute("dir", expected.direction);
    await expect(page.locator("forma-ui-language-picker select:visible")).toHaveValue(locale.split("-")[0]);
    await expect(owner).toHaveCount(1);
    await expect(owner.locator("#workspace-settings-heading")).toHaveJSProperty("textContent", expected.heading);
    await expect(owner.locator(".workspace-settings-error")).toHaveCount(0);
    const organizations = owner.locator('section[aria-labelledby="workspace-organizations-heading"]');
    await expect(organizations.getByRole("heading", { level: 2 })).toHaveJSProperty("textContent", expected.organizations);
    const readable = overview.organizations.filter(org => org.permissions?.length), manage = organizations.locator("a[href]");
    await expect(manage).toHaveCount(readable.length);
    expect((await manage.evaluateAll(nodes => nodes.map(node => node.getAttribute("href")))).sort()).toEqual(
      readable.map(org => `${path}/${encodeURIComponent(org.organizationId)}/overview`).sort());
    coverage.account = { role: session.user.role, audience: session.audience, organizations: overview.organizations.length, readableOrganizations: readable.length };
    if (overview.organizations.length === 0) await expect(organizations.getByText(expected.empty, { exact: true })).toBeVisible();
    const landingForm = organizations.locator("form.workspace-settings-form");
    await expect(landingForm).toHaveCount(["creator", "admin"].includes(session.user.role) ? 1 : 0);
    if (await landingForm.count()) {
      const saved = await retainFields(owner), name = landingForm.locator('input[name="name"]'), create = landingForm.locator('button[type="submit"]');
      try {
        await tabTo(page, name); await observeFocus(name, "settings-01-landing-name-unedited");
        await page.keyboard.press("Tab"); await observeFocus(create, "settings-02-create-unactivated");
        await page.keyboard.press("Shift+Tab"); await observeFocus(name, "settings-03-landing-name-return");
        const custody = await saved.evaluate(state => state.inspect());
        await attachJSON(testInfo, "settings-landing-field-custody", custody);
        expect(custody.sameOwner && custody.sameRoute && custody.allValuesEqual && custody.draftCustodyEqual).toBe(true);
      } finally { await saved.dispose(); }
    }
    await captureViewport(page, testInfo, "settings-landing");
    coverage.landing = "OBSERVED: real account, localized landing and actual permission-dependent controls; no activation or editing";
    if (readable.length === 0) {
      coverage.organization = "UNOBSERVED: no actual authorized Manage link; this is a landing-only result, NOT a Settings task pass";
      complete = true; return;
    }
    if (!await departure("settings-before-organization-departure")) return;
    const entry = manage.first(), href = await entry.getAttribute("href");
    const organization = readable.find(org => href === `${path}/${encodeURIComponent(org.organizationId)}/overview`);
    expect(Boolean(organization), "The route must come from an actual authorized Manage link").toBe(true);
    const endpoint = `/api/workspaces/${encodeURIComponent(organization.organizationId)}`;
    const route = section => `${path}/${encodeURIComponent(organization.organizationId)}/${section}`;
    const refresh = owner.locator("button[data-workspace-settings-refresh]");
    const navigation = owner.locator("forma-ui-audience-navigation.workspace-settings-navigation");
    const link = section => navigation.getByRole("link", { name: expected.sections[section], exact: true });
    const reads = section => Promise.all([readGet(page, "/api/workspaces"), readGet(page, endpoint),
      ...(section === "overview" ? [] : [readGet(page, `${endpoint}/${section === "activity" ? "audit" : section}`)])]);
    const ready = async (section, responses) => {
      const base = responses[1].body;
      expect(base?.organization?.organizationId === organization.organizationId).toBe(true);
      expect(Array.isArray(base.permissions) && base.permissions.every(value => typeof value === "string")).toBe(true);
      expect(["members", "projects", "invitations"].every(key => Array.isArray(base[key]))).toBe(true);
      if (section !== "overview") {
        const detail = responses.at(-1).body;
        expect(detail?.organization?.organizationId === organization.organizationId && !Object.hasOwn(detail, "error")).toBe(true);
        expect(section === "usage" ? typeof detail.period === "string" && Object.hasOwn(detail, "outcomes")
          : (section === "members" ? ["members", "invitations"] : [section === "activity" ? "audit" : "projects"])
            .every(key => Array.isArray(detail[key]))).toBe(true);
      }
      await expect(page).toHaveURL(url => url.pathname === route(section) && !url.search && !url.hash);
      await expect(owner.locator(".workspace-settings-content")).toBeVisible();
      await expect(owner.locator(".workspace-settings-content")).toHaveJSProperty("inert", false);
      await expect(refresh).toHaveAccessibleName(expected.refresh);
      await expect(refresh).toBeEnabled();
      await expect(owner.locator(".workspace-settings-error")).toHaveCount(0);
      await expect(navigation.getByRole("navigation")).toHaveAccessibleName(expected.navigation);
      const permitted = tasks.filter(([, permission]) => base.permissions.includes(permission)).map(([key]) => key);
      expect(await navigation.locator("a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))))
        .toEqual(["overview", ...permitted].map(route));
      await expect(navigation.locator('a[aria-current="page"]')).toHaveCount(1);
      await expect(link(section)).toHaveAttribute("aria-current", "page");
      await expect(owner.getByRole("heading", { level: 2, name: expected.sections[section], exact: true })).toHaveCount(1);
      await expect(owner.locator("[data-workspace-overview]")).toHaveCount(section === "overview" ? 1 : 0);
      if (section === "overview") {
        await expect(owner.locator("[data-workspace-overview] form")).toHaveCount(0);
        expect(await owner.locator("[data-workspace-overview-section]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-workspace-overview-section")))).toEqual(permitted);
      }
      await attachJSON(testInfo, `settings-${section}-actual-read`, { statuses: responses.map(response => response.status),
        sameOrganization: true, permittedTasks: permitted, preservedOverviewHelperCount: await owner.locator("[data-workspace-overview-preserved]").count(),
        primaryRowCounts: Object.fromEntries(["members", "projects", "invitations", "audit"].map(key => [key,
          Array.isArray(responses.at(-1).body[key]) ? responses.at(-1).body[key].length : null])) });
      return { permitted, detail: responses.at(-1).body };
    };
    const refreshRead = async section => {
      await tabTo(page, refresh, 80, "Shift+Tab");
      await observeFocus(refresh, `settings-${section}-refresh-before`);
      const saved = await retainFields(owner), trigger = await refresh.elementHandle();
      try {
        const pending = reads(section);
        await page.keyboard.press("Enter");
        await ready(section, await pending);
        const custody = await saved.evaluate(state => state.inspect());
        await attachJSON(testInfo, `settings-${section}-refresh-custody`, custody);
        expect(custody.sameOwner && custody.sameRoute && custody.draftCustodyEqual).toBe(true);
        if (custody.draftCount) coverage.dirtyDraft = "OBSERVED: existing native draft values and owned forms survived the read; no draft was manufactured";
        const native = await owner.evaluate((element, original) => {
          let active = document.activeElement;
          while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
          return { retainedTrigger: active === original, activeInsideCurrentOwner: Boolean(active && element.contains(active)),
            active: active ? { tag: active.tagName, type: active.getAttribute("type"), name: active.getAttribute("name"),
              connected: active.isConnected, focusVisible: active.matches(":focus-visible") } : null };
        }, trigger);
        coverage.refreshFocus.push({ section, ...native, disposition: native.retainedTrigger ? "Trigger retained; strict paint measured"
          : "REVIEW REQUIRED: actual post-read focus changed; no return destination is manufactured or repaired" });
        await attachJSON(testInfo, `settings-${section}-refresh-native-outcome`, native);
        if (native.retainedTrigger) await observeFocus(refresh, `settings-${section}-refresh-retained`);
        else {
          coverage.findings.push({ section, kind: "post-refresh-native-focus-change-requires-review", ...native });
          await captureViewport(page, testInfo, `settings-${section}-refresh-actual-outcome`);
        }
      } finally { await saved.dispose(); await trigger?.dispose(); }
    };
    await tabTo(page, entry, 80, "Shift+Tab"); await observeFocus(entry, "settings-04-actual-manage");
    const opening = reads("overview");
    await page.keyboard.press("Enter");
    let current = await ready("overview", await opening);
    coverage.organization = "OBSERVED: one real authorized organization selected by its actual native Manage link";
    for (const [key] of tasks) coverage.tasks[key] = current.permitted.includes(key) ? "UNOBSERVED: eligible, not yet traversed" : "UNOBSERVED: actual read permission absent";
    await refreshRead("overview");
    coverage.tasks.overview = "OBSERVED: actual summary/task destinations and read-only Refresh; see separate native focus disposition";
    for (const section of [...current.permitted]) {
      if (!await departure(`settings-before-${section}-departure`)) return;
      const task = owner.locator(`[data-workspace-overview-section="${section}"] > a[href]`);
      await expect(task).toHaveAttribute("href", route(section));
      await tabTo(page, task); await observeFocus(task, `settings-${section}-overview-link`);
      const pending = reads(section);
      await page.keyboard.press("Enter");
      current = await ready(section, await pending);
      await tabTo(page, link(section), 80, "Shift+Tab"); await observeFocus(link(section), `settings-${section}-current-navigation`);
      if (section === "members") {
        const card = owner.locator("section.workspace-settings-card").filter({ has: page.getByRole("heading", { level: 2, name: expected.sections.members, exact: true }) });
        const roles = card.locator(".workspace-settings-table").first().locator("tbody select[aria-label]:enabled");
        const expectedRoles = current.detail.organization.role === "owner"
          ? current.detail.members.filter(member => member.status === "active" && member.role !== "owner").length : 0;
        await expect(roles, "Existing eligible owner rows must not disappear into an UNOBSERVED branch").toHaveCount(expectedRoles);
        const count = await roles.count();
        coverage.memberRoleSelect = `UNOBSERVED: ${count} enabled existing table role selects`;
        if (count) {
          const saved = await retainFields(owner);
          try {
            await tabTo(page, roles.first()); await observeFocus(roles.first(), "settings-members-first-role-unmodified");
            // No arrows, Space, Enter, selectOption, input or change on a role select.
            await tabTo(page, refresh, 80, "Shift+Tab"); await observeFocus(refresh, "settings-members-role-left-by-reverse-tab");
            const custody = await saved.evaluate(state => state.inspect());
            await attachJSON(testInfo, "settings-members-role-inspection-custody", custody);
            expect(custody.sameOwner && custody.sameRoute && custody.allValuesEqual && custody.draftCustodyEqual).toBe(true);
            coverage.memberRoleSelect = `OBSERVED: first of ${count} real enabled table role selects focused and left unchanged; remaining rows not exercised`;
          } finally { await saved.dispose(); }
        }
      }
      await refreshRead(section);
      coverage.tasks[section] = "OBSERVED: native entry/current task navigation and actual GET Refresh; see separate post-read focus disposition";
      if (!await departure(`settings-before-${section}-return`)) return;
      await tabTo(page, link("overview"), 80, "Shift+Tab"); await observeFocus(link("overview"), `settings-${section}-overview-return-link`);
      const returning = reads("overview");
      await page.keyboard.press("Enter");
      current = await ready("overview", await returning);
    }
    complete = true;
  } finally {
    sessionObservation.dispose();
    coverage.traversalCompleteForAvailableScope = complete;
    testInfo.annotations.push({ type: "E1 coverage", description: `${coverage.organization}; ${JSON.stringify(coverage.tasks)}` });
    if (coverage.findings.length) testInfo.annotations.push({ type: "E1 review required", description: `${coverage.findings.length} actual findings; read settings-native-coverage before accepting this slice` });
    await attachJSON(testInfo, "settings-native-coverage", coverage);
  }
});
