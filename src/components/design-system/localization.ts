import type { ReactiveController, ReactiveControllerHost } from "lit";

export type FormaMessageValues = Record<string, string | number>;
export type FormaMessageCatalog = Readonly<Record<string, string>>;
export type FormaDirection = "ltr" | "rtl";

export const FORMA_SUPPORTED_LOCALES = [
  { locale: "en", label: "English", direction: "ltr" },
  { locale: "fr", label: "Français", direction: "ltr" },
  { locale: "ar", label: "العربية", direction: "rtl" },
] as const;

export const FORMA_DEFAULT_MESSAGES: FormaMessageCatalog = {
  "action.default": "Action",
  "action.working": "Working",
  "action.busy": "{label}: {status}",
  "action.more": "More actions",
  "action.continue": "Continue",
  "action.open": "Open",
  "action.save": "Save",
  "action.close": "Close",
  "action.cancel": "Cancel",
  "action.confirm": "Confirm",
  "action.retry": "Retry",
  "action.ready": "Ready",
  "field.text": "Text",
  "field.search": "Search",
  "field.clearSearch": "Clear search",
  "field.choose": "Choose an option",
  "field.option": "Option",
  "field.setting": "Setting",
  "field.number": "Number",
  "projects.canvasEyebrow":"Canvas / All projects",
  "projects.creatorEyebrow":"Creator Workspace / All projects",
  "projects.description":"Choose the project that contains your documents, collections, creative context, outputs, and boards.",
  "projects.new":"New project",
  "projects.card":"{name}, {state} project",
  "projects.cardCurrent":"{name}, {state} project, currently open",
  "projects.state.active":"active",
  "projects.state.archived":"archived",
  "projects.stateOpen":"{state} · open",
  "projects.workspaceKind":"Creative workspace",
  "projects.continueHint":"Continue where you left off.",
  "projects.document.one":"{count} document",
  "projects.document.other":"{count} documents",
  "projects.idea.one":"{count} finished or in-progress idea",
  "projects.idea.other":"{count} finished or in-progress ideas",
  "projects.projectSummary":"{documents} and {ideas}.",
  "projects.noFinishedWork":"No finished work yet",
  "projects.firstResult":"Open the project to create its first result.",
  "projects.emptyHeading":"Give your next idea a home",
  "projects.emptyDetail":"A project keeps its documents, references, reusable decisions, and finished work together.",
  "projects.emptyAction":"Create your first project",
  "projects.createEyebrow":"New replayable workspace",
  "projects.createHeading":"Name your project",
  "projects.createDescription":"Forma will create one genuinely blank document. Context appears only after you add it.",
  "projects.projectName":"Project name",
  "projects.projectNamePlaceholder":"e.g. Autumn campaign",
  "projects.createAction":"Create project",
  "projects.continue":"Continue working",
  "projects.open":"Open project",
  "projects.openNamed":"Open project {name}",
  "projects.continueNamed":"Continue working on {name}",
  "projects.openLibrary":"Open project library",
  "projects.openLibraryNamed":"Open project library for {name}",
  "projects.openCanvas":"Open in Canvas",
  "projects.openCanvasNamed":"Open in Canvas: {name}",
  "projects.all":"All projects",
  "projects.backToBoards":"Back to project boards",
  "projects.openCreatorDocument":"Open document in Creator Workspace",
  "projects.creatorWorkspace":"Creator Workspace",
  "projects.contextAdded":"The context was added to your current document.",
  "projects.libraryHeading":"Project library",
  "projects.libraryDescription":"Find every reusable idea, finished image, story, scene, presentation, storyboard, and video in this project.",
  "projects.newReusableBlock":"New reusable block",
  "projects.importDocument":"Import as document",
  "projects.exportProject":"Export this project",
  "projects.searchLibrary":"Search project library",
  "projects.searchAllWork":"Search all project work",
  "projects.libraryContent":"Library content",
  "projects.filter.all":"All",
  "projects.filter.blocks":"Blocks",
  "projects.filter.outputs":"Outputs",
  "projects.filter.families":"Families",
  "projects.reusableBlocks":"Reusable blocks",
  "projects.readOnlyLibrary":"You can inspect shared project decisions and creative results.",
  "projects.openBlockEditor":"Open Block editor",
  "projects.openPreview":"Open focused preview",
  "projects.openPreviewNamed":"Open focused preview of {name}",
  "projects.edit":"Edit",
  "projects.forkEdit":"Fork & edit",
  "projects.useContextSet":"Use context set ({count})",
  "projects.useDocument":"Use in open document",
  "projects.keptOutputs":"Kept outputs",
  "projects.recentOutputs":"Recent outputs",
  "projects.outputHistory":"Output history",
  "projects.recent":"Recent",
  "projects.kept":"Kept",
  "projects.removeKept":"Remove from kept",
  "projects.removeKeptNamed":"Remove from kept: {name}",
  "projects.keepReuse":"Keep for reuse",
  "projects.keepReuseNamed":"Keep for reuse: {name}",
  "projects.editInput":"Edit input",
  "projects.editInputNamed":"Edit input: {name}",
  "projects.useEdit":"Use & edit",
  "projects.useEditNamed":"Use & edit: {name}",
  "projects.editCreator":"Edit in Creator Workspace",
  "projects.useEditCreator":"Use & edit in Creator Workspace",
  "projects.manageReferences":"Upload or manage references",
  "projects.railNavigation":"Library project navigation",
  "projects.railShortcuts":"Project shortcuts",
  "projects.railDestinations":"Project destinations",
  "projects.railCollections":"Authored collections",
  "projects.railLibrary":"Project library",
  "projects.railExpand":"Expand project navigation",
  "projects.railCollapse":"Collapse project navigation",
  "projects.railOverview":"Project overview",
  "projects.railCurrent":"Current project",
  "projects.railSectionProject":"Project",
  "projects.railSectionLibrary":"Library",
  "projects.editorView":"View reusable context",
  "projects.editorEdit":"Edit a reusable block",
  "projects.editorFork":"Fork a document block",
  "projects.editorCreate":"Create reusable context",
  "projects.editorExpandContext":"Expand project context",
  "projects.editorCollapseContext":"Collapse project context",
  "projects.editorExpandFolders":"Expand project and folders",
  "projects.editorCollapseFolders":"Collapse project and folders",
  "projects.editorCancelRemoval":"Cancel removal",
  "projects.closePreview":"Close preview",
  "projects.openFamilyNamed":"Open all work in {name}",
  "projects.correctGrouping":"Correct grouping",
  "projects.visualFamilies":"Aesthetic families",
  "projects.openLightbox":"Open lightbox",
  "projects.readOnlyOutput":"Inspect this shared creative result and its project context.",
  "projects.downloadMedia":"Download media",
  "projects.compareImages":"Compare images",
  "projects.sharingHeading":"Project sharing",
  "projects.sharingDescription":"Invite people to an organization, share this project, and manage viewer or editor access in Creator Workspace settings.",
  "projects.sharingCurrentRole":"Your project role is {role}. A project administrator manages Canvas access.",
  "projects.sharingCanvasLimitation":"Invited collaborators can use shared documents and outputs. Canvas boards are available when a project administrator grants Canvas access.",
  "projects.openSharingSettings":"Open sharing in Creator Workspace",
  "workspace.admin.heading":"Workspaces & collaboration",
  "workspace.admin.eyebrow":"Creator settings",
  "workspace.admin.description":"Manage the organizations, invitations, shared projects, and spending you are authorized to see.",
  "workspace.admin.settingsDescription":"Review your invitations, open shared projects, or manage organizations you own.",
  "workspace.admin.navigation":"Organization settings",
  "workspace.admin.section.overview":"Overview",
  "workspace.admin.section.members":"Members",
  "workspace.admin.section.projects":"Projects",
  "workspace.admin.section.usage":"Usage",
  "workspace.admin.section.activity":"Activity",
  "workspace.admin.organizations":"Your organizations",
  "workspace.admin.organization":"Organization",
  "workspace.admin.organizationName":"New organization name",
  "workspace.admin.invitations":"Your invitations",
  "workspace.admin.pendingInvitations":"Pending invitations",
  "workspace.admin.invitationCaption":"Private, expiring invitations",
  "workspace.admin.invitationLink":"Private invitation link",
  "workspace.admin.copyInvitation":"Copy invitation link",
  "workspace.admin.expiresAt":"Expires",
  "workspace.admin.noPendingInvitations":"No invitations are awaiting acceptance.",
  "workspace.admin.revokeInvitation":"Revoke invitation",
  "workspace.admin.invitationRevoked":"The pending invitation was revoked.",
  "workspace.admin.confirmInvitationRevoke":"Revoke the invitation for {email}?",
  "workspace.admin.leaveSharedProject":"Return to my projects",
  "workspace.admin.sharedProjectMode":"You are working inside a shared project.",
  "workspace.admin.readOnlyProject":"You have view-only access to this shared project.",
  "workspace.admin.unsupportedGeneration":"Creating new outputs is unavailable while viewing a shared project.",
  "workspace.admin.readOnlyGeneration":"Your project role allows reviewing outputs but not creating them.",
  "chat.noImageYet":"No image yet",
  "chat.noSharedImage":"No image has been shared yet",
  "chat.viewerImageHint":"A project editor can create an image for everyone to review.",
  "chat.createImageHint":"Start a conversation when you are ready to create an image.",
  "account.privacyCreatorWorkspace":"Review privacy in Creator Workspace",
  "canvas.proposals.personalOnly":"Report space is available in your own projects",
  "canvas.proposals.sharedUnavailable":"Shared boards synchronize their content directly. Arrangement proposals remain available only in your personal projects.",
  "canvas.proposals.returnBoards":"Return to project boards",
  "workspace.personalOnly.heading":"This is part of your personal creative account",
  "workspace.personalOnly.description":"Sessions, personal suggestions, and creative memory stay private and are not shared with a project.",
  "generation.sharedFailurePrivacy":"Failure details remain available; generation inputs stay private to their author.",
  "chat.viewerConversationPrivacy":"Creative conversations are private to each project editor; your role can review shared results.",
  "canvas.projectBoardsHeading":"{name} boards",
  "canvas.backToProjectBoards":"Back to project boards",
  "canvas.board":"Board",
  "canvas.readingOrder":"Reading order",
  "canvas.zoomOut":"Zoom out",
  "canvas.zoomIn":"Zoom in",
  "canvas.returnToBoard":"Return to board",
  "projects.viewerFirstResult":"A project editor can create the first shared result.",
  "generation.contactAdministrator":"Contact your project administrator",
  "generation.reviewOrganizationSpending":"Review organization spending",
  "generation.reviewPersonalSpending":"Review your spending",
  "workspace.admin.unsupportedCanvas":"Canvas is unavailable while viewing a shared project.",
  "workspace.admin.unsupportedSharing":"Public share links are unavailable while viewing a shared project.",
  "workspace.admin.unnamedProject":"Unnamed project",
  "workspace.admin.sharedProjects":"Projects shared with you",
  "workspace.admin.noInvitations":"You have no pending workspace invitations.",
  "workspace.admin.noOrganizations":"You do not belong to any organizations yet.",
  "workspace.admin.noSharedProjects":"No projects have been shared with you.",
  "workspace.admin.noRegisteredProjects":"No projects have been registered in this organization.",
  "workspace.admin.noActivity":"No organization activity has been recorded.",
  "workspace.admin.open":"Open workspace settings",
  "workspace.admin.create":"Create workspace",
  "workspace.admin.created":"Workspace created.",
  "workspace.admin.manage":"Manage",
  "workspace.admin.accept":"Accept",
  "workspace.admin.accepted":"Workspace invitation accepted.",
  "workspace.admin.email":"Email address",
  "workspace.admin.role":"Role",
  "workspace.admin.role.owner":"Owner",
  "workspace.admin.role.administrator":"Administrator",
  "workspace.admin.role.member":"Member",
  "workspace.admin.role.editor":"Editor",
  "workspace.admin.role.viewer":"Viewer",
  "workspace.admin.status":"Status",
  "workspace.admin.status.active":"Active",
  "workspace.admin.status.pending":"Pending",
  "workspace.admin.status.revoked":"Revoked",
  "workspace.admin.member":"Member",
  "workspace.admin.memberCaption":"Organization members and invitations",
  "workspace.admin.invite":"Create invitation",
  "workspace.admin.invited":"A private, expiring invitation was created.",
  "workspace.admin.revoke":"Revoke",
  "workspace.admin.revoked":"Workspace access was revoked.",
  "workspace.admin.confirmRevoke":"Remove {name} from this workspace and revoke all project access?",
  "workspace.admin.confirmProjectRevoke":"Remove {name} from this project?",
  "workspace.admin.ownedProject":"Your project",
  "workspace.admin.shareProject":"Share project",
  "workspace.admin.projectRegistered":"The project was safely indexed for collaboration.",
  "workspace.admin.viewAccess":"View access",
  "workspace.admin.grant":"Grant access",
  "workspace.admin.projectGranted":"Project access was granted.",
  "workspace.admin.projectRevoked":"Project access was revoked.",
  "workspace.admin.projectOpened":"Shared project opened.",
  "workspace.admin.period":"Accounting period",
  "workspace.admin.settled":"Settled spending",
  "workspace.admin.reserved":"Active reservations",
  "workspace.admin.remaining":"Available organization budget",
  "workspace.admin.tokens":"Organization tokens",
  "workspace.admin.totalLimit":"Monthly organization limit",
  "workspace.admin.tokenUsage":"Monthly token usage",
  "workspace.admin.usdLimit":"Monthly limit (USD)",
  "workspace.admin.tokenLimit":"Monthly token limit",
  "workspace.admin.savePolicy":"Save limits",
  "workspace.admin.policySaved":"Workspace budget policy was updated.",
  "workspace.admin.roleUpdated":"The organization role was updated.",
  "workspace.admin.projectRoleUpdated":"The project role was updated.",
  "workspace.admin.canvasAccess":"Allow Canvas access",
  "workspace.admin.canvasAccessNamed":"Allow Canvas access for {name}",
  "workspace.admin.canvasAccessUpdated":"Project Canvas access was updated.",
  "workspace.admin.canvasAccessHelp":"Their project role determines whether they can edit the board.",
  "workspace.admin.editorBudgetNotice":"Editors can create outputs using their personal and organization budgets; viewers cannot.",
  "workspace.admin.acceptNamed":"Accept the invitation to {name}",
  "workspace.admin.manageNamed":"Manage {name}",
  "workspace.admin.openNamed":"Open {name}",
  "workspace.admin.revokeNamed":"Revoke access for {name}",
  "workspace.admin.revokeInvitationNamed":"Revoke invitation for {email}",
  "workspace.admin.viewAccessNamed":"View access to {name}",
  "workspace.admin.grantNamed":"Grant access to {name}",
  "workspace.admin.roleNamed":"Role for {name}",
  "workspace.admin.projectRoleNamed":"Project role for {name}",
  "workspace.admin.activityBy":"By {name}",
  "workspace.admin.error.access_denied":"You no longer have permission to perform that action.",
  "workspace.admin.error.invitation_unavailable":"This invitation is unavailable or has already been used.",
  "workspace.admin.error.invitation_expired":"This invitation has expired. Ask an administrator for a new one.",
  "workspace.admin.error.membership_already_active":"This person already belongs to the organization.",
  "workspace.admin.error.workspace_budget_limit_below_committed_usage":"The new limit cannot be lower than spending that is already committed.",
  "workspace.admin.error.valid_workspace_budget_limits_required":"Enter valid monthly budget and token limits.",
  "workspace.admin.error.project_already_registered":"This project has already been shared with the organization.",
  "workspace.admin.error.canvas_access_already_granted":"Canvas access was already granted. Refresh to see the current permission.",
  "workspace.admin.error.canvas_access_not_granted":"Canvas access is no longer granted. Refresh to see the current permission.",
  "workspace.admin.unavailable":"This workspace is unavailable.",
  "workspace.admin.audit.OrganizationCreated":"Organization created",
  "workspace.admin.audit.OrganizationMembershipInvited":"Member invited",
  "workspace.admin.audit.OrganizationMembershipAccepted":"Invitation accepted",
  "workspace.admin.audit.OrganizationMembershipRevoked":"Member access revoked",
  "workspace.admin.audit.OrganizationMembershipRoleUpdated":"Member role changed",
  "workspace.admin.audit.OrganizationInvitationRevoked":"Invitation revoked",
  "workspace.admin.audit.OrganizationProjectRegistered":"Project shared with the organization",
  "workspace.admin.audit.ProjectMembershipGranted":"Project access granted",
  "workspace.admin.audit.ProjectMembershipRevoked":"Project access revoked",
  "workspace.admin.audit.ProjectMembershipRoleUpdated":"Project role changed",
  "workspace.admin.audit.ProjectCanvasAccessGranted":"Canvas access granted",
  "workspace.admin.audit.ProjectCanvasAccessRevoked":"Canvas access revoked",
  "workspace.admin.audit.OrganizationBudgetPolicyUpdated":"Organization budget limits updated",
  "editor.formatting": "Text formatting",
  "editor.bold": "Bold",
  "editor.italic": "Italic",
  "editor.heading": "Heading",
  "editor.bullets": "Bulleted list",
  "editor.numbered": "Numbered list",
  "editor.quote": "Quotation",
  "editor.link": "Link",
  "editor.help": "Markdown formatting is available. Use Control or Command plus B for bold and I for italic.",
  "editor.applied": "{format} formatting applied.",
  "filter.label": "Filter",
  "filter.remove": "Remove {label}",
  "avatar.unnamed": "Unnamed person",
  "avatar.person": "Person",
  "status.loading": "Loading",
  "status.progress": "Progress",
  "navigation.sections": "Sections",
  "navigation.switchWorkspace": "Switch workspace",
  "navigation.switchWorkspaceCurrent": "Switch workspace. Current workspace: {workspace}",
  "navigation.availableWorkspaces": "Available workspaces",
  "navigation.scopedNavigation": "Workspace navigation",
  "navigation.breadcrumbs": "Breadcrumb",
  "navigation.pagination": "Pagination",
  "navigation.previous": "Previous page",
  "navigation.next": "Next page",
  "navigation.page": "Page {page} of {total}",
  "navigation.actions": "Actions",
  "navigation.openLink": "Open link",
  "navigation.opensInNewTab": "(opens in a new tab)",
  "notice.dismiss": "Dismiss notice",
  "disclosure.more": "More information",
  "popover.open": "Open options",
  "dialog.heading": "Dialog",
  "dialog.open": "Open dialog",
  "dialog.confirm": "Confirm",
  "dialog.cancel": "Cancel",
  "dialog.close": "Close dialog",
  "clipboard.copy": "Copy",
  "clipboard.success": "Copied to clipboard.",
  "clipboard.failure": "Could not copy. Select the text and copy it manually.",
  "language.label": "Language",
  "language.changed": "Language changed to {language}.",
  "language.failed": "The selected language could not be loaded. Please try again.",
  "shell.skip": "Skip to main content",
  "shell.account": "Account and settings",
  "shell.application": "Application",
  "shell.creative": "Creator Workspace",
  "shell.canvas": "Canvas",
  "shell.operations": "Platform Operations",
  "shell.laboratory": "Laboratory",
  "shell.product": "Product & Quality",
  "shell.knowledge": "Design & Knowledge",
  "shell.engineering": "Engineering Diagnostics",
  "shell.switchWorkspace": "Switch workspace",
  "shell.availableWorkspaces": "Available workspaces",
  "shell.accessUnavailable": "Workspace unavailable",
  "shell.returnToProjects": "Return to your projects",
  "shell.projects": "Projects",
  "shell.library": "Library",
  "shell.home": "Home",
  "shell.command": "Search or run a command",
  "shell.loading": "Opening your {application} workspace",
  "shell.loadingDetail": "Your saved projects and creative work are being restored.",
  "shell.error": "Your work could not be loaded.",
  "shell.busy": "Working: {operation}",
  "shell.running": "A document operation is running on the server",
  "shell.queued": "A document operation is queued",
  "shell.documentTitle": "Forma — An event-sourced creative studio",
  "shell.description.creative": "Projects, creation, context, re-entry, and creative intelligence",
  "shell.description.canvas": "A spatial workspace for the same project, documents, decisions, and results",
  "shell.description.operations": "Authorized platform access, provider policy, and release decisions",
  "shell.description.product": "Privacy-preserving product insights, delivery, and controlled evaluation",
  "shell.description.knowledge": "Approved component guidance and safely isolated fictional examples",
  "shell.description.engineering": "Redacted service diagnostics, synchronization, and job health",
  "shell.description.settings": "Manage your privacy, sharing, and personal production spending",
  "shell.navigation.settings": "Settings",
  "shell.navigation.insights": "Insights",
  "shell.navigation.delivery": "Delivery",
  "shell.navigation.evaluation": "Evaluation",
  "shell.navigation.components": "Components",
  "shell.navigation.patterns": "Patterns",
  "shell.navigation.guidance": "Guidance",
  "shell.navigation.health": "Health",
  "shell.navigation.events": "Events",
  "shell.navigation.sync": "Synchronization",
  "shell.navigation.jobs": "Jobs",
  "shell.navigation.providers": "Providers",
  "shell.navigation.release": "Release gates",
  "shell.navigation.access": "Access",
  "shell.description.providers": "Review approved provider configuration",
  "shell.description.release": "Review and approve controlled production releases",
  "shell.description.access": "Manage explicit specialist privileges",
  "shell.description.insights": "Review anonymous product outcomes and creator friction",
  "shell.description.delivery": "Inspect owned decisions, blockers, and evidence gates",
  "shell.description.evaluation": "Review controlled synthetic evaluation and qualification",
  "shell.description.components": "Explore production components using fictional examples only",
  "shell.description.patterns": "Review accessible interaction and composition patterns",
  "shell.description.guidance": "Read approved product, localization, and accessibility guidance",
  "shell.description.health": "Review bounded service health and reliability evidence",
  "shell.description.events": "Inspect redacted event and projection integrity",
  "shell.description.jobs": "Review job status without customer content",
  "product.insights.heading": "Product outcomes",
  "product.insights.description": "Privacy-preserving, aggregate-only evidence about useful creative work. Names, documents, prompts, media, and small cohorts are never included.",
  "product.delivery.heading": "Delivery readiness",
  "product.delivery.description": "Current delivery decisions, ownership, dependencies, and evidence. Approvals and longitudinal outcomes remain pending until they actually exist.",
  "product.evaluation.heading": "Evaluation evidence",
  "product.evaluation.description": "Synthetic evaluation and approved qualification evidence. Provider activation, paid execution, and customer content require separate authorization.",
  "engineering.heading": "Service reliability",
  "engineering.description": "Redacted operational evidence only. Customer identity, document text, private media, and production approvals never appear.",
  "engineering.health.heading": "Service health",
  "engineering.health.description": "Review bounded reliability evidence without exposing creator content.",
  "engineering.events.heading": "Event integrity",
  "engineering.events.description": "Inspect redacted event and projection health without account or document details.",
  "engineering.sync.heading": "Synchronization health",
  "engineering.sync.description": "Review account-isolated delivery and synchronization reliability.",
  "engineering.jobs.heading": "Background job health",
  "engineering.jobs.description": "Inspect aggregate execution, queue, and failure counts without creator data.",
  "operations.overview.heading": "Platform oversight",
  "operations.overview.description": "Review bounded service health and release decisions without customer identities, creator content, provider secrets, or financial limits.",
  "operations.providers.heading": "Provider readiness",
  "operations.providers.description": "Inspect provider availability and historical qualification without revealing secrets, starting paid work, or approving a release.",
  "operations.release.heading": "Canvas governance",
  "operations.release.description": "Canvas availability is decided by durable, server-owned release approvals.",
  "operations.release.readOnly": "Release decisions require separate approval authority.",
  "delivery.decisions": "Delivery decisions",
  "delivery.title": "Decision or milestone",
  "delivery.audience": "Audience",
  "delivery.evidence": "Current evidence",
  "delivery.dependencies": "Existing dependencies",
  "delivery.owner": "Owner",
  "delivery.status": "Status",
  "delivery.changeStatus": "Change decision status",
  "delivery.status.planned": "Planned",
  "delivery.status.active": "Active",
  "delivery.status.blocked": "Blocked",
  "delivery.status.ready": "Ready",
  "delivery.status.completed": "Completed",
  "delivery.status.running": "In progress",
  "delivery.status.failed": "Needs attention",
  "delivery.status.passed": "Evidence verified",
  "delivery.status.approval_required": "Awaiting approval",
  "delivery.status.approved": "Approved",
  "delivery.status.revoked": "Approval revoked",
  "delivery.status.superseded": "Superseded",
  "delivery.owner.me": "Assign to me",
  "delivery.save": "Save decision",
  "delivery.approvalLocked": "An approved or revoked decision can only be changed by a release approver.",
  "delivery.error.delivery_evidence_required": "Add review evidence before moving this decision forward.",
  "delivery.error.delivery_dependencies_incomplete": "Complete all dependent decisions before advancing this one.",
  "delivery.error.invalid_delivery_status_transition": "This decision cannot move directly to the selected status.",
  "delivery.error.release_approval_required": "This change requires separate release-approval authority.",
  "delivery.error.eligible_delivery_owner_required": "Choose an active team member authorized to manage delivery.",
  "delivery.add": "Add delivery decision",
  "delivery.saving": "Saving…",
  "delivery.saved": "Delivery decision saved.",
  "delivery.failed": "The delivery decision could not be saved.",
  "delivery.conflict": "This decision changed. Refresh it and try again.",
  "delivery.empty": "No delivery decisions have been recorded yet.",
  "delivery.readOnly": "Your access allows review; managing decisions requires a separate authorization.",
  "delivery.evidenceOnly":"Your authorization includes release evidence and aggregate readiness; individual delivery decisions require separate access.",
  "delivery.saveNamed":"Save decision {name}",
  "delivery.error.independent_release_approver_required":"A different, independently authorized person must approve this release decision.",
  "delivery.unavailableDependency": "Unavailable decision",
  "evaluation.history": "Retained qualification history",
  "evaluation.corpus": "Frozen corpus",
  "evaluation.cases": "cases",
  "evaluation.qualification": "Qualification",
  "evaluation.approval": "Production approval",
  "evaluation.historyCaption": "Immutable historical results from frozen fictional-context evaluations",
  "evaluation.version": "Adapter version",
  "evaluation.outcome": "Outcome",
  "evaluation.usable": "Usable results",
  "evaluation.references": "Usable references",
  "evaluation.finding": "Finding",
  "evaluation.historicalOnly": "These provider results are historical. This page never starts a paid operation or approves production.",
  "evaluation.tools": "Authorized evaluation tools",
  "evaluation.syntheticReplay": "Open fictional replay",
  "evaluation.adapterPreview": "Inspect adapter contract simulations",
  "evaluation.preview.heading": "Adapter contract simulation",
  "evaluation.preview.description": "Inspect routing, normalization, fallback behavior, and indicative cost without calling a provider, transmitting pixels, changing production policy, or spending funds.",
  "evaluation.preview.provider": "Requested provider",
  "evaluation.preview.quality": "Requested quality",
  "evaluation.preview.low": "Low",
  "evaluation.preview.medium": "Medium",
  "evaluation.preview.high": "High",
  "evaluation.preview.size": "Requested dimensions",
  "evaluation.preview.format": "Output format",
  "evaluation.preview.references": "Reference images",
  "evaluation.preview.run": "Run free contract simulation",
  "evaluation.preview.readOnly": "Your access permits reviewing retained evidence. Running a no-cost contract simulation requires a separate qualification execution grant.",
  "evaluation.preview.result": "Simulated routing result",
  "evaluation.preview.selectedProvider": "Selected provider",
  "evaluation.preview.model": "Selected model",
  "evaluation.preview.reason": "Routing or fallback reason",
  "evaluation.preview.normalized": "Normalized request",
  "evaluation.preview.estimate": "Indicative provider cost",
  "evaluation.preview.guarantee": "Simulation complete: no provider request, no image transmission, no saved customer data, and no charge.",
  "evaluation.actualReplay": "Review approved replay sessions",
  "replay.synthetic.heading": "Fictional workflow rehearsal",
  "replay.synthetic.description": "Rehearse creative workflows using isolated fictional events without customer history, provider calls, or durable writes.",
  "replay.synthetic.eventCount": "Fictional event count",
  "replay.synthetic.run": "Run free fictional rehearsal",
  "replay.synthetic.readOnly": "Your access allows reviewing fictional scenarios; running a rehearsal requires its separately granted execution capability.",
  "replay.synthetic.scenarios": "Available fictional scenario families",
  "replay.synthetic.coverage": "Workflow coverage",
  "replay.synthetic.checks": "checks passed",
  "replay.synthetic.timeline": "Fictional event timeline",
  "replay.actual.heading": "Approved replay sessions and personas",
  "replay.actual.description": "Administrator-only, owner-isolated fixtures. New paid work requires direct human approval, an exact one-use quote, and enforced limits.",
  "replay.actual.saved": "Saved approved sessions",
  "replay.actual.events": "events",
  "replay.actual.images": "images",
  "replay.actual.inspect": "Inspect saved timeline",
  "replay.actual.openPersona": "Enter fictional persona",
  "replay.actual.personaTitle": "Confirm fictional persona entry",
  "replay.actual.personaWarning": "You are about to enter an isolated fictional account. Changes made while impersonating this persona are written to that fictional account, and your principal administrative access will be suspended until you leave.",
  "replay.actual.personaPhrase": "Type the confirmation phrase exactly",
  "replay.actual.personaAcknowledge": "I understand that this fictional persona has a separate account and that actions may modify its saved state.",
  "replay.actual.personaConfirm": "Confirm and enter fictional persona",
  "replay.actual.cancel": "Cancel",
  "replay.actual.preparePersona": "Prepare reusable persona",
  "replay.actual.archive": "Archive failed session",
  "replay.actual.retry": "Prepare safe retry",
  "replay.actual.retryPrepared": "Previous reservation settled; the original settings are restored. A new provider run still requires explicit approval.",
  "replay.actual.confirmArchive": "Archive this failed session and permanently remove its unfinished generated media?",
  "replay.actual.empty": "No approved replay sessions are available.",
  "replay.actual.timeline": "Saved owner-isolated timeline",
  "replay.actual.new": "Create an explicitly approved paid fixture",
  "replay.actual.seed": "Optional fictional creative direction",
  "replay.actual.refreshEstimate": "Refresh exact estimate",
  "replay.actual.maximum": "Maximum reserved provider cost",
  "replay.actual.providerOperations": "maximum provider operations",
  "replay.actual.phrase": "Type the explicit approval phrase",
  "replay.actual.acknowledge": "I authorize this exact one-use maximum and understand that real provider calls will occur.",
  "replay.actual.override": "I approve the displayed one-run personal-budget exception.",
  "replay.actual.working": "Working…",
  "replay.actual.authorize": "Approve and generate paid replay",
  "replay.actual.trusted": "A direct human action is required.",
  "replay.actual.preparing": "Recording your one-use, bounded approval…",
  "replay.actual.generating": "Generating the explicitly approved replay. This can take several minutes.",
  "replay.actual.complete": "The approved replay is saved and can be reused without another provider call.",
  "replay.status.completed": "Completed",
  "replay.status.complete": "Completed",
  "replay.status.failed": "Failed",
  "replay.status.running": "Running",
  "knowledge.focal.heading": "Focal-point comparison",
  "knowledge.focal.description": "Compare local image calculations using approved fictional examples only; creator projects and private media are never loaded.",
  "knowledge.focal.return": "Return to patterns",
  "knowledge.focal.open": "Compare focal-point treatments",
  "access.heading": "Specialist access",
  "access.description": "Grant the minimum explicit product, evaluation, design, or engineering authority. Revocation takes effect on the next protected request.",
  "access.person": "Person",
  "access.capability": "Exact capability",
  "access.grant": "Grant scoped access",
  "access.current": "Active specialist grants",
  "access.expires": "Expires",
  "access.revoke": "Revoke",
  "access.none": "No specialist capabilities have been delegated.",
  "shared.imageAlt": "Shared creative image {number}",
  "shared.inspectImage": "Inspect image: {title}",
  "shared.closeImage": "Close image",
  "shared.review": "Shared review",
  "workspace.provenance.inspector": "Creative history",
  "workspace.provenance.source": "Saved creative history",
  "workspace.provenance.close": "Close creative history",
  "workspace.provenance.description": "This creative decision is saved to your private document and remains available for future results.",
  "workspace.provenance.author": "Created by",
  "workspace.provenance.you": "You",
  "workspace.provenance.assistance": "Approved creative assistance",
  "workspace.provenance.saved": "Saved",
  "workspace.provenance.change": "Creative change",
  "workspace.provenance.technical": "Technical details for engineering",
  "workspace.provenance.engineering": "Open Engineering Diagnostics",
  "workspace.provenance.copy": "Copy technical event ID",
  "canvas.selected": "selected",
  "canvas.newBoard":"New board",
  "canvas.noSharedBoards":"No shared boards yet",
  "canvas.readOnlyBoards":"A project editor can create the first board for this shared project.",
  "canvas.readOnlyStatus":"Viewing · updates arrive automatically",
  "canvas.readOnlyOffline":"Offline · shared updates are paused",
  "canvas.readOnlySelectionHelp":"Drag across an empty area to select cards. Hold Shift to add; press Escape when done.",
  "canvas.allChangesSaved":"All changes saved",
  "role.refresh": "Refresh evidence",
  "role.loading": "Loading approved evidence…",
  "role.scope": "Scope",
  "role.refreshed": "Refreshed",
  "role.syntheticOnly": "Frozen fictional-context evaluation; historical provider results",
  "role.metrics": "Approved decision measures",
  "role.notMeasured": "Not measured",
  "role.evidence": "Current evidence and decisions",
  "role.status.passed": "Passed",
  "role.status.pending": "Pending",
  "role.status.approval_required": "Approval required",
  "role.status.blocked": "Blocked",
  "report.scope.insights": "Anonymous 30-day product outcomes; fictional accounts excluded",
  "report.scope.delivery": "Durable internal delivery decisions; creator content excluded",
  "report.scope.evaluation": "Frozen fictional-context qualification and historical provider evidence",
  "report.scope.providers": "Provider readiness; credentials and customer work excluded",
  "report.scope.overview": "Bounded platform service health and release oversight",
  "report.scope.engineeringHealth": "Redacted service health; customer content excluded",
  "report.scope.engineeringEvents": "Redacted event integrity; customer content excluded",
  "report.scope.engineeringSync": "Redacted synchronization health; customer content excluded",
  "report.scope.engineeringJobs": "Redacted job health; customer content excluded",
  "report.metric.activeCreators.label": "Active creators",
  "report.metric.activeCreators.detail": "Real creators in the past 30 days; groups below three are suppressed.",
  "report.metric.activationRate.label":"Creator activation",
  "report.metric.activationRate.detail":"Real creators with a retained outcome; groups below three are suppressed.",
  "report.metric.retainedOutcomes.label":"Retained creative outcomes",
  "report.metric.retainedOutcomes.detail":"Completed results whose document and output remain available.",
  "report.metric.contextReuseRate.label":"Context reuse",
  "report.metric.contextReuseRate.detail":"Creators reusing actual context blocks across multiple compilations.",
  "report.metric.costPerRetainedOutcome.label":"Cost per retained outcome",
  "report.metric.costPerRetainedOutcome.detail":"Settled generation spending divided by genuinely retained results.",
  "report.metric.routeLatencyP75.label":"Route readiness p75",
  "report.metric.routeLatencyP75.detail":"75th-percentile route readiness in milliseconds from anonymous samples.",
  "report.metric.largestPaintP75.label":"Largest paint p75",
  "report.metric.largestPaintP75.detail":"75th-percentile largest contentful paint in milliseconds.",
  "report.metric.interactionP75.label":"Interaction latency p75",
  "report.metric.interactionP75.detail":"75th-percentile interaction responsiveness in milliseconds.",
  "report.metric.layoutShiftP75.label":"Layout shift p75",
  "report.metric.layoutShiftP75.detail":"75th-percentile cumulative layout shift in millionths.",
  "report.metric.completedOutputs.label": "Completed outcomes",
  "report.metric.completedOutputs.detail": "Real completed creative outcomes; fictional work excluded.",
  "report.metric.authoredDecisions.label": "Authored decisions",
  "report.metric.authoredDecisions.detail": "Decision count only; creator content is excluded.",
  "report.metric.failedOutputs.label": "Recoverable failures",
  "report.metric.failedOutputs.detail": "Failure counts only; private failure details are excluded.",
  "report.metric.costPerOutput.label": "Cost per completed outcome",
  "report.metric.costPerOutput.detail": "Settled provider cost divided by completed outcomes.",
  "report.metric.plannedDecisions.label": "Planned decisions",
  "report.metric.plannedDecisions.detail": "Persisted milestones awaiting work.",
  "report.metric.activeDecisions.label": "Active decisions",
  "report.metric.activeDecisions.detail": "Owned milestones currently in progress.",
  "report.metric.blockedDecisions.label": "Blocked decisions",
  "report.metric.blockedDecisions.detail": "Owned milestones requiring intervention.",
  "report.metric.completedDecisions.label": "Completed decisions",
  "report.metric.completedDecisions.detail": "Milestones explicitly marked complete.",
  "report.metric.openReleaseGates.label": "Open release decisions",
  "report.metric.openReleaseGates.detail": "Release controls requiring separate human approval.",
  "report.metric.frozenCases.label": "Frozen corpus cases",
  "report.metric.frozenCases.detail": "The approved, immutable fictional evaluation corpus.",
  "report.metric.retainedReports.label": "Retained qualification reports",
  "report.metric.retainedReports.detail": "Immutable reports available only to authorized qualification reviewers.",
  "report.metric.usableCandidates.label": "Passing candidate results",
  "report.metric.usableCandidates.detail": "Usable outcomes in the retained passing evaluation.",
  "report.metric.referenceResults.label": "Passing reference studies",
  "report.metric.referenceResults.detail": "Historical reference outcomes meeting the frozen rubric.",
  "report.metric.livePaidRuns.label": "New paid runs",
  "report.metric.livePaidRuns.detail": "This evidence view never starts a provider operation.",
  "report.metric.configuredImageProviders.label": "Configured image providers",
  "report.metric.configuredImageProviders.detail": "Credential values remain exclusively on the server.",
  "report.metric.activeImageProvider.label": "Active image provider",
  "report.metric.activeImageProvider.detail": "Current authorized image-routing policy.",
  "report.metric.videoProviderReady.label": "Video provider readiness",
  "report.metric.videoProviderReady.detail": "Availability only; provider credentials are never returned.",
  "report.metric.videoProviderReady.value.ready": "Ready",
  "report.metric.videoProviderReady.value.unavailable": "Unavailable",
  "report.metric.qualifiedCorpusCases.label": "Frozen qualification cases",
  "report.metric.qualifiedCorpusCases.detail": "Cases in the approved immutable qualification corpus.",
  "report.metric.observedEvents.label": "Recent events",
  "report.metric.observedEvents.detail": "Aggregate events in the past 30 days; payloads are excluded.",
  "report.metric.canvasEvents.label": "Canvas events",
  "report.metric.canvasEvents.detail": "Aggregate Canvas events; account and project identities are excluded.",
  "report.metric.queuedJobs.label": "Queued jobs",
  "report.metric.queuedJobs.detail": "Aggregate durable work awaiting execution.",
  "report.metric.runningJobs.label": "Running jobs",
  "report.metric.runningJobs.detail": "Aggregate active execution leases.",
  "report.metric.completedJobs.label": "Completed jobs",
  "report.metric.completedJobs.detail": "Aggregate completed execution count.",
  "report.metric.failedJobs.label": "Failed jobs",
  "report.metric.failedJobs.detail": "Aggregate terminal failures; customer details are excluded.",
  "report.evidence.customerPrivacy.label": "Customer privacy",
  "report.evidence.customerPrivacy.detail": "Customer identities, creator content, event payloads, and private media are excluded.",
  "report.evidence.minimumCohort.label": "Minimum cohort protection",
  "report.evidence.minimumCohort.detail": "Measures stay hidden until at least three real creators are active.",
  "report.evidence.longitudinalStudy.label": "Longitudinal outcome study",
  "report.evidence.longitudinalStudy.detail": "Customer outcome measurement requires actual elapsed observation.",
  "report.evidence.recentFriction.label":"Recent creator friction",
  "report.evidence.recentFriction.detail":"Failures and unforgotten attention signals remain hidden below the privacy threshold.",
  "report.evidence.returnRetention.label":"Returning creator behavior",
  "report.evidence.returnRetention.detail":"Return behavior requires real observations from at least three creators.",
  "report.evidence.longitudinal30.label":"30-day outcome observation",
  "report.evidence.longitudinal30.detail":"Requires genuine 30-day observation across at least three creators.",
  "report.evidence.longitudinal60.label":"60-day outcome observation",
  "report.evidence.longitudinal60.detail":"Requires genuine 60-day observation across at least three creators.",
  "report.evidence.longitudinal90.label":"90-day outcome observation",
  "report.evidence.longitudinal90.detail":"Requires genuine 90-day observation across at least three creators.",
  "report.evidence.decisionOwnership.label": "Ownership and dependencies",
  "report.evidence.decisionOwnership.detail": "Every real decision records its owner, audience, immutable dependencies, and current evidence.",
  "report.evidence.humanApproval.label": "Human stakeholder approval",
  "report.evidence.humanApproval.detail": "Product, design, security, and customer approvals remain explicit human decisions.",
  "report.evidence.frozenCorpus.label": "Frozen evaluation corpus",
  "report.evidence.frozenCorpus.detail": "Historical qualification uses an immutable fictional-context corpus.",
  "report.evidence.qualificationResult.label": "Qualification result",
  "report.evidence.qualificationResult.detail": "A passing qualification never activates a provider by itself.",
  "report.evidence.productionApproval.label": "Production activation",
  "report.evidence.productionApproval.detail": "Activation requires an exact, separately authorized release approval.",
  "report.evidence.providerSecretIsolation.label": "Provider secret isolation",
  "report.evidence.providerSecretIsolation.detail": "Credentials, customer content, private media, and account budgets are never returned.",
  "report.evidence.paidExecution.label": "Paid execution authority",
  "report.evidence.paidExecution.detail": "Reporting cannot start paid provider work, alter budgets, or approve releases.",
  "report.evidence.fleetLatency.label": "Fleet latency percentiles",
  "report.evidence.fleetLatency.detail": "Latency is measured from anonymous route samples once enough observations exist.",
  "lab.syntheticNotice": "All examples use fictional data. Your projects, documents, and media are never loaded.",
  "lab.syntheticMetric": "Fictional example data",
  "lab.fictionalActions": "Example actions for a fictional document",
  "lab.previewAction": "Preview interaction",
  "lab.previewConfirmed": "Fictional preview only; no real application was opened.",
  "lab.productHeading": "Review product outcomes",
  "lab.productDetail": "Approved aggregate evidence, delivery decisions, and separately authorized evaluations.",
  "lab.knowledgeHeading": "Explore safe design guidance",
  "lab.knowledgeDetail": "Production components, audience patterns, and fictional-only examples.",
  "lab.engineeringHeading": "Diagnose platform reliability",
  "lab.engineeringDetail": "Redacted events, synchronization health, and background job diagnostics.",
  "knowledge.componentsHeading": "Components and foundations",
  "knowledge.componentsDescription": "Explore real production components through isolated, fictional examples.",
  "knowledge.patternsHeading": "Audience and navigation patterns",
  "knowledge.patternsDescription": "Review how each audience gets only its authorized workspaces and tasks.",
  "knowledge.guidanceHeading": "Design and accessibility guidance",
  "knowledge.guidanceDescription": "Apply approved information architecture, privacy, accessibility, and localization standards.",
  "architecture.label": "06 · Information architecture",
  "architecture.heading": "The right workspace for every audience",
  "architecture.description": "Real design-system navigation components receive only explicitly authorized, fictional destinations.",
  "architecture.single": "One authorized workspace: no switcher",
  "architecture.paired": "Two authorized workspaces: direct links",
  "architecture.multiple": "Several authorized workspaces: compact workspace picker",
  "architecture.tasks": "Authorized tasks for the selected audience",
  "architecture.creatorCanvas": "Creator Workspace edits documents and reusable context; Canvas arranges the same project spatially. Switching never creates a second project.",
  "architecture.guest": "Guest review opens only the exact shared resource and never shows authenticated workspace navigation.",
  "architecture.evaluation": "Evaluation appears only when a separate synthetic-evaluation entitlement is present.",
  "architecture.guidanceHeading": "Approved interaction and privacy rules",
  "architecture.ruleAuthorization": "Enforce authorization on routes, data APIs, and protected assets; interface controls are never a security boundary.",
  "architecture.ruleTasks": "Offer at most five primary tasks, using named native navigation links and exactly one current location.",
  "architecture.ruleLanguages": "Localize visible copy in English, French, and Arabic while keeping identifiers, destinations, and permissions invariant.",
  "architecture.ruleExamples": "Use fictional data only; previews never open an account, load creator documents, contact providers, or mutate records.",
  "pattern.knowledgeSections": "Example Design & Knowledge sections",
  "pattern.workspaceOwnedResources": "Same project, workspace-owned destinations",
  "pattern.sharedProjectResources": "Same project and Library; no unexpected workspace switch.",
  "pattern.platformShell": "Example isolated Product & Quality workspace",
  "pattern.workspaceAdministration":"Example scoped Creator Workspace administration",
  "command.openSettings": "Review personal privacy and usage",
  "settings.eyebrow": "Your account",
  "settings.heading": "Privacy, sharing & usage",
  "settings.description": "Control your personal creative account without opening platform administration.",
  "settings.privacyHeading": "Privacy & attention",
  "settings.privacyDescription": "Optional attention signals are off by default, belong to this account, and never include typed text, pointer paths, or microphone data.",
  "settings.savedEpisodes": "Saved attention episodes",
  "settings.signalRetention": "Signal retention",
  "settings.contentRetention": "Private creative content",
  "settings.processing": "Provider processing",
  "settings.approved": "Approved",
  "settings.notApproved": "Not approved",
  "settings.recentSignals": "Recent attention signals",
  "settings.noSignals": "No personal attention signals are currently retained.",
  "settings.forget": "Forget my attention data",
  "settings.spendingHeading": "Your production spending",
  "settings.spendingDescription": "See your own monthly paid generation, current reservations, and remaining personal limit.",
  "settings.spent": "Settled this month",
  "settings.reserved": "Currently reserved",
  "settings.remaining": "Available to you",
  "settings.budgetProgress": "Personal monthly generation budget",
  "settings.budgetLimit": "Personal monthly limit: {amount}",
  "settings.tokensUsed": "Token safety usage",
  "settings.tokensReserved": "Reserved safety tokens",
  "settings.period": "Accounting period",
  "settings.recentCharges": "Recent personal charges",
  "settings.noCharges": "No personal generation charges have been recorded.",
  "settings.sharingHeading": "Your active review links",
  "settings.sharingDescription": "Each private link opens exactly one approved document and its current authorized media. Close a link here whenever review is finished.",
  "settings.sharedDocument": "Shared document",
  "settings.noShares": "You have no active private review links.",
  "settings.available": "Available",
  "settings.unavailable": "Unavailable",
  "production.eyebrow": "Managed production",
  "production.heading": "How your work was produced",
  "production.description": "See your production team, completed work, actual charge, and what the available evidence can honestly support.",
  "production.running": "{count} managed production in progress",
  "production.units": "{count} completed units",
  "production.actual": "Charged {amount}",
  "production.reserved": "Reserved {amount}",
  "production.evidence": "Review production evidence",
  "production.specialists": "Specialist responsibilities",
  "production.basis": "Evidence basis",
  "production.visualUnverified": "Visual quality and continuity were not inspected.",
  "production.sceneReel": "Delivered as individually playable scenes; a combined MP4 is not available.",
  "production.ambientAudio": "Original environmental audio was requested.",
  "production.silentAudio": "The video was produced without audio.",
  "pdf.unicodeUnavailable": "This presentation contains multilingual text. High-quality export is unavailable, so no incomplete PDF was downloaded.",
};

export type FormaLocaleSnapshot = {
  locale: string;
  formatLocale: string;
  direction: FormaDirection;
  timeZone: string;
  messages: FormaMessageCatalog;
  revision: number;
};

type FormaLocaleSubscriber = (snapshot: FormaLocaleSnapshot, unsubscribe?: () => void) => void;
type FormaLocaleRequest = Event & {
  context: symbol;
  callback: FormaLocaleSubscriber;
  subscribe?: boolean;
};
type FormaLocaleHost = ReactiveControllerHost & HTMLElement;

const LOCALE_CONTEXT = Symbol.for("forma.locale.context");
const STORAGE_KEY = "forma:locale";
const RTL_SCRIPTS = new Set(["Adlm", "Arab", "Hebr", "Mand", "Nkoo", "Rohg", "Samr", "Syrc", "Thaa"]);
const catalogs = new Map<string, FormaMessageCatalog>([["en", FORMA_DEFAULT_MESSAGES]]);
const requests = new Map<string, Promise<FormaMessageCatalog>>();
const subscribers = new Set<FormaLocaleSubscriber>();
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules | Intl.Collator | Intl.Segmenter>();
const timeZones = new Map<string, string>();
let defaultTimeZone = "";
let requestedRevision = 0;

function canonicalLocale(value: string | null | undefined) {
  try { return Intl.getCanonicalLocales(String(value || "en").trim())[0] || "en"; }
  catch { return "en"; }
}

export function formaLocaleFamily(value: string | null | undefined) {
  const canonical = canonicalLocale(value);
  return FORMA_SUPPORTED_LOCALES.find((item) => canonical === item.locale || canonical.startsWith(item.locale + "-"))?.locale || "en";
}

function localeDirection(value: string): FormaDirection {
  try {
    const locale = new Intl.Locale(value) as Intl.Locale & { getTextInfo?: () => { direction?: string } };
    const provided = typeof locale.getTextInfo === "function" ? locale.getTextInfo().direction : undefined;
    return provided === "rtl" || RTL_SCRIPTS.has(locale.maximize().script || "") ? "rtl" : "ltr";
  } catch { return "ltr"; }
}

function safeTimeZone(value?: string | null) {
  const fallback = defaultTimeZone ||= Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  if (!value) return fallback;
  if (value === fallback) return fallback;
  const cached = timeZones.get(value);
  if (cached) return cached;
  try {
    const resolved = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
    if (timeZones.size >= 32) timeZones.delete(timeZones.keys().next().value || "");
    timeZones.set(value, resolved);
    return resolved;
  }
  catch { return fallback; }
}

let active: FormaLocaleSnapshot = {
  locale: "en",
  formatLocale: "en",
  direction: "ltr",
  timeZone: safeTimeZone(),
  messages: FORMA_DEFAULT_MESSAGES,
  revision: 0,
};

function cachedFormatter<T extends Intl.NumberFormat | Intl.DateTimeFormat | Intl.PluralRules | Intl.Collator | Intl.Segmenter>(
  kind: string,
  locale: string,
  options: object,
  create: () => T,
): T {
  const sorted = Object.fromEntries(Object.entries(options).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  const key = kind + "|" + locale + "|" + JSON.stringify(sorted);
  const existing = formatters.get(key);
  if (existing) {
    formatters.delete(key);
    formatters.set(key, existing);
    return existing as T;
  }
  const created = create();
  formatters.set(key, created);
  if (formatters.size > 64) {
    const first = formatters.keys().next().value;
    if (first) formatters.delete(first);
  }
  return created;
}

async function catalogFor(locale: string): Promise<FormaMessageCatalog> {
  const family = formaLocaleFamily(locale);
  const existing = catalogs.get(family);
  if (existing) return existing;
  let pending = requests.get(family);
  if (!pending) {
    const loader = family === "fr"
      ? import("./locales/fr")
      : import("./locales/ar");
    pending = loader.then((module) => {
      const messages = Object.freeze({ ...FORMA_DEFAULT_MESSAGES, ...module.default });
      catalogs.set(family, messages);
      return messages;
    }).catch((error: unknown) => {
      requests.delete(family);
      throw error;
    });
    requests.set(family, pending);
  }
  return pending;
}

export function currentFormaLocale() { return active; }

function subscribeToRoot(callback: FormaLocaleSubscriber) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export async function setFormaLocale(value: string, options: { persist?: boolean; timeZone?: string; formatLocale?: string } = {}) {
  const revision = ++requestedRevision;
  const candidate = canonicalLocale(value);
  const locale = formaLocaleFamily(candidate) === "en" && !/^en(?:-|$)/i.test(candidate) ? "en" : candidate;
  let messages: FormaMessageCatalog;
  try { messages = await catalogFor(locale); }
  catch {
    if (revision === requestedRevision) document.dispatchEvent(new CustomEvent("forma-locale-error", {
      detail: { locale, currentLocale: active.locale },
      bubbles: true,
    }));
    return active;
  }
  if (revision !== requestedRevision) return active;
  const direction = localeDirection(locale);
  active = {
    locale,
    formatLocale: canonicalLocale(options.formatLocale || locale),
    direction,
    timeZone: safeTimeZone(options.timeZone),
    messages,
    revision,
  };
  document.documentElement.lang = locale;
  document.documentElement.dir = direction;
  document.title = messages["shell.documentTitle"] || FORMA_DEFAULT_MESSAGES["shell.documentTitle"];
  if (options.persist !== false) {
    try { localStorage.setItem(STORAGE_KEY, locale); }
    catch { /* Device preference storage may be unavailable. */ }
  }
  for (const callback of [...subscribers]) callback(active);
  document.dispatchEvent(new CustomEvent("forma-locale-change", {
    detail: { locale, direction },
    bubbles: true,
  }));
  return active;
}

export function initializeFormaLocale() {
  let saved: string | null = null;
  try { saved = localStorage.getItem(STORAGE_KEY); }
  catch { /* Respect browsers that prohibit device preference storage. */ }
  const browserLocale = navigator.languages?.find((candidate) => {
    const normalized = canonicalLocale(candidate);
    return FORMA_SUPPORTED_LOCALES.some((item) => normalized === item.locale || normalized.startsWith(item.locale + "-"));
  });
  const preferred = saved || browserLocale || document.documentElement.lang || "en";
  const requested = canonicalLocale(preferred);
  if (formaLocaleFamily(requested) === "en") {
    document.documentElement.lang = /^en(?:-|$)/i.test(requested) ? requested : "en";
    document.documentElement.dir = "ltr";
    active = { ...active, locale: document.documentElement.lang, formatLocale: document.documentElement.lang };
    return Promise.resolve(active);
  }
  return setFormaLocale(requested, { persist: Boolean(saved) });
}

/**
 * Non-rendering, composable language and formatting scope.
 * @tag forma-ui-locale
 * @summary Scope translated component messages, writing direction, and regional formatting.
 * @attr {string} lang - Canonical BCP 47 language used by authored and component content.
 * @attr {string} dir - Explicit ltr, rtl, or auto writing-direction override.
 * @attr {string} format-locale - BCP 47 regional locale used for human-readable numbers and dates.
 * @attr {string} time-zone - IANA time zone used for human-readable dates.
 * @fires {CustomEvent<{ locale: string; direction: string }>} forma-locale-change - The effective locale or writing direction changed.
 */
export class FormaUiLocale extends HTMLElement {
  static observedAttributes = ["lang", "dir", "format-locale", "time-zone"];
  #listeners = new Set<FormaLocaleSubscriber>();
  #unsubscribe?: () => void;
  #snapshot?: FormaLocaleSnapshot;
  #parentSnapshot = active;
  #customMessages: FormaMessageCatalog = {};
  #mergedCatalog?: FormaMessageCatalog;
  #mergedSource?: FormaMessageCatalog;
  #mergedOverrides?: FormaMessageCatalog;
  #managedDirection = false;
  #settingDirection = false;

  get formatLocale() { return this.getAttribute("format-locale") || ""; }
  set formatLocale(value: string) { this.setAttribute("format-locale", value); }
  get timeZone() { return this.getAttribute("time-zone") || ""; }
  set timeZone(value: string) { this.setAttribute("time-zone", value); }
  get messages() { return this.#customMessages; }
  set messages(value: FormaMessageCatalog) {
    this.#customMessages = value || {};
    if (this.isConnected) this.#refresh();
  }

  #request = (event: Event) => {
    const request = event as FormaLocaleRequest;
    if (request.context !== LOCALE_CONTEXT) return;
    request.stopImmediatePropagation();
    if (request.subscribe) {
      this.#listeners.add(request.callback);
      request.callback(this.#snapshot || active, () => this.#listeners.delete(request.callback));
    } else request.callback(this.#snapshot || active);
  };

  connectedCallback() {
    this.#managedDirection ||= !this.hasAttribute("dir");
    const callback: FormaLocaleSubscriber = (snapshot, unsubscribe) => {
      if (unsubscribe) this.#unsubscribe = unsubscribe;
      this.#parentSnapshot = snapshot;
      if (this.isConnected) this.#refresh();
    };
    const request = Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: LOCALE_CONTEXT,
      callback,
      subscribe: true,
    });
    this.dispatchEvent(request);
    if (!this.#unsubscribe) {
      this.#parentSnapshot = active;
      this.#unsubscribe = subscribeToRoot(callback);
    }
    this.addEventListener("context-request", this.#request);
    this.#refresh();
  }

  disconnectedCallback() {
    this.removeEventListener("context-request", this.#request);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#listeners.clear();
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null) {
    if (oldValue === value || !this.isConnected) return;
    if (name === "dir" && this.#settingDirection) return;
    if (name === "dir" && !this.#settingDirection) this.#managedDirection = value === null;
    this.#refresh();
  }

  #refresh() {
    const ownLanguage = this.hasAttribute("lang");
    const locale = canonicalLocale(this.getAttribute("lang") || this.#parentSnapshot.locale);
    const available = locale === this.#parentSnapshot.locale
      ? this.#parentSnapshot.messages
      : catalogs.get(formaLocaleFamily(locale));
    if (!available) {
      void catalogFor(locale)
        .then(() => { if (this.isConnected) this.#refresh(); })
        .catch(() => { /* Preserve the previously resolved scope if a locale chunk fails. */ });
      return;
    }
    const explicit = this.getAttribute("dir");
    const direction: FormaDirection = !this.#managedDirection && explicit === "rtl"
      ? "rtl"
      : !this.#managedDirection && explicit === "ltr"
        ? "ltr"
        : explicit === "auto"
          ? this.matches(":dir(rtl)") ? "rtl" : "ltr"
          : ownLanguage ? localeDirection(locale) : this.#parentSnapshot.direction;
    if (this.#managedDirection && explicit !== direction) {
      this.#settingDirection = true;
      this.setAttribute("dir", direction);
      this.#settingDirection = false;
    }
    let messages = available;
    if (Object.keys(this.#customMessages).length) {
      if (this.#mergedSource !== available || this.#mergedOverrides !== this.#customMessages) {
        this.#mergedSource = available;
        this.#mergedOverrides = this.#customMessages;
        this.#mergedCatalog = { ...available, ...this.#customMessages };
      }
      messages = this.#mergedCatalog || available;
    }
    const snapshot: FormaLocaleSnapshot = {
      locale,
      formatLocale: canonicalLocale(this.formatLocale || (ownLanguage ? locale : this.#parentSnapshot.formatLocale)),
      direction,
      timeZone: safeTimeZone(this.timeZone || this.#parentSnapshot.timeZone),
      messages,
      revision: this.#parentSnapshot.revision,
    };
    const previous = this.#snapshot;
    if (previous && previous.locale === snapshot.locale && previous.formatLocale === snapshot.formatLocale
      && previous.direction === snapshot.direction && previous.timeZone === snapshot.timeZone
      && previous.messages === snapshot.messages) return;
    this.#snapshot = snapshot;
    for (const callback of [...this.#listeners]) callback(snapshot);
    if (previous) this.dispatchEvent(new CustomEvent("forma-locale-change", {
      detail: { locale: snapshot.locale, direction: snapshot.direction },
      bubbles: true,
      composed: true,
    }));
  }
}

export class FormaLocaleController implements ReactiveController {
  #host: FormaLocaleHost;
  #snapshot = active;
  #unsubscribe?: () => void;

  constructor(host: FormaLocaleHost) {
    this.#host = host;
    host.addController(this);
  }

  hostConnected() {
    const callback: FormaLocaleSubscriber = (value, unsubscribe) => {
      if (unsubscribe) this.#unsubscribe = unsubscribe;
      const changed = this.#snapshot !== value;
      this.#snapshot = value;
      if (changed) this.#host.requestUpdate();
    };
    const request = Object.assign(new Event("context-request", { bubbles: true, composed: true }), {
      context: LOCALE_CONTEXT,
      callback,
      subscribe: true,
    });
    this.#host.dispatchEvent(request);
    if (!this.#unsubscribe) {
      this.#snapshot = active;
      this.#unsubscribe = subscribeToRoot(callback);
    }
  }

  hostDisconnected() {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  get locale() { return this.#snapshot.locale; }
  get direction() { return this.#snapshot.direction; }
  get timeZone() { return this.#snapshot.timeZone; }
  get messages() { return this.#snapshot.messages; }

  t(id: string, fallback = "", values: FormaMessageValues = {}) {
    const message = this.#snapshot.messages[id] || FORMA_DEFAULT_MESSAGES[id] || fallback || id;
    return message.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ""));
  }

  plural(id: string, count: number, one: string, other: string, values: FormaMessageValues = {}) {
    const options = {};
    const formatter = cachedFormatter("plural", this.#snapshot.locale, options, () => new Intl.PluralRules(this.#snapshot.locale));
    const category = formatter.select(count);
    return this.t(id + "." + category, category === "one" ? one : other, {
      count: this.number(count),
      ...values,
    });
  }

  number(value: number, options: Intl.NumberFormatOptions = {}) {
    const formatter = cachedFormatter("number", this.#snapshot.formatLocale, options, () => new Intl.NumberFormat(this.#snapshot.formatLocale, options));
    return formatter.format(value);
  }

  date(value: Date | number, options: Intl.DateTimeFormatOptions = {}) {
    const resolved = { timeZone: this.#snapshot.timeZone, ...options };
    const formatter = cachedFormatter("date", this.#snapshot.formatLocale, resolved, () => new Intl.DateTimeFormat(this.#snapshot.formatLocale, resolved));
    return formatter.format(value);
  }

  collator(options: Intl.CollatorOptions = { usage: "search", sensitivity: "base" }) {
    return cachedFormatter("collator", this.#snapshot.locale, options, () => new Intl.Collator(this.#snapshot.locale, options));
  }

  firstGrapheme(value: string) {
    if (typeof Intl.Segmenter === "function") {
      const options: Intl.SegmenterOptions = { granularity: "grapheme" };
      const segmenter = cachedFormatter("segmenter", this.#snapshot.locale, options, () => new Intl.Segmenter(this.#snapshot.locale, options));
      return segmenter.segment(value)[Symbol.iterator]().next().value?.segment || "";
    }
    return Array.from(value)[0] || "";
  }
}

if (!customElements.get("forma-ui-locale")) customElements.define("forma-ui-locale", FormaUiLocale);

declare global {
  interface HTMLElementTagNameMap {
    "forma-ui-locale": FormaUiLocale;
  }
}
